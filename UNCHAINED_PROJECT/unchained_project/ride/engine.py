"""Ride engine — ride loop, finalization, and data accumulation."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from pathlib import Path

from unchained_project.state import state, ride_data, new_ride_data, route_points, finalize_lock
import unchained_project.state as app_state


def reset_ride_data():
    """Reset ride data accumulator for a new ride."""
    fresh = new_ride_data()
    for k, v in fresh.items():
        ride_data[k] = v


def interpolate_route_sample(points, distance_m):
    if not points:
        return None
    if len(points) == 1:
        p = points[0]
        return {"lat": p["lat"], "lon": p["lon"], "ele": p["elevation"], "dist": 0.0}

    distance_m = max(0.0, min(distance_m, points[-1]["distance_from_start"]))
    for idx in range(1, len(points)):
        prev = points[idx - 1]
        curr = points[idx]
        if curr["distance_from_start"] >= distance_m:
            seg = curr["distance_from_start"] - prev["distance_from_start"]
            t = 0.0 if seg <= 0 else (distance_m - prev["distance_from_start"]) / seg
            return {
                "lat": prev["lat"] + (curr["lat"] - prev["lat"]) * t,
                "lon": prev["lon"] + (curr["lon"] - prev["lon"]) * t,
                "ele": prev["elevation"] + (curr["elevation"] - prev["elevation"]) * t,
                "dist": distance_m,
            }
    last = points[-1]
    return {"lat": last["lat"], "lon": last["lon"], "ele": last["elevation"], "dist": distance_m}


def record_track_sample(points, distance_m, elapsed_s):
    sample = interpolate_route_sample(points, distance_m)
    if not sample:
        return

    track_samples = ride_data["track_samples"]
    if track_samples and elapsed_s <= track_samples[-1]["elapsed_s"]:
        return

    track_samples.append({
        "lat": sample["lat"],
        "lon": sample["lon"],
        "ele": sample["ele"],
        "dist": round(sample["dist"], 1),
        "elapsed_s": round(elapsed_s, 1),
    })


def build_ride_activity_payload():
    """Compute the serializable ride payload."""
    samples = ride_data["power_samples"]
    if not samples or state["elapsed"] < 5:
        return None

    n = len(samples)
    avg_power = sum(samples) / n if n else 0
    cadence_samples = ride_data["cadence_samples"]
    speed_samples = ride_data["speed_samples"]

    if len(samples) > 100:
        step = len(samples) / 100
        sparkline = [samples[int(i * step)] for i in range(100)]
    else:
        sparkline = list(samples)

    return {
        "route_name": state["selected_route_name"],
        "duration_s": state["elapsed"],
        "distance_m": state["distance"],
        "avg_power_w": avg_power,
        "max_power_w": ride_data["max_power"],
        "avg_cadence": sum(cadence_samples) / len(cadence_samples) if cadence_samples else 0,
        "avg_speed_kmh": sum(speed_samples) / len(speed_samples) if speed_samples else 0,
        "elevation_gain_m": ride_data["elevation_gain"],
        "power_samples": sparkline,
    }


def finalize_ride(strava_service, profile, config, upload_to_strava=True):
    """Finalize and save the ride, export GPX, optionally upload to Strava."""
    from unchained_project.storage.activities import save_activity
    from unchained_project.storage.export import export_ride_to_gpx

    with finalize_lock:
        if app_state.ride_finalized:
            return {"status": "already_saved", "message": "Ride already finalized."}
        app_state.ride_finalized = True

    payload = build_ride_activity_payload()
    if not payload:
        return {"status": "skipped", "message": "Ride too short to save."}

    gpx_path = None
    if app_state.ride_started_at_utc and ride_data["track_samples"]:
        try:
            gpx_path = export_ride_to_gpx(
                state["selected_route_name"] or "Ride",
                app_state.ride_started_at_utc,
                ride_data["track_samples"],
                config.exports_dir,
            )
        except Exception as exc:
            print(f"  [EXPORT] GPX export failed: {exc}")

    strava_result = {"status": "not_connected", "message": "Strava not connected."}
    if upload_to_strava and gpx_path and strava_service.status().get("connected"):
        try:
            strava_result = strava_service.upload_activity(
                gpx_path,
                payload["route_name"],
                description=f"Uploaded from UNCHAINED PROJECT on {datetime.now().strftime('%Y-%m-%d')}",
                external_id=Path(gpx_path).name,
            )
        except Exception as exc:
            strava_result = {"status": "error", "message": str(exc)}

    payload["gpx_file"] = gpx_path
    payload["strava"] = strava_result
    filename = save_activity(payload, config.activities_dir)

    return {
        "status": "saved",
        "message": "Ride saved locally.",
        "local_file": filename,
        "gpx_file": gpx_path,
        "strava": strava_result,
    }


async def do_start_ride(gear_system, physics_engine, profile, strava_service, config):
    """Start the ride loop (runs inside BLE thread)."""
    from unchained_project.routes.gpx import load_gpx, compute_slopes, get_total_distance, get_slope_at_distance
    from unchained_project.ride.simulation import get_elevation_at_distance
    from unchained_project.ble.ftms import set_simulation_params
    from unchained_project.ble.manager import get_trainer_client

    if state["ride_active"]:
        return

    route_path = state["selected_route"]
    if not route_path:
        print("No route selected.")
        return

    points = load_gpx(route_path)
    slopes = compute_slopes(points)
    total = get_total_distance(points)

    # Cache route points
    app_state.route_points.clear()
    app_state.route_points.extend(points)

    state["total_distance"] = total
    state["distance"] = 0.0
    state["progress"] = 0.0
    state["elapsed"] = 0.0
    state["elevation_gain"] = 0.0
    state["finished"] = False
    state["ride_active"] = True
    state["ride_paused"] = False
    app_state.pause_started_at = None
    app_state.paused_duration_total = 0.0
    app_state.paused_elapsed_snapshot = 0.0
    app_state.ride_started_at_utc = datetime.now(timezone.utc)
    app_state.ride_finalized = False

    # Reset subsystems
    gear_system.__init__(
        count=config.gear.count,
        neutral=config.gear.neutral,
        step_grade=config.gear.step_grade,
        debounce_ms=config.gear.debounce_ms,
        smoothing=config.gear.smoothing,
    )
    physics_engine.reset()
    reset_ride_data()
    state["gear"] = gear_system.get_display_gear()
    state["gear_offset"] = round(gear_system.get_target_offset(), 2)

    if points:
        state["elevation"] = points[0]["elevation"]
        ride_data["prev_elevation"] = points[0]["elevation"]
        record_track_sample(points, 0.0, 0.0)

    start_time = time.time()
    last_time = start_time
    print(f"Ride started: {route_path} ({total:.0f}m)")

    UPDATE_INTERVAL = 1.0

    while state["ride_active"] and not state["finished"]:
        await asyncio.sleep(UPDATE_INTERVAL)

        now = time.time()
        if state["ride_paused"]:
            last_time = now
            state["elapsed"] = app_state.paused_elapsed_snapshot
            continue

        dt = now - last_time
        last_time = now

        speed_ms = state["speed"] / 3.6
        state["distance"] = min(state["distance"] + speed_ms * dt, total)

        if state["distance"] >= total:
            state["distance"] = total
            state["progress"] = 100.0
            state["finished"] = True
            state["ride_active"] = False
            record_track_sample(points, state["distance"], state["elapsed"])
            print("Ride complete!")
            finalize_ride(strava_service, profile, config, upload_to_strava=True)
            break

        raw_slope = get_slope_at_distance(slopes, state["distance"])
        state["slope"] = raw_slope
        smoothed_slope = physics_engine.update(raw_slope, dt)
        state["elevation"] = get_elevation_at_distance(points, state["distance"])
        state["progress"] = (state["distance"] / total) * 100.0
        state["elapsed"] = now - start_time - app_state.paused_duration_total

        elev = state["elevation"]
        if elev > ride_data["prev_elevation"]:
            ride_data["elevation_gain"] += elev - ride_data["prev_elevation"]
        ride_data["prev_elevation"] = elev
        state["elevation_gain"] = round(ride_data["elevation_gain"], 1)

        ride_data["power_samples"].append(state["power"])
        ride_data["cadence_samples"].append(state["cadence"])
        ride_data["speed_samples"].append(state["speed"])
        ride_data["max_power"] = max(ride_data["max_power"], state["power"])
        record_track_sample(points, state["distance"], state["elapsed"])

        gear_offset = gear_system.get_resistance_offset()
        state["gear"] = gear_system.get_display_gear()
        state["gear_offset"] = round(gear_offset, 2)
        state["effective_slope"] = round(max(-40.0, min(40.0, smoothed_slope + gear_offset)), 2)

        trainer_client = get_trainer_client()
        if trainer_client and trainer_client.is_connected:
            try:
                await set_simulation_params(trainer_client, state["effective_slope"])
            except Exception as e:
                print(f"Resistance update failed: {e}")

        elapsed_s = state["elapsed"]
        if elapsed_s > 0 and len(ride_data["power_samples"]) > 0:
            avg_power = sum(ride_data["power_samples"]) / len(ride_data["power_samples"])
            state["calories"] = profile.estimate_calories(avg_power, elapsed_s)
        else:
            state["calories"] = 0.0


async def do_stop_ride():
    state["ride_active"] = False
    state["ride_paused"] = False
    print("Ride stopped by user.")


def toggle_pause_ride():
    if not state["ride_active"] or state["finished"]:
        return state["ride_paused"]

    now = time.time()
    if state["ride_paused"]:
        if app_state.pause_started_at is not None:
            app_state.paused_duration_total += now - app_state.pause_started_at
        app_state.pause_started_at = None
        state["ride_paused"] = False
        state["elapsed"] = app_state.paused_elapsed_snapshot
        print("Ride resumed.")
    else:
        app_state.paused_elapsed_snapshot = state["elapsed"]
        app_state.pause_started_at = now
        state["ride_paused"] = True
        state["elapsed"] = app_state.paused_elapsed_snapshot
        print("Ride paused.")
    return state["ride_paused"]
