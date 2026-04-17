"""UI page routes — serves HTML templates."""

from __future__ import annotations

from flask import Blueprint, current_app, redirect, render_template, url_for

from unchained_project.state import state
from unchained_project.routes.registry import discover_routes
from unchained_project.storage.activities import list_activities

ui_bp = Blueprint("ui", __name__)


def _needs_setup() -> bool:
    """Check if the app needs first-time setup (profile not yet configured)."""
    profile = current_app.config["PROFILE"]
    return not profile.is_complete()


@ui_bp.route("/")
def home_screen():
    if _needs_setup():
        return redirect(url_for("ui.setup_screen"))
    return render_template("home.html")


@ui_bp.route("/setup")
def setup_screen():
    profile = current_app.config["PROFILE"]
    config = current_app.config["APP_CONFIG"]
    return render_template(
        "setup.html",
        profile=profile.to_dict(),
        strava_client_id=config.strava.client_id,
        strava_client_secret=config.strava.client_secret,
    )


@ui_bp.route("/connect")
def connect_screen():
    return render_template("connect.html")


@ui_bp.route("/routes")
def routes_screen():
    config = current_app.config["APP_CONFIG"]

    if not config.ble.bypass_connection and not config.debug:
        if state["trainer_status"] != "connected":
            return redirect(url_for("ui.connect_screen"))

    routes = discover_routes(config.routes_dir)
    route_cards = list(routes.values())
    return render_template("routes.html", routes=route_cards)


@ui_bp.route("/ride")
def ride_screen():
    config = current_app.config["APP_CONFIG"]

    if not config.ble.bypass_connection and not config.debug:
        if state["trainer_status"] != "connected":
            return redirect(url_for("ui.connect_screen"))
    if not state["selected_route"]:
        return redirect(url_for("ui.routes_screen"))

    return render_template("ride.html", route_name=state["selected_route_name"])


@ui_bp.route("/history")
def history_screen():
    config = current_app.config["APP_CONFIG"]
    return render_template("history.html", activities=list_activities(config.activities_dir))


@ui_bp.route("/profile")
def profile_screen():
    profile = current_app.config["PROFILE"]
    return render_template("profile.html", profile=profile.to_dict())


@ui_bp.route("/strava/connect")
def strava_connect():
    strava = current_app.config["STRAVA"]
    if not strava.configured():
        return redirect(url_for("ui.home_screen"))
    return redirect(strava.get_authorize_url(_build_callback_url()))


@ui_bp.route("/strava/callback")
def strava_callback():
    from flask import request
    strava = current_app.config["STRAVA"]
    error = request.args.get("error")
    code = request.args.get("code")
    if error or not code:
        return redirect(url_for("ui.home_screen"))
    try:
        strava.exchange_code(code, _build_callback_url())
        return redirect(url_for("ui.home_screen"))
    except Exception as exc:
        print(f"  [STRAVA] OAuth error: {exc}")
        return redirect(url_for("ui.home_screen"))


def _build_callback_url():
    from flask import request
    port = request.host.split(":")[1] if ":" in request.host else "5050"
    return f"http://localhost:{port}{url_for('ui.strava_callback')}"
