"""BLE/FTMS module — connect to smart trainer, read data, set resistance.

Implements the full FTMS Control Point handshake with response logging:
  1. subscribe to CP indications
  2. request_control (0x00)
  3. reset_to_sim_mode (0x01)  ← forces trainer out of ERG into SIM
  4. start_workout (0x07)
  5. set_simulation_params (0x11) every second

Response format: 0x80 <opcode> <result>
  result 0x01 = Success
  result 0x02 = Op code not supported
  result 0x03 = Invalid parameter
  result 0x04 = Operation failed
"""

import asyncio
import struct
from bleak import BleakClient, BleakScanner

# ---------------------------------------------------------------------------
# UUIDs
# ---------------------------------------------------------------------------

FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
FTMS_CONTROL_POINT_UUID = "00002ad9-0000-1000-8000-00805f9b34fb"

# ---------------------------------------------------------------------------
# FTMS Control Point opcodes
# ---------------------------------------------------------------------------

OP_REQUEST_CONTROL        = 0x00
OP_RESET                  = 0x01  # resets trainer to idle/SIM mode (exits ERG)
OP_START_RESUME           = 0x07
OP_SET_INDOOR_BIKE_SIMULATION = 0x11

# Response opcode echoed back by trainer
OP_RESPONSE = 0x80

# Response result codes
RESULT_SUCCESS            = 0x01
RESULT_NOT_SUPPORTED      = 0x02
RESULT_INVALID_PARAM      = 0x03
RESULT_FAILED             = 0x04

_RESULT_NAMES = {
    RESULT_SUCCESS:       "Success",
    RESULT_NOT_SUPPORTED: "Op code not supported",
    RESULT_INVALID_PARAM: "Invalid parameter",
    RESULT_FAILED:        "Operation failed",
}

# ---------------------------------------------------------------------------
# CP response parsing
# ---------------------------------------------------------------------------

def _parse_cp_response(data: bytes) -> str:
    """Parse a FTMS Control Point indication and return a human-readable string."""
    if len(data) < 3 or data[0] != OP_RESPONSE:
        return f"(unknown: {data.hex()})"
    opcode = data[1]
    result = data[2]
    result_name = _RESULT_NAMES.get(result, f"unknown(0x{result:02x})")
    return f"opcode=0x{opcode:02x} → {result_name}"


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

async def scan_for_trainer(timeout=10):
    """Scan for BLE devices advertising the FTMS service.

    Returns:
        list of (name, address) tuples.
    """
    print(f"Scanning for FTMS trainers ({timeout}s)...")

    seen = {}

    def detection_callback(device, advertisement_data):
        seen[device.address] = (device, advertisement_data)

    async with BleakScanner(detection_callback=detection_callback):
        await asyncio.sleep(timeout)

    trainers = []
    for device, adv in seen.values():
        uuids = [str(u).lower() for u in (adv.service_uuids or [])]
        name = device.name or ""
        if FTMS_SERVICE_UUID in uuids or any("1826" in u for u in uuids):
            trainers.append((name or "Unknown", device.address))
            print(f"  Found trainer: {name} [{device.address}]")

    if not trainers:
        for device, adv in seen.values():
            name = (device.name or "").lower()
            if any(kw in name for kw in ["trainer", "bike", "van rysel", "ftms", "tacx", "wahoo", "elite"]):
                trainers.append((device.name, device.address))
                print(f"  Found (by name): {device.name} [{device.address}]")

    return trainers


# ---------------------------------------------------------------------------
# Indoor Bike Data parser
# ---------------------------------------------------------------------------

def parse_indoor_bike_data(data: bytes):
    """Parse the Indoor Bike Data characteristic (0x2AD2).

    Returns dict: speed_kmh, cadence_rpm, power_watts.
    """
    result = {"speed_kmh": 0.0, "cadence_rpm": 0, "power_watts": 0}

    if len(data) < 2:
        return result

    flags = struct.unpack_from("<H", data, 0)[0]
    offset = 2

    # Bit 0: More Data (inverted — 0 means speed IS present)
    if not (flags & 0x0001):
        if offset + 2 <= len(data):
            result["speed_kmh"] = struct.unpack_from("<H", data, offset)[0] * 0.01
            offset += 2

    if flags & 0x0002: offset += 2   # avg speed
    if flags & 0x0004:               # instantaneous cadence
        if offset + 2 <= len(data):
            result["cadence_rpm"] = struct.unpack_from("<H", data, offset)[0] * 0.5
            offset += 2
    if flags & 0x0008: offset += 2   # avg cadence
    if flags & 0x0010: offset += 3   # total distance (uint24)
    if flags & 0x0020: offset += 2   # resistance level
    if flags & 0x0040:               # instantaneous power
        if offset + 2 <= len(data):
            result["power_watts"] = struct.unpack_from("<h", data, offset)[0]
            offset += 2

    return result


