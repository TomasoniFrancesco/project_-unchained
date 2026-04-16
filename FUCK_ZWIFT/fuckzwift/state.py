"""Shared application state — single source of truth read by Flask, written by BLE."""

from __future__ import annotations

import threading
from datetime import datetime


# ---------------------------------------------------------------------------
# App-wide state (single shared dict, written from BLE thread, read by Flask)
# ---------------------------------------------------------------------------

state = {
    # Device discovery
    "scan_results": [],          # list of {name, address, rssi, tags, controller_type}
    "scanning": False,

    # Connection status
    "trainer_status": "disconnected",   # disconnected | connecting | connected
    "trainer_name": "",
    "trainer_address": None,
    "controllers": [],  # list of {address, name, status, type}

    # Route
    "selected_route": None,       # path to .gpx
    "selected_route_name": "",

    # Ride live data
    "ride_active": False,
    "ride_paused": False,
    "power": 0,
    "cadence": 0,
    "speed": 0.0,
    "slope": 0.0,           # base slope from GPX
    "effective_slope": 0.0, # slope + gear offset (sent to trainer)
    "distance": 0.0,
    "total_distance": 0.0,
    "progress": 0.0,
    "elapsed": 0.0,
    "elevation": 0.0,
    "gear": 0,
    "gear_offset": 0.0,
    "finished": False,
    "elevation_gain": 0.0,
    "calories": 0.0,
}


# ---------------------------------------------------------------------------
# Ride data accumulator (for activity persistence)
# ---------------------------------------------------------------------------

def new_ride_data() -> dict:
    """Return a fresh ride data accumulator."""
    return {
        "power_samples": [],
        "cadence_samples": [],
        "speed_samples": [],
        "max_power": 0,
        "prev_elevation": 0.0,
        "elevation_gain": 0.0,
        "track_samples": [],
    }


ride_data = new_ride_data()

# Cached route points (set when ride starts, read by /api/route_data)
route_points: list[dict] = []

# Pause tracking
pause_started_at: float | None = None
paused_duration_total: float = 0.0
paused_elapsed_snapshot: float = 0.0

# Ride metadata
ride_started_at_utc: datetime | None = None
ride_finalized: bool = False
finalize_lock = threading.Lock()
