"""Standalone Zwift controller BLE debugger.

This script scans for any Bluetooth device matching "zwift", "click", or "play",
connects to it, dumps ALL GATT services/characteristics, subscribes to every
notifiable characteristic, and prints every raw notification in hex.

PURPOSE: Figure out exactly which characteristic sends button data and what
the raw bytes look like when you press + or -.

Usage:
    python debug_controller.py                         # auto-scan
    python debug_controller.py --address AA:BB:CC:DD   # direct connect
    python debug_controller.py --all                   # show all BLE devices

When it's running, press the + and - buttons on your remote and watch
the terminal. The characteristic that produces output IS the button channel.
"""

import argparse
import asyncio
import struct
import time
from bleak import BleakClient, BleakScanner


# Known service/characteristic names for annotation
KNOWN_UUIDS = {
    "0000fc82-0000-1000-8000-00805f9b34fb": "Zwift Click Service (FC82)",
    "00000001-19ca-4651-86e5-fa29dcdd09d1": "Zwift Play Service",
    "00000002-19ca-4651-86e5-fa29dcdd09d1": "Zwift Notify Characteristic",
    "00000003-19ca-4651-86e5-fa29dcdd09d1": "Zwift Write Characteristic",
    "00000004-19ca-4651-86e5-fa29dcdd09d1": "Zwift Characteristic 04",
    "00001800-0000-1000-8000-00805f9b34fb": "Generic Access",
    "00001801-0000-1000-8000-00805f9b34fb": "Generic Attribute",
    "0000180a-0000-1000-8000-00805f9b34fb": "Device Information",
    "0000fe59-0000-1000-8000-00805f9b34fb": "Nordic DFU (firmware update)",
}


def annotate(uuid: str) -> str:
    u = uuid.lower()
    return KNOWN_UUIDS.get(u, "")


def try_parse_buttons(data: bytes) -> str:
    """Attempt multiple parsing strategies and return a description."""
    results = []

    # Strategy 1: raw bytes as uint8 array
    as_ints = [f"{b:3d}" for b in data]
    results.append(f"  uint8:  [{', '.join(as_ints)}]")

    # Strategy 2: little-endian uint16 words
    if len(data) >= 2:
        words = [struct.unpack_from("<H", data, i)[0] for i in range(0, len(data) - 1, 2)]
        results.append(f"  uint16: [{', '.join(hex(w) for w in words)}]")

    # Strategy 3: little-endian uint32
    if len(data) >= 4:
        val = struct.unpack_from("<I", data, 0)[0]
        results.append(f"  uint32: 0x{val:08x}  bits set: {bin(val)}")

    # Strategy 4: check for ASCII text
    try:
        txt = data.decode("ascii")
        if txt.isprintable():
            results.append(f"  ascii:  '{txt}'")
    except Exception:
        pass

    # Strategy 5 (PRIMARY): Zwift Click v2 confirmed format
    #   byte[0]=0x23, byte[1]=0x08, bytes[2:6]=bitmap LE, byte[6]=0x0F
    if len(data) >= 7 and data[0] == 0x23:
        bitmap = struct.unpack_from("<I", data, 2)[0]
        pressed = (~bitmap) & 0xFFFFFFFF
        pressed_bits = [i for i in range(32) if pressed & (1 << i)]
        SHIFT_UP_BITS   = {4, 6}   # bits 4=+primary, 6=+alt
        SHIFT_DOWN_BITS = {5, 8}   # bits 5=-primary, 8=-alt
        shift_up   = bool(set(pressed_bits) & SHIFT_UP_BITS)
        shift_down = bool(set(pressed_bits) & SHIFT_DOWN_BITS)
        if pressed_bits:
            results.append(f"  \u26a1 BUTTON (protocol-decoded): bits {pressed_bits}  "
                          f"shift_up={shift_up}  shift_down={shift_down}")
        else:
            results.append(f"  (idle — no buttons pressed)")
    # Fallback heuristic for other formats
    elif len(data) >= 4:
        val = struct.unpack_from("<I", data, 0)[0]
        if val > 0xFFFF0000:
            inverted = ~val & 0xFFFFFFFF
            pressed_bits = [i for i in range(32) if inverted & (1 << i)]
            if pressed_bits:
                results.append(f"  \u26a1 BUTTON PRESS (inverted bitmap): bits {pressed_bits} = {[hex(1<<b) for b in pressed_bits]}")

    return "\n".join(results)


