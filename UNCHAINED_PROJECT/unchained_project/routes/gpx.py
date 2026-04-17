"""GPX parsing and slope computation."""

import gpxpy
from geopy.distance import geodesic

MIN_SLOPE_DISTANCE_M = 10.0
ELEVATION_SMOOTHING_RADIUS = 2


def load_gpx(filepath):
    """Parse a GPX file and return a list of track points with cumulative distance.

    Returns:
        list of dicts: {lat, lon, elevation, distance_from_start}
        Distances are in meters, elevation in meters.
    """
    with open(filepath, "r") as f:
        gpx = gpxpy.parse(f)

    points = []
    cumulative_dist = 0.0

    for track in gpx.tracks:
        for segment in track.segments:
            for i, pt in enumerate(segment.points):
                if i > 0 and len(points) > 0:
                    prev = points[-1]
                    d = geodesic(
                        (prev["lat"], prev["lon"]),
                        (pt.latitude, pt.longitude),
                    ).meters
                    cumulative_dist += d

                points.append({
                    "lat": pt.latitude,
                    "lon": pt.longitude,
                    "elevation": pt.elevation if pt.elevation is not None else 0.0,
                    "distance_from_start": cumulative_dist,
                })

    return points


def compute_slopes(points):
    """Compute slope segments from track points.

    Returns:
        list of dicts: {start_dist, end_dist, slope_pct}
        slope_pct is clamped to [-20, 20].
    """
    if len(points) < 2:
        return []

    smoothed_elevations = []
    for idx, point in enumerate(points):
        start = max(0, idx - ELEVATION_SMOOTHING_RADIUS)
        end = min(len(points) - 1, idx + ELEVATION_SMOOTHING_RADIUS)
        window = points[start:end + 1]
        avg_elevation = sum(p["elevation"] for p in window) / len(window)
        smoothed_elevations.append(avg_elevation)

    slopes = []
    for i in range(1, len(points)):
        end_idx = i
        while (
            end_idx < len(points)
            and (points[end_idx]["distance_from_start"] - points[i - 1]["distance_from_start"]) < MIN_SLOPE_DISTANCE_M
        ):
            end_idx += 1

        if end_idx >= len(points):
            end_idx = len(points) - 1

        d_dist = points[end_idx]["distance_from_start"] - points[i - 1]["distance_from_start"]
        d_elev = smoothed_elevations[end_idx] - smoothed_elevations[i - 1]

        if d_dist < 1.0:
            continue

        slope = (d_elev / d_dist) * 100.0
        slope = max(-20.0, min(20.0, slope))  # clamp

        slopes.append({
            "start_dist": points[i - 1]["distance_from_start"],
            "end_dist": points[end_idx]["distance_from_start"],
            "slope_pct": slope,
        })

    return slopes


def get_slope_at_distance(slopes, distance):
    """Look up the slope at a given distance along the route."""
    for seg in slopes:
        if seg["start_dist"] <= distance < seg["end_dist"]:
            return seg["slope_pct"]
    return 0.0


def get_total_distance(points):
    """Return total route distance in meters."""
    if not points:
        return 0.0
    return points[-1]["distance_from_start"]


def get_gpx_name(filepath) -> str:
    """Extract the track name from a GPX file, or return filename stem."""
    try:
        with open(filepath, "r") as f:
            gpx = gpxpy.parse(f)
        if gpx.tracks and gpx.tracks[0].name:
            return gpx.tracks[0].name
        if gpx.name:
            return gpx.name
    except Exception:
        pass
    from pathlib import Path
    return Path(filepath).stem.replace("_", " ").title()