# ---------------------------------------------------------------------------
# Control Point commands — each subscribes to indications and logs response
# ---------------------------------------------------------------------------

async def _send_cp(client: BleakClient, payload: bytes, label: str, timeout=2.0):
    """Send a Control Point command and wait for the trainer's indication response.

    Subscribes temporarily to the CP characteristic for the response.
    Logs both the raw hex and the parsed result.
    """
    response_event = asyncio.Event()

    def on_indication(sender, data: bytearray):
        raw = bytes(data)
        parsed = _parse_cp_response(raw)
        print(f"  [FTMS] {label} → {parsed}  (raw: {raw.hex()})")
        response_event.set()

    try:
        await client.start_notify(FTMS_CONTROL_POINT_UUID, on_indication)
    except Exception:
        pass  # already subscribed (e.g. called twice)

    await client.write_gatt_char(FTMS_CONTROL_POINT_UUID, payload, response=True)

    try:
        await asyncio.wait_for(response_event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        print(f"  [FTMS] {label} → No indication received within {timeout}s (trainer may not confirm this op)")


async def request_control(client: BleakClient):
    """Request FTMS control. Must be called before any other CP command.

    Trainer responds: 80 00 01 = Success
    """
    print("  [FTMS] Requesting control (0x00)...")
    await _send_cp(client, struct.pack("<B", OP_REQUEST_CONTROL), "Request Control")
    await asyncio.sleep(0.3)


async def reset_to_sim_mode(client: BleakClient):
    """Reset trainer to idle/simulation mode — exits ERG mode.

    CRITICAL: Without this, many FTMS trainers stay in ERG mode and
    ignore Set Simulation Params commands entirely, making resistance
    feel locked or unresponsive to slope changes.

    Trainer responds: 80 01 01 = Success
    """
    print("  [FTMS] Resetting to SIM mode (0x01)...")
    await _send_cp(client, struct.pack("<B", OP_RESET), "Reset → SIM Mode")
    await asyncio.sleep(0.5)


async def start_workout(client: BleakClient):
    """Send Start/Resume — begins the training session.

    Trainer responds: 80 07 01 = Success
    """
    print("  [FTMS] Starting workout (0x07)...")
    await _send_cp(client, struct.pack("<B", OP_START_RESUME), "Start/Resume")
    await asyncio.sleep(0.3)


async def set_simulation_params(client: BleakClient, slope_pct: float, crr: float = 0.004, cw: float = 0.51):
    """Set Indoor Bike Simulation Parameters.

    Sends grade, rolling resistance, and wind resistance to the trainer.
    The trainer adjusts its brake unit to simulate the physical forces.

    Args:
        slope_pct: Road grade in percent. Range: -40.0 to +40.0.
        crr: Rolling resistance coefficient (0.0001 resolution). Default 0.004.
        cw: Wind resistance / frontal drag in kg/m (0.01 resolution). Default 0.51.

    Payload layout (FTMS spec §4.16.2.12):
        [0]    opcode: 0x11
        [1-2]  wind speed: sint16, 0.001 m/s (0 = no wind)
        [3-4]  grade: sint16, 0.01% (e.g. 500 = 5.00%)
        [5]    crr: uint8, 0.0001 (e.g. 40 = 0.0040)
        [6]    cw: uint8, 0.01 kg/m (e.g. 51 = 0.51)
    """
    slope_pct = max(-40.0, min(40.0, slope_pct))
    grade_raw = int(slope_pct * 100)   # 0.01% resolution
    crr_raw   = int(crr * 10000)       # 0.0001 resolution
    cw_raw    = int(cw * 100)          # 0.01 resolution

    payload = struct.pack("<BhhBB", OP_SET_INDOOR_BIKE_SIMULATION, 0, grade_raw, crr_raw, cw_raw)
    print(f"  [FTMS] SIM params: slope={slope_pct:+.1f}%  payload={payload.hex()}")

    try:
        await client.write_gatt_char(FTMS_CONTROL_POINT_UUID, payload, response=True)
    except Exception as e:
        print(f"  [FTMS] Warning: set_simulation_params failed: {e}")
