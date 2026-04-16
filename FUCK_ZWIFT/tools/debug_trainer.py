"""Standalone FTMS trainer debugger.

Use this to verify your trainer's BLE handshake and resistance control
INDEPENDENTLY from the main app. Great for diagnosing why resistance
isn't responding.

Usage:
    python debug_trainer.py                        # auto-scan for trainers
    python debug_trainer.py --address AA:BB:CC:DD  # connect to specific address

What it tests:
    1. BLE connection
    2. FTMS Control Point handshake (request control → reset → start)
    3. Resistance at different grades: 0% → 5% → 10% → -3% → 0%
    4. Logs every trainer response with human-readable result codes
"""

import argparse
import asyncio
import struct

from bleak import BleakClient

from ble_module import (
    FTMS_CONTROL_POINT_UUID,
    INDOOR_BIKE_DATA_UUID,
    OP_REQUEST_CONTROL,
    OP_RESET,
    OP_START_RESUME,
    OP_SET_INDOOR_BIKE_SIMULATION,
    FTMS_SERVICE_UUID,
    parse_indoor_bike_data,
    request_control,
    reset_to_sim_mode,
    start_workout,
    set_simulation_params,
    scan_for_trainer,
)

HOLD_SECONDS = 8  # seconds at each grade — enough time to feel the resistance change


async def run_debug(address: str):
    print(f"\n{'='*50}")
    print(f"  FTMS TRAINER DEBUGGER")
    print(f"  Target: {address}")
    print(f"{'='*50}\n")

    async with BleakClient(address) as client:
        print(f"✓ Connected to {address}\n")

        # Print all services for diagnostics
        print("Services discovered:")
        for svc in client.services:
            print(f"  {svc.uuid}  {svc.description or ''}")
            for char in svc.characteristics:
                props = ",".join(char.properties)
                print(f"    └ {char.uuid}  [{props}]")
        print()

        # ----------------------------------------------------------------
        # Subscribe to Indoor Bike Data
        # ----------------------------------------------------------------
        print("Subscribing to Indoor Bike Data notifications...")
        def on_data(sender, data):
            d = parse_indoor_bike_data(bytes(data))
            print(f"  [DATA] power={d['power_watts']:3d}W  "
                  f"cadence={d['cadence_rpm']:3.0f}rpm  "
                  f"speed={d['speed_kmh']:4.1f}km/h")

        await client.start_notify(INDOOR_BIKE_DATA_UUID, on_data)
        print("✓ Subscribed\n")

        # ----------------------------------------------------------------
        # FTMS handshake
        # ----------------------------------------------------------------
        print("--- FTMS Handshake ---")
        await request_control(client)
        await reset_to_sim_mode(client)
        await start_workout(client)
        print("✓ Handshake complete\n")

        # ----------------------------------------------------------------
        # Resistance test sequence
        # ----------------------------------------------------------------
        test_grades = [
            (0.0,  "Flat — should feel like normal pedaling"),
            (5.0,  "5% grade — noticeably harder"),
            (10.0, "10% grade — significantly harder, like a real climb"),
            (-3.0, "-3% grade — downhill, should feel very easy"),
            (0.0,  "Back to flat — resistance should return to baseline"),
        ]

        print("--- Resistance Test Sequence ---")
        print(f"Each grade held for {HOLD_SECONDS}s. Pedal and note the resistance.\n")

        for grade, description in test_grades:
            print(f"\n[{grade:+5.1f}%] {description}")
            await set_simulation_params(client, grade)
            await asyncio.sleep(HOLD_SECONDS)

        print("\n✓ Test complete.")
        print("\nInterpretation:")
        print("  • If resistance felt the same at all grades → trainer not in SIM mode,")
        print("    or CP commands are being rejected. Check the [FTMS] response lines above.")
        print("  • If 0% still very hard → run spindown calibration in the Van Rysel app first.")
        print("  • If response shows 'Op code not supported' → firmware update needed.")


async def main_async(address=None):
    if not address:
        trainers = await scan_for_trainer(timeout=8)
        if not trainers:
            print("No trainers found. Make sure it's powered on and not connected elsewhere.")
            return
        name, address = trainers[0]
        print(f"\nUsing: {name} [{address}]\n")

    await run_debug(address)


def main():
    parser = argparse.ArgumentParser(description="FTMS Trainer BLE Debugger")
    parser.add_argument("--address", help="BLE address of your trainer (optional, auto-scans if not given)")
    args = parser.parse_args()
    asyncio.run(main_async(args.address))


if __name__ == "__main__":
    main()
