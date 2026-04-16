"""Activity persistence — save and list completed rides as JSON files."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def save_activity(data: dict, activities_dir: Path) -> str:
    """Save a ride summary to activities/<timestamp>.json.

    Returns:
        Filename of the saved activity.
    """
    activities_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now()
    filename = ts.strftime("%Y%m%d_%H%M%S") + ".json"

    activity = {
        "date": ts.isoformat(),
        "route_name": data.get("route_name", "Unknown"),
        "duration_s": round(data.get("duration_s", 0), 1),
        "distance_m": round(data.get("distance_m", 0), 1),
        "avg_power_w": round(data.get("avg_power_w", 0), 1),
        "max_power_w": round(data.get("max_power_w", 0), 1),
        "avg_cadence": round(data.get("avg_cadence", 0), 1),
        "avg_speed_kmh": round(data.get("avg_speed_kmh", 0), 1),
        "elevation_gain_m": round(data.get("elevation_gain_m", 0), 1),
        "power_samples": data.get("power_samples", []),
        "gpx_file": data.get("gpx_file"),
        "strava": data.get("strava"),
    }

    filepath = activities_dir / filename
    with open(filepath, "w") as f:
        json.dump(activity, f, indent=2)

    print(f"  [ACTIVITY] Saved: {filename}")
    return filename


def list_activities(activities_dir: Path) -> list[dict]:
    """Return all saved activities, newest first."""
    if not activities_dir.exists():
        return []

    activities = []
    for fp in sorted(activities_dir.glob("*.json"), reverse=True):
        try:
            with open(fp) as f:
                act = json.load(f)
            act.pop("power_samples", None)
            act["filename"] = fp.name
            activities.append(act)
        except (json.JSONDecodeError, OSError):
            continue

    return activities
