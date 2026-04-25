"""API routes — JSON endpoints for scan, connect, ride control, etc."""

from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from unchained_project.state import state, route_points
from unchained_project.ble.manager import ble_submit, do_scan, do_connect_trainer, do_connect_controller
from unchained_project.ride.engine import (
    do_start_ride, do_stop_ride, toggle_pause_ride, finalize_ride,
)
from unchained_project.routes.registry import discover_routes
from unchained_project.routes.gpx import load_gpx, get_total_distance

api_bp = Blueprint("api", __name__)


# ---------------------------------------------------------------------------
# BLE actions
# ---------------------------------------------------------------------------

@api_bp.route("/scan", methods=["POST"])
def scan():
    if state["scanning"]:
        return jsonify({"status": "already_scanning"})
    config = current_app.config["APP_CONFIG"]
    ble_submit(do_scan(config))
    return jsonify({"status": "scanning"})


@api_bp.route("/connect/trainer/<address>", methods=["POST"])
def connect_trainer(address):
    ble_submit(do_connect_trainer(address))
    return jsonify({"status": "connecting"})


@api_bp.route("/connect/controller/<address>", methods=["POST"])
def connect_controller(address):
    gear = current_app.config["GEAR"]
    ble_submit(do_connect_controller(address, gear))
    return jsonify({"status": "connecting"})


# ---------------------------------------------------------------------------
# Route actions
# ---------------------------------------------------------------------------

@api_bp.route("/route/select", methods=["POST"])
def select_route():
    config = current_app.config["APP_CONFIG"]
    routes = discover_routes(config.routes_dir)
    key = request.json.get("route")
    if key not in routes:
        return jsonify({"error": "unknown route"}), 400
    r = routes[key]
    state["selected_route"] = r["file"]
    state["selected_route_name"] = r["name"]
    return jsonify({"status": "ok", "route": r["name"]})


# ---------------------------------------------------------------------------
# Ride actions
# ---------------------------------------------------------------------------

@api_bp.route("/ride/start", methods=["POST"])
def start_ride():
    config = current_app.config["APP_CONFIG"]
    gear = current_app.config["GEAR"]
    physics = current_app.config["PHYSICS"]
    profile = current_app.config["PROFILE"]
    strava = current_app.config["STRAVA"]
    ble_submit(do_start_ride(gear, physics, profile, strava, config))
    return jsonify({"status": "starting"})


@api_bp.route("/ride/stop", methods=["POST"])
def stop_ride():
    config = current_app.config["APP_CONFIG"]
    profile = current_app.config["PROFILE"]
    strava = current_app.config["STRAVA"]
    ble_submit(do_stop_ride())
    result = finalize_ride(strava, profile, config, upload_to_strava=True)
    return jsonify(result)


@api_bp.route("/ride/finish", methods=["POST"])
def finish_ride():
    config = current_app.config["APP_CONFIG"]
    profile = current_app.config["PROFILE"]
    strava = current_app.config["STRAVA"]
    state["ride_active"] = False
    state["ride_paused"] = False

    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "local_only")  # 'local_only', 'strava', or 'discard'

    if mode == "discard":
        return jsonify({"status": "discarded", "message": "Ride discarded."})

    upload = (mode == "strava")
    result = finalize_ride(strava, profile, config, upload_to_strava=upload)
    return jsonify(result)


@api_bp.route("/ride/pause", methods=["POST"])
def pause_ride():
    paused = toggle_pause_ride()
    return jsonify({"status": "ok", "ride_paused": paused, "elapsed": state["elapsed"]})


# ---------------------------------------------------------------------------
# Gear
# ---------------------------------------------------------------------------

@api_bp.route("/gear/up", methods=["POST"])
def gear_up():
    gear = current_app.config["GEAR"]
    gear.shift_up()
    return jsonify({"gear": gear.get_display_gear()})


@api_bp.route("/gear/down", methods=["POST"])
def gear_down():
    gear = current_app.config["GEAR"]
    gear.shift_down()
    return jsonify({"gear": gear.get_display_gear()})


# ---------------------------------------------------------------------------
# Data APIs
# ---------------------------------------------------------------------------

@api_bp.route("/api/profile", methods=["GET"])
def api_profile_get():
    profile = current_app.config["PROFILE"]
    return jsonify(profile.to_dict())


@api_bp.route("/api/profile", methods=["POST"])
def api_profile_post():
    profile = current_app.config["PROFILE"]
    data = request.json or {}
    profile.update(data)
    return jsonify({"status": "ok", "profile": profile.to_dict()})


@api_bp.route("/api/strava_status", methods=["GET"])
def api_strava_status():
    strava = current_app.config["STRAVA"]
    from unchained_project.web.routes_ui import _build_callback_url
    status = strava.status()
    status["callback_url"] = _build_callback_url()
    return jsonify(status)


@api_bp.route("/api/route_data")
def api_route_data():
    """Return cached route geometry as JSON for the frontend map/elevation."""
    if not route_points:
        route_path = state.get("selected_route")
        if route_path:
            try:
                pts = load_gpx(route_path)
                points = [
                    {"lat": p["lat"], "lon": p["lon"],
                     "ele": p["elevation"], "dist": p["distance_from_start"]}
                    for p in pts
                ]
                total = get_total_distance(pts)
                return jsonify({"points": points, "total_distance": total})
            except Exception:
                pass
        return jsonify({"points": [], "total_distance": 0})

    points = [
        {"lat": p["lat"], "lon": p["lon"],
         "ele": p["elevation"], "dist": p["distance_from_start"]}
        for p in route_points
    ]
    total = get_total_distance(route_points)
    return jsonify({"points": points, "total_distance": total})


