#!/usr/bin/env python3
"""FUCK ZWIFT — Entry point.

Usage:
    python run.py [--port 5050] [--host 0.0.0.0] [--debug]
"""

import argparse
import time

from fuckzwift.config import load_config
from fuckzwift.ride.gear import GearSystem
from fuckzwift.ride.physics import PhysicsEngine
from fuckzwift.storage.profile import UserProfile
from fuckzwift.integrations.strava import StravaService
from fuckzwift.ble.manager import start_ble_thread
from fuckzwift.web.app import create_app


def main():
    parser = argparse.ArgumentParser(description="FUCK ZWIFT — Your ride. Your rules.")
    parser.add_argument("--port", type=int, default=None, help="Server port (default: 5050)")
    parser.add_argument("--host", type=str, default=None, help="Server host (default: 0.0.0.0)")
    parser.add_argument("--debug", action="store_true", help="Debug mode: skip trainer requirement")
    args = parser.parse_args()

    # Load configuration (CLI > env > config.toml > defaults)
    config = load_config(args)

    # Initialize services with config
    gear = GearSystem(
        count=config.gear.count,
        neutral=config.gear.neutral,
        step_grade=config.gear.step_grade,
        debounce_ms=config.gear.debounce_ms,
        smoothing=config.gear.smoothing,
    )

    physics = PhysicsEngine(
        rider_mass=config.physics.rider_mass,
        crr=config.physics.crr,
        cda=config.physics.cda,
        slope_smoothing=config.physics.slope_smoothing,
        max_slope_rate=config.physics.max_slope_rate,
    )

    profile = UserProfile(config.profile_path)
    strava = StravaService(
        client_id=config.strava.client_id,
        client_secret=config.strava.client_secret,
        tokens_path=config.strava_tokens_path,
    )

    # Start BLE event loop thread
    start_ble_thread()
    time.sleep(0.2)

    # Create Flask app
    app = create_app(config, gear, physics, profile, strava)

    mode_str = " [DEBUG MODE]" if config.debug else ""
    print(f"\n  FUCK ZWIFT — http://localhost:{config.port}{mode_str}\n")
    app.run(host=config.host, port=config.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
