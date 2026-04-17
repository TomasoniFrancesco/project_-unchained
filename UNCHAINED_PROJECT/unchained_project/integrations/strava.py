"""Strava OAuth integration — authentication and activity upload."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_UPLOAD_URL = "https://www.strava.com/api/v3/uploads"


class StravaService:
    """Handles Strava OAuth flow and activity upload."""

    def __init__(self, client_id: str = "", client_secret: str = "",
                 tokens_path: Path | None = None):
        self._client_id = client_id
        self._client_secret = client_secret
        self._tokens_path = tokens_path or Path("data/strava_tokens.json")

    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def status(self) -> dict:
        tokens = self._load_tokens()
        athlete = tokens.get("athlete") or {}
        has_refresh = bool(tokens.get("refresh_token"))
        has_any_token = has_refresh or bool(tokens.get("access_token"))
        return {
            "configured": self.configured(),
            "connected": has_refresh,
            "athlete_name": " ".join(
                part for part in [athlete.get("firstname", ""), athlete.get("lastname", "")]
                if part
            ).strip(),
            "expires_at": tokens.get("expires_at"),
            "needs_reconnect": has_any_token and not has_refresh,
        }

    def get_authorize_url(self, redirect_uri: str) -> str:
        params = urllib.parse.urlencode({
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "activity:write,activity:read_all",
        })
        return f"{STRAVA_AUTH_URL}?{params}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        data = self._post_form(STRAVA_TOKEN_URL, {
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "code": code,
            "grant_type": "authorization_code",
        })
        self._save_tokens(data)
        return data

    def _refresh_if_needed(self) -> str:
        tokens = self._load_tokens()
        access_token = tokens.get("access_token", "")
        expires_at = tokens.get("expires_at", 0)

        if time.time() < expires_at - 300:
            return access_token

        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            raise RuntimeError("No refresh token — please reconnect Strava.")

        data = self._post_form(STRAVA_TOKEN_URL, {
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        })
        tokens.update({
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", refresh_token),
            "expires_at": data.get("expires_at", 0),
        })
        self._save_tokens(tokens)
        return tokens["access_token"]

    def upload_activity(self, gpx_path: str, name: str,
                        description: str = "", external_id: str = "") -> dict:
        token = self._refresh_if_needed()

        with open(gpx_path, "rb") as f:
            gpx_bytes = f.read()

        fields = {
            "name": name,
            "description": description,
            "trainer": "1",
            "data_type": "gpx",
            "external_id": external_id or Path(gpx_path).stem,
        }
        upload_response = self._post_multipart(
            STRAVA_UPLOAD_URL, fields, "file", Path(gpx_path).name,
            gpx_bytes, "application/gpx+xml", token,
        )

        upload_id = upload_response.get("id")
        if not upload_id:
            error_msg = (
                upload_response.get("message")
                or upload_response.get("error")
                or upload_response.get("errors", [{}])[0].get("message")
                or "Upload failed"
            )
            return {
                "status": "error",
                "message": error_msg,
                "upload": upload_response,
            }

        # Poll for completion
        for _ in range(12):
            time.sleep(5)
            status = self._get_json(
                f"{STRAVA_UPLOAD_URL}/{upload_id}", token
            )
            if "error" in status and isinstance(status["error"], str):
                return {"status": "error", "message": status["error"], "upload": status}
            if status.get("activity_id"):
                return {
                    "status": "ok",
                    "activity_id": status["activity_id"],
                    "upload_id": upload_id,
                }
            if status.get("error"):
                return {"status": "error", "message": str(status["error"]), "upload": status}

        return {"status": "timeout", "message": "Upload processing timed out", "upload_id": upload_id}

    # ── Token persistence ──

    def _load_tokens(self) -> dict:
        if self._tokens_path and self._tokens_path.exists():
            try:
                with open(self._tokens_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save_tokens(self, data: dict):
        if not self._tokens_path:
            return
        self._tokens_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._tokens_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    # ── HTTP helpers ──

    def _post_form(self, url: str, fields: dict) -> dict:
        encoded = urllib.parse.urlencode(fields).encode("utf-8")
        req = urllib.request.Request(url, data=encoded, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                error_msg = json.loads(body).get("message", body)
            except json.JSONDecodeError:
                error_msg = body
            raise RuntimeError(f"Strava API error ({exc.code}): {error_msg}") from exc

    def _get_json(self, url: str, bearer_token: str) -> dict:
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {bearer_token}")
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return {"error": f"Strava API error ({exc.code}): {body}"}
        except Exception as exc:
            return {"error": f"Request failed: {exc}"}

    def _post_multipart(self, url, fields, file_field, filename,
                        file_data, content_type, bearer_token) -> dict:
        boundary = "----UnchainedProjectBoundary"
        body = b""
        for k, v in fields.items():
            body += f"--{boundary}\r\n".encode()
            body += f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode()
            body += f"{v}\r\n".encode()
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode()
        body += f"Content-Type: {content_type}\r\n\r\n".encode()
        body += file_data
        body += f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", f"Bearer {bearer_token}")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body_str = exc.read().decode("utf-8", errors="replace")
            try:
                return json.loads(body_str)
            except json.JSONDecodeError:
                return {"error": f"HTTP {exc.code}: {body_str}"}
