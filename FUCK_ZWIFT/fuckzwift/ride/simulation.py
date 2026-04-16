"""Simulation engine — main loop that ties BLE/mock data to GPX route."""

import asyncio
import time
from dataclasses import dataclass


@dataclass
class SimulationState:
    """Shared state between simulation loop and UI."""
    distance_traveled: float = 0.0
    total_distance: float = 0.0
    current_slope: float = 0.0
    effective_slope: float = 0.0
    current_power: int = 0
    current_cadence: int = 0
    current_speed: float = 0.0
    progress_pct: float = 0.0
    elapsed_time: float = 0.0
    elevation: float = 0.0
    gear: int = 0
    gear_offset: float = 0.0
    is_running: bool = False
    is_finished: bool = False


def get_slope_at_distance(slopes, distance):
    """Look up the slope at a given distance along the route."""
    for seg in slopes:
        if seg["start_dist"] <= distance < seg["end_dist"]:
            return seg["slope_pct"]
    return 0.0


def get_elevation_at_distance(points, distance):
    """Interpolate elevation at a given distance along the route."""
    if not points:
        return 0.0
    if distance <= 0:
        return points[0]["elevation"]
    if distance >= points[-1]["distance_from_start"]:
        return points[-1]["elevation"]

    for i in range(1, len(points)):
        if points[i]["distance_from_start"] >= distance:
            prev = points[i - 1]
            curr = points[i]
            seg_len = curr["distance_from_start"] - prev["distance_from_start"]
            if seg_len < 0.01:
                return prev["elevation"]
            ratio = (distance - prev["distance_from_start"]) / seg_len
            return prev["elevation"] + ratio * (curr["elevation"] - prev["elevation"])

    return points[-1]["elevation"]


async def run_simulation_mock(state, slopes, points, mock_trainer, gear_system=None, update_interval=1.0):
    """Run the simulation loop using the mock trainer."""
    from fuckzwift.routes.gpx import get_total_distance

    state.total_distance = get_total_distance(points)
    state.is_running = True
    state.is_finished = False
    start_time = time.time()

    print(f"Simulation started. Route: {state.total_distance:.0f}m")

    while state.is_running and not state.is_finished:
        data = mock_trainer.get_data()
        state.current_power = data["power_watts"]
        state.current_cadence = data["cadence_rpm"]
        state.current_speed = data["speed_kmh"]

        speed_ms = state.current_speed / 3.6
        state.distance_traveled += speed_ms * update_interval

        if state.distance_traveled >= state.total_distance:
            state.distance_traveled = state.total_distance
            state.progress_pct = 100.0
            state.is_finished = True
            print("Route complete!")
            break

        state.current_slope = get_slope_at_distance(slopes, state.distance_traveled)
        state.elevation = get_elevation_at_distance(points, state.distance_traveled)
        state.progress_pct = (state.distance_traveled / state.total_distance) * 100.0
        state.elapsed_time = time.time() - start_time

        gear_offset = 0.0
        if gear_system:
            gear_offset = gear_system.get_resistance_offset()
            state.gear = gear_system.get_gear()
            state.gear_offset = round(gear_offset, 1)

        state.effective_slope = max(-40.0, min(40.0, state.current_slope + gear_offset))
        mock_trainer.set_slope(state.effective_slope)

        await asyncio.sleep(update_interval)

    state.is_running = False
    print("Simulation stopped.")


async def run_simulation_ble(state, slopes, points, ble_client, data_callback, gear_system=None, update_interval=1.0):
    """Run the simulation loop using real BLE trainer."""
    from fuckzwift.routes.gpx import get_total_distance
    from fuckzwift.ble.ftms import set_simulation_params

    state.total_distance = get_total_distance(points)
    state.is_running = True
    state.is_finished = False
    start_time = time.time()

    print(f"Simulation started (BLE). Route: {state.total_distance:.0f}m")

    while state.is_running and not state.is_finished:
        state.current_power = data_callback.get("power_watts", 0)
        state.current_cadence = data_callback.get("cadence_rpm", 0)
        state.current_speed = data_callback.get("speed_kmh", 0.0)

        speed_ms = state.current_speed / 3.6
        state.distance_traveled += speed_ms * update_interval

        if state.distance_traveled >= state.total_distance:
            state.distance_traveled = state.total_distance
            state.progress_pct = 100.0
            state.is_finished = True
            print("Route complete!")
            break

        state.current_slope = get_slope_at_distance(slopes, state.distance_traveled)
        state.elevation = get_elevation_at_distance(points, state.distance_traveled)
        state.progress_pct = (state.distance_traveled / state.total_distance) * 100.0
        state.elapsed_time = time.time() - start_time

        gear_offset = 0.0
        if gear_system:
            gear_offset = gear_system.get_resistance_offset()
            state.gear = gear_system.get_gear()
            state.gear_offset = round(gear_offset, 1)

        state.effective_slope = max(-40.0, min(40.0, state.current_slope + gear_offset))
        await set_simulation_params(ble_client, state.effective_slope)

        await asyncio.sleep(update_interval)

    state.is_running = False
    print("Simulation stopped.")
