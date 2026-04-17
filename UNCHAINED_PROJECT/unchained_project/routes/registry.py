"""Route registry — auto-discovers GPX routes from the data directory."""

from __future__ import annotations

import json
from pathlib import Path

from unchained_project.routes.gpx import get_gpx_name, get_total_distance, load_gpx


# Default emoji for routes without a sidecar
_DEFAULT_EMOJI = "🚴"


def discover_routes(routes_dir: Path) -> dict:
    """Scan a directory for .gpx files and build a route registry.

    For each .gpx file found, generates a route entry with:
        - key: filename stem (e.g. "col_du_galibier")
        - name: from GPX metadata or filename
        - description: from optional route.json sidecar or auto-generated
        - emoji: from sidecar or default
        - file: absolute path to the .gpx file
        - distance_km: computed from GPX
        - elevation_gain: computed from GPX

    Optional sidecar: place a `<stem>.json` next to the GPX file with:
        {"name": "...", "description": "...", "emoji": "..."}

    Returns:
        dict: {route_key: route_info_dict}
    """
    if not routes_dir.exists():
        return {}

    routes = {}

    for gpx_path in sorted(routes_dir.glob("*.gpx")):
        key = gpx_path.stem
        sidecar = _load_sidecar(gpx_path.with_suffix(".json"))

        # Name: sidecar > GPX metadata > filename
        name = sidecar.get("name") or get_gpx_name(str(gpx_path))

        # Description: sidecar > auto-generated
        description = sidecar.get("description", "")

        # Emoji: sidecar > default
        emoji = sidecar.get("emoji", _DEFAULT_EMOJI)

        # Compute stats
        try:
            points = load_gpx(str(gpx_path))
            total_m = get_total_distance(points)
            elevations = [p["elevation"] for p in points]
            gain = max(0, max(elevations) - elevations[0]) if elevations else 0
            distance_km = round(total_m / 1000, 1)
            elevation_gain = round(gain)
        except Exception as exc:
            print(f"  [ROUTES] Error parsing {gpx_path.name}: {exc}")
            distance_km = "?"
            elevation_gain = "?"

        if not description:
            description = f"{distance_km} km route"
            if elevation_gain and elevation_gain != "?":
                description += f" with {elevation_gain}m elevation gain"

        routes[key] = {
            "key": key,
            "name": name,
            "description": description,
            "emoji": emoji,
            "file": str(gpx_path),
            "distance_km": distance_km,
            "elevation_gain": elevation_gain,
        }

    print(f"  [ROUTES] Discovered {len(routes)} route(s) from {routes_dir}")
    return routes


def _load_sidecar(path: Path) -> dict:
    """Load optional JSON sidecar for a route."""
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}