async def scan_for_controllers(scan_all=False, timeout=8):
    """Scan for Zwift controllers or all BLE devices."""
    print(f"Scanning {timeout}s for {'all BLE devices' if scan_all else 'Zwift controllers'}...\n")

    seen = {}  # address -> (device, advertisement_data)

    def detection_callback(device, advertisement_data):
        seen[device.address] = (device, advertisement_data)

    async with BleakScanner(detection_callback=detection_callback):
        await asyncio.sleep(timeout)

    found = []
    for device, adv in seen.values():
        name = device.name or ""
        uuids = [str(u).lower() for u in (adv.service_uuids or [])]
        rssi = adv.rssi if hasattr(adv, 'rssi') else "?"

        is_zwift = (
            any(kw in name.lower() for kw in ["zwift", "click", "play"])
            or "fc82" in " ".join(uuids)
            or "19ca4651" in "".join(uuids).replace("-", "")
        )

        if scan_all or is_zwift:
            tag = "⭐ ZWIFT" if is_zwift else "   BLE"
            print(f"  {tag}  {name or '(unnamed)':30s}  [{device.address}]  RSSI={rssi}")
            for u in uuids:
                ann = annotate(u)
                if ann or is_zwift:
                    print(f"         svc: {u}  {ann}")
            if is_zwift:
                found.append((name or "Unknown", device.address))

    return found


async def dump_all_notifications(address: str):
    """Connect to device and dump all notifications from all notifiable characteristics."""
    print(f"\n{'='*60}")
    print(f"  CONTROLLER DEBUGGER — {address}")
    print(f"{'='*60}\n")

    notification_counts = {}

    async with BleakClient(address) as client:
        print(f"✓ Connected\n")

        # Print all services and characteristics
        print("GATT Services:")
        notifiable = []
        writable = []

        for svc in client.services:
            ann = annotate(svc.uuid)
            print(f"  Service: {svc.uuid}  {ann}")
            for char in svc.characteristics:
                props = char.properties
                prop_str = ",".join(props)
                char_ann = annotate(char.uuid)
                print(f"    └ {char.uuid}  [{prop_str}]  {char_ann}")
                if "notify" in props or "indicate" in props:
                    notifiable.append(char)
                if "write" in props or "write-without-response" in props:
                    writable.append(char)

        print(f"\nNotifiable characteristics: {len(notifiable)}")
        print(f"Writable characteristics: {len(writable)}\n")

        # Try RideOn handshake on all writable characteristics
        print("Sending 'RideOn' handshake to all writable characteristics...")
        for char in writable:
            try:
                await client.write_gatt_char(char.uuid, b"RideOn", response=False)
                print(f"  ✓ Wrote to {char.uuid}")
            except Exception as e:
                print(f"  ✗ {char.uuid}: {e}")
        await asyncio.sleep(0.5)

        # Subscribe to ALL notifiable characteristics
        print(f"\nSubscribing to all {len(notifiable)} notifiable characteristics...")

        def make_handler(uuid_str):
            def handler(sender, data: bytearray):
                raw = bytes(data)
                t = time.strftime("%H:%M:%S")
                notification_counts[uuid_str] = notification_counts.get(uuid_str, 0) + 1
                count = notification_counts[uuid_str]
                ann = annotate(uuid_str)
                print(f"\n[{t}] #{count} NOTIFICATION from {uuid_str}")
                if ann:
                    print(f"  Characteristic: {ann}")
                print(f"  Raw hex: {raw.hex()}")
                print(f"  Length:  {len(raw)} bytes")
                print(try_parse_buttons(raw))
            return handler

        for char in notifiable:
            try:
                await client.start_notify(char.uuid, make_handler(char.uuid))
                print(f"  ✓ Subscribed to {char.uuid}")
            except Exception as e:
                print(f"  ✗ {char.uuid}: {e}")

        print(f"\n{'='*60}")
        print(f"  NOW PRESS THE + AND - BUTTONS ON YOUR CONTROLLER")
        print(f"  Watch for NOTIFICATION output below.")
        print(f"  Press Ctrl+C to stop.")
        print(f"{'='*60}\n")

        try:
            while client.is_connected:
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    print(f"\n--- Session summary ---")
    for uuid, count in notification_counts.items():
        print(f"  {uuid}: {count} notifications")


async def main_async(address=None, scan_all=False):
    if address:
        await dump_all_notifications(address)
        return

    controllers = await scan_for_controllers(scan_all=scan_all)

    if not controllers:
        if not scan_all:
            print("\nNo Zwift controllers found. Try:")
            print("  python debug_controller.py --all   (show all BLE devices)")
        return

    print(f"\nFound {len(controllers)} controller(s):")
    for i, (name, addr) in enumerate(controllers):
        print(f"  {i}: {name} [{addr}]")

    if len(controllers) == 1:
        _, address = controllers[0]
    else:
        print("\nEnter the NUMBER (0, 1, ...) from the list above:")
        choice_str = input("Select device number [0]: ").strip() or "0"
        try:
            choice = int(choice_str)
        except ValueError:
            print(f"Invalid input '{choice_str}' — defaulting to 0")
            choice = 0
        _, address = controllers[min(choice, len(controllers) - 1)]

    await dump_all_notifications(address)


def main():
    parser = argparse.ArgumentParser(description="Zwift Controller BLE Debugger")
    parser.add_argument("--address", help="BLE address to connect to directly")
    parser.add_argument("--all", action="store_true", help="Show all BLE devices, not just Zwift")
    args = parser.parse_args()
    asyncio.run(main_async(args.address, args.all))


if __name__ == "__main__":
    main()
