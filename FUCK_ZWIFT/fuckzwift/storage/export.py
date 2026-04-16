"""Ride export helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import gpxpy.gpx


def export_ride_to_gpx(route_name: str, started_at: datetime,
                       track_samples: list[dict], exports_dir: Path) -> str | None:
    """Write a GPX file for the recorded ride samples and return its path."""
    if not track_samples:
        return None

    exports_dir.mkdir(parents=True, exist_ok=True)
    ts = started_at.astimezone(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = exports_dir / f"{ts}_{_slug(route_name)}.gpx"

    gpx = gpxpy.gpx.GPX()
    gpx.name = route_name
    track = gpxpy.gpx.GPXTrack(name=route_name)
    gpx.tracks.append(track)
    segment = gpxpy.gpx.GPXTrackSegment()
    track.segments.append(segment)

    for sample in track_samples:
        segment.points.append(
            gpxpy.gpx.GPXTrackPoint(
                latitude=sample["lat"],
                longitude=sample["lon"],
                elevation=sample["ele"],
                time=started_at + timedelta(seconds=sample["elapsed_s"]),
            )
        )

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(gpx.to_xml())
    return str(path)


def _slug(value: str) -> str:
    clean = "".join(ch.lower() if ch.isalnum() else "_" for ch in value.strip())
    clean = "_".join(part for part in clean.split("_") if part)
    return clean or "ride"