@api_bp.route("/api/activities")
def api_activities():
    config = current_app.config["APP_CONFIG"]
    from unchained_project.storage.activities import list_activities
    return jsonify(list_activities(config.activities_dir))


# ---------------------------------------------------------------------------
# Configuration API (setup wizard)
# ---------------------------------------------------------------------------

@api_bp.route("/api/config/strava", methods=["POST"])
def api_config_strava():
    """Save Strava credentials to config.toml and reload the service."""
    data = request.get_json(silent=True) or {}
    client_id = str(data.get("client_id", "")).strip()
    client_secret = str(data.get("client_secret", "")).strip()

    if not client_id or not client_secret:
        return jsonify({"status": "error", "error": "client_id and client_secret required"}), 400

    config = current_app.config["APP_CONFIG"]

    # Update config object in memory
    config.strava.client_id = client_id
    config.strava.client_secret = client_secret

    # Write to config.toml
    try:
        _save_strava_to_toml(client_id, client_secret)
    except Exception as exc:
        return jsonify({"status": "error", "error": f"Failed to save config: {exc}"}), 500

    # Hot-reload StravaService
    from unchained_project.integrations.strava import StravaService
    strava = StravaService(
        client_id=client_id,
        client_secret=client_secret,
        tokens_path=config.strava_tokens_path,
    )
    current_app.config["STRAVA"] = strava

    print(f"  [CONFIG] Strava credentials saved (client_id={client_id[:6]}...)")
    return jsonify({"status": "ok"})


@api_bp.route("/api/config/gear-range", methods=["POST"])
def api_config_gear_range():
    """Save the manually configured trainer range used by virtual gears."""
    data = request.get_json(silent=True) or {}

    try:
        min_grade = float(data.get("roller_min_grade"))
        max_grade = float(data.get("roller_max_grade"))
    except (TypeError, ValueError):
        return jsonify({"status": "error", "error": "roller_min_grade and roller_max_grade required"}), 400

    if min_grade < -40.0 or max_grade > 40.0 or min_grade >= max_grade:
        return jsonify({"status": "error", "error": "range must be ordered and within -40..40"}), 400

    config = current_app.config["APP_CONFIG"]
    config.gear.roller_min_grade = min_grade
    config.gear.roller_max_grade = max_grade

    try:
        _save_gear_range_to_toml(min_grade, max_grade)
    except Exception as exc:
        return jsonify({"status": "error", "error": f"Failed to save config: {exc}"}), 500

    return jsonify({
        "status": "ok",
        "gear": {
            "roller_min_grade": min_grade,
            "roller_max_grade": max_grade,
        },
    })


def _save_strava_to_toml(client_id: str, client_secret: str):
    """Write/update Strava credentials in config.toml."""
    from unchained_project.config import PROJECT_ROOT
    toml_path = PROJECT_ROOT / "config.toml"

    # Read existing content or start fresh
    if toml_path.exists():
        content = toml_path.read_text(encoding="utf-8")
    else:
        content = ""

    # Check if [strava] section already exists
    import re
    strava_section = re.search(r'^\[strava\].*?(?=^\[|\Z)', content, re.MULTILINE | re.DOTALL)

    new_section = (
        f'[strava]\n'
        f'client_id = "{client_id}"\n'
        f'client_secret = "{client_secret}"\n'
    )

    if strava_section:
        # Replace existing [strava] section
        content = content[:strava_section.start()] + new_section + content[strava_section.end():]
    else:
        # Append [strava] section
        if content and not content.endswith("\n"):
            content += "\n"
        content += "\n" + new_section

    toml_path.write_text(content, encoding="utf-8")
    print(f"  [CONFIG] config.toml updated")


def _save_gear_range_to_toml(min_grade: float, max_grade: float):
    """Write/update gear range values in config.toml."""
    from unchained_project.config import PROJECT_ROOT
    import re

    toml_path = PROJECT_ROOT / "config.toml"
    content = toml_path.read_text(encoding="utf-8") if toml_path.exists() else ""
    gear_section = re.search(r'^\[gear\].*?(?=^\[|\Z)', content, re.MULTILINE | re.DOTALL)

    def upsert_key(section: str, key: str, value: float) -> str:
        pattern = rf'^{key}\s*=.*$'
        line = f"{key} = {value:.2f}"
        if re.search(pattern, section, re.MULTILINE):
            return re.sub(pattern, line, section, flags=re.MULTILINE)
        if section and not section.endswith("\n"):
            section += "\n"
        return section + line + "\n"

    if gear_section:
        section = gear_section.group(0)
        section = upsert_key(section, "roller_min_grade", min_grade)
        section = upsert_key(section, "roller_max_grade", max_grade)
        content = content[:gear_section.start()] + section + content[gear_section.end():]
    else:
        if content and not content.endswith("\n"):
            content += "\n"
        content += f'\n[gear]\nroller_min_grade = {min_grade:.2f}\nroller_max_grade = {max_grade:.2f}\n'

    toml_path.write_text(content, encoding="utf-8")
    print("  [CONFIG] gear range updated")
