"""Flask app factory — creates and configures the Flask application."""

from __future__ import annotations

from pathlib import Path

from flask import Flask

from unchained_project.config import AppConfig


def create_app(config: AppConfig, gear_system, physics_engine, profile, strava_service) -> Flask:
    """Create the Flask app with all routes registered."""
    # Templates and static files sit at project root
    root_dir = Path(__file__).resolve().parent.parent.parent
    template_dir = root_dir / "templates"
    static_dir = root_dir / "static"
    app = Flask(__name__, template_folder=str(template_dir), static_folder=str(static_dir))

    # Store services on app for route access
    app.config["APP_CONFIG"] = config
    app.config["GEAR"] = gear_system
    app.config["PHYSICS"] = physics_engine
    app.config["PROFILE"] = profile
    app.config["STRAVA"] = strava_service

    # Register blueprints
    from unchained_project.web.routes_ui import ui_bp
    from unchained_project.web.routes_api import api_bp
    from unchained_project.web.sse import sse_bp

    app.register_blueprint(ui_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(sse_bp)

    return app
