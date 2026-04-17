"""BLE manager — owns the BLE event loop thread, scan, and connections."""

from __future__ import annotations

import asyncio
import traceback
import threading

from unchained_project.state import state


# ---------------------------------------------------------------------------
# BLE event loop — single thread owns all BLE connections
# ---------------------------------------------------------------------------

_ble_loop: asyncio.AbstractEventLoop | None = None
_trainer_client = None
_controller_tasks: dict = {}   # {address: Task}


def start_ble_thread():
    """Start the BLE event loop in a background daemon thread."""
    t = threading.Thread(target=_ble_thread_main, daemon=True)
    t.start()


def _ble_thread_main():
    global _ble_loop
    _ble_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_ble_loop)
    _ble_loop.run_forever()


def ble_submit(coro):
    """Submit a coroutine to the BLE event loop from any thread."""
    return asyncio.run_coroutine_threadsafe(coro, _ble_loop)


def get_trainer_client():
    """Return the active trainer BleakClient (or None)."""
    return _trainer_client


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

async def do_scan(config):
    """Scan for BLE devices and populate state['scan_results']."""
    from bleak import BleakScanner
    from unchained_project.ble.controllers import PLAY_SERVICE_UUID, CLICK_SERVICE_UUID

    timeout = config.ble.scan_timeout
    trainer_kw = [kw.lower() for kw in config.ble.trainer_keywords]
    controller_kw = [kw.lower() for kw in config.ble.controller_keywords]

    state["scanning"] = True
    state["scan_results"] = []

    found = {}

    def detection_callback(device, advertisement_data):
        uuids = [str(u).lower() for u in (advertisement_data.service_uuids or [])]
        uuids_joined = " ".join(uuids)
        name = device.name or ""

        tags = []
        controller_type = None

        if any("1826" in u or "ftms" in u for u in uuids):
            tags.append("trainer")

        is_play = PLAY_SERVICE_UUID in uuids or "19ca4651" in uuids_joined.replace("-", "")
        is_click = CLICK_SERVICE_UUID in uuids or "fc82" in uuids_joined

        if is_play:
            tags.append("controller")
            controller_type = "play"
        elif is_click:
            tags.append("controller")
            controller_type = "click"

        # Keyword-based detection from config
        name_lower = name.lower()
        if any(kw in name_lower for kw in controller_kw):
            if "controller" not in tags:
                tags.append("controller")
            if controller_type is None:
                controller_type = "play" if "play" in name_lower else "click"

        if any(kw in name_lower for kw in trainer_kw):
            if "trainer" not in tags:
                tags.append("trainer")

        if device.address not in found:
            rssi = advertisement_data.rssi if hasattr(advertisement_data, 'rssi') else None
            found[device.address] = {
                "name": name or "Unknown",
                "address": device.address,
                "rssi": rssi,
                "tags": list(set(tags)),
                "controller_type": controller_type,
            }

    async with BleakScanner(detection_callback=detection_callback):
        await asyncio.sleep(timeout)

    state["scan_results"] = sorted(found.values(), key=lambda d: d["rssi"] or -100, reverse=True)
    state["scanning"] = False
    print(f"Scan complete: {len(state['scan_results'])} devices found.")


# ---------------------------------------------------------------------------
# Trainer connection
# ---------------------------------------------------------------------------

async def do_connect_trainer(address):
    global _trainer_client

    from bleak import BleakClient
    from unchained_project.ble.ftms import (
        INDOOR_BIKE_DATA_UUID, parse_indoor_bike_data,
        request_control, reset_to_sim_mode, start_workout,
    )

    state["trainer_status"] = "connecting"

    try:
        client = BleakClient(address, disconnected_callback=lambda _: _on_trainer_disconnected())
        await client.connect()
        _trainer_client = client

        def on_data(sender, data):
            parsed = parse_indoor_bike_data(bytes(data))
            state["power"] = parsed["power_watts"]
            state["cadence"] = parsed["cadence_rpm"]
            state["speed"] = parsed["speed_kmh"]

        await client.start_notify(INDOOR_BIKE_DATA_UUID, on_data)
        await request_control(client)
        await reset_to_sim_mode(client)
        await start_workout(client)

        name = client.address
        for d in state["scan_results"]:
            if d["address"] == address:
                name = d["name"]
                break

        state["trainer_status"] = "connected"
        state["trainer_name"] = name
        state["trainer_address"] = address
        print(f"Trainer connected: {name}")

    except Exception as e:
        print(f"Trainer connection failed: {e}")
        state["trainer_status"] = "disconnected"
        state["trainer_name"] = ""


def _on_trainer_disconnected():
    state["trainer_status"] = "disconnected"
    state["trainer_name"] = ""
    state["trainer_address"] = None
    state["ride_active"] = False
    print("Trainer disconnected.")


# ---------------------------------------------------------------------------
# Controller connection
# ---------------------------------------------------------------------------

async def do_connect_controller(address, gear_system):
    from unchained_project.ble.controllers import connect_click, connect_play

    # Check if already connected
    for c in state["controllers"]:
        if c["address"] == address:
            print(f"[CTRL] Already connected to {address}, skipping.")
            return

    print(f"[CTRL] do_connect_controller called for {address}")

    ctype = "click"
    name = address
    for d in state["scan_results"]:
        if d["address"] == address:
            name = d["name"]
            stored_type = d.get("controller_type")
            if stored_type:
                ctype = stored_type
            elif "play" in name.lower():
                ctype = "play"
            tags = d.get("tags", [])
            print(f"[CTRL] Device: {name}, tags={tags}, controller_type={stored_type} → using: {ctype}")
            break

    ctrl_entry = {"address": address, "name": name, "status": "connecting", "type": ctype}
    state["controllers"].append(ctrl_entry)

    async def _run():
        try:
            print(f"[CTRL] Starting {ctype} connection to {name} [{address}]...")
            ctrl_entry["status"] = "connected"
            if ctype == "play":
                await connect_play(address, gear_system)
            else:
                await connect_click(address, gear_system)
        except Exception as e:
            print(f"[CTRL] Controller error: {e}")
            traceback.print_exc()
        ctrl_entry["status"] = "disconnected"
        state["controllers"] = [c for c in state["controllers"] if c["address"] != address]
        _controller_tasks.pop(address, None)
        print(f"[CTRL] Controller disconnected: {name} [{address}]")

    _controller_tasks[address] = _ble_loop.create_task(_run())
    print(f"[CTRL] Controller task created: {name} ({ctype}) — {len(state['controllers'])} controller(s) total")
