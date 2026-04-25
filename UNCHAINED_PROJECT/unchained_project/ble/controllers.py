"""Zwift controller — BLE connection and button decoding.

Supports:
- Zwift Click v2: service FC82, simple RideOn handshake, unencrypted
- Zwift Play: service 00000001-19ca-..., X25519 encrypted handshake

Key fixes vs original:
- Verbose logging of every notification (hex + parsed)
- Multi-format parser: tries inverted bitmap at every offset, not just 0x23
- Dynamic characteristic discovery: finds notify/write chars at runtime
  instead of assuming fixed UUIDs
- RideOn sent with and without response= to maximize compatibility
- Edge detection on button press (False→True transition)
"""

import asyncio
import struct
import time
from bleak import BleakClient, BleakScanner

# ---------------------------------------------------------------------------
# Known service UUIDs
# ---------------------------------------------------------------------------

CLICK_SERVICE_UUID = "0000fc82-0000-1000-8000-00805f9b34fb"
PLAY_SERVICE_UUID  = "00000001-19ca-4651-86e5-fa29dcdd09d1"

# These are the most common characteristic UUIDs, but we also discover at runtime
ZWIFT_NOTIFY_UUID = "00000002-19ca-4651-86e5-fa29dcdd09d1"
ZWIFT_WRITE_UUID  = "00000003-19ca-4651-86e5-fa29dcdd09d1"

# ---------------------------------------------------------------------------
# Protocol constants — confirmed from real hardware (Zwift Click v2)
# ---------------------------------------------------------------------------
#
# Packet format (7 bytes on characteristic 00000002-19ca-...)::
#
#   byte 0: 0x23  = MSG_KEY_PRESS (message type)
#   byte 1: 0x08  = payload length / subtype (constant)
#   bytes 2-5:    = button bitmap (little-endian uint32, INVERTED: 0 = pressed)
#   byte 6: 0x0F  = footer (constant)
#
# Idle state (no buttons pressed): bitmap = 0xFFFFFFFF (all bits set)
# Button presses clear individual bits:
#
#   Observed from real device:
#     bit 4  (0x00000010)  cleared → + button (shift up)
#     bit 5  (0x00000020)  cleared → - button (shift down)
#     bit 6  (0x00000040)  cleared → secondary + (also shift up)
#     bit 8  (0x00000100)  cleared → secondary - (also shift down)

MSG_KEY_PRESS   = 0x23
MSG_FOOTER      = 0x0F
BITMAP_OFFSET   = 2        # bitmap starts at byte 2
IDLE_BITMAP     = 0xFFFFFFFF  # all buttons released

# Button bit masks (in the inverted bitmap, 0 = pressed, so we clear these bits)
# Confirmed from real Zwift Click hardware:
#   Right controller "+": clears bit 13 (0x2000) → GEAR UP
#   Left controller  "-": clears bit  9 (0x0200) → GEAR DOWN
BTN_SHIFT_UP   = 1 << 13  # 0x00002000  — right controller "+"
BTN_SHIFT_DOWN = 1 << 9   # 0x00000200  — left controller  "-"

MASK_SHIFT_UP   = BTN_SHIFT_UP
MASK_SHIFT_DOWN = BTN_SHIFT_DOWN
CONTROLLER_KEEPALIVE_S = 30.0


# ---------------------------------------------------------------------------
# Parser — reads real hardware format
# ---------------------------------------------------------------------------

def parse_notification(data: bytes, verbose: bool = True) -> dict | None:
    """Parse a Zwift Click v2 button notification.

    Expected format: 23 08 [4-byte LE bitmap] 0F

    The bitmap is inverted: 0 = button pressed, 1 = button released.
    Idle state (nothing pressed) = 0xFFFFFFFF.

    Returns:
        dict with shift_up, shift_down, raw_bitmap — or None if not parseable.
    """
    if len(data) < 7:
        if verbose:
            print(f"  [CTRL] Packet too short ({len(data)}B): {data.hex()}")
        return None

    if data[0] != MSG_KEY_PRESS:
        if verbose:
            print(f"  [CTRL] Not a key press msg (byte0=0x{data[0]:02x}): {data.hex()}")
        return None

    bitmap = struct.unpack_from("<I", data, BITMAP_OFFSET)[0]
    pressed = (~bitmap) & 0xFFFFFFFF  # invert: 1 = pressed

    shift_up   = bool(pressed & MASK_SHIFT_UP)
    shift_down = bool(pressed & MASK_SHIFT_DOWN)

    if verbose:
        if pressed:
            pressed_bits = [i for i in range(32) if pressed & (1 << i)]
            print(f"  [CTRL] bitmap=0x{bitmap:08x}  pressed bits={pressed_bits}  "
                  f"shift_up={shift_up}  shift_down={shift_down}")

    return {
        "shift_up":   shift_up,
        "shift_down": shift_down,
        "raw_bitmap": bitmap,
    }



# ---------------------------------------------------------------------------
# Characteristic discovery
# ---------------------------------------------------------------------------

def _discover_chars(client: BleakClient):
    """Find the best notify and write characteristic from connected client.

    Prefers Zwift-specific UUIDs, falls back to any notifiable characteristic.
    """
    notify_char = None
    write_char = None

    for svc in client.services:
        svc_uuid = svc.uuid.lower()
        is_zwift_svc = CLICK_SERVICE_UUID in svc_uuid or PLAY_SERVICE_UUID in svc_uuid or "fc82" in svc_uuid or "19ca4651" in svc_uuid.replace("-", "")

        for char in svc.characteristics:
            char_uuid = char.uuid.lower()
            props = char.properties

            # Prefer well-known Zwift UUIDs
            if char_uuid == ZWIFT_NOTIFY_UUID.lower() or char_uuid == "00000004-19ca-4651-86e5-fa29dcdd09d1":
                if "notify" in props or "indicate" in props:
                    notify_char = char.uuid
            if char_uuid == ZWIFT_WRITE_UUID.lower():
                if "write" in props or "write-without-response" in props:
                    write_char = char.uuid

            # Fallback: any notifiable char in a Zwift service
            if is_zwift_svc and notify_char is None:
                if "notify" in props or "indicate" in props:
                    notify_char = char.uuid
            if is_zwift_svc and write_char is None:
                if "write" in props or "write-without-response" in props:
                    write_char = char.uuid

    return notify_char, write_char


# ---------------------------------------------------------------------------
# Handshake helper
# ---------------------------------------------------------------------------

async def _send_rideon(client: BleakClient, write_uuid: str):
    """Send RideOn handshake, trying both response=True and False."""
    payload = b"RideOn"
    try:
        await client.write_gatt_char(write_uuid, payload, response=True)
        print(f"  [CTRL] RideOn sent (with response) to {write_uuid}")
        return
    except Exception as e1:
        print(f"  [CTRL] RideOn with response failed: {e1}")

    try:
        await client.write_gatt_char(write_uuid, payload, response=False)
        print(f"  [CTRL] RideOn sent (without response) to {write_uuid}")
    except Exception as e2:
        print(f"  [CTRL] RideOn without response also failed: {e2}")


# ---------------------------------------------------------------------------
# Click v2 connection
# ---------------------------------------------------------------------------

async def connect_click(address: str, gear_system):
    print(f"[CTRL] Connecting to Zwift Click v2 [{address}]...")

    prev = {"shift_up": False, "shift_down": False}

    async with BleakClient(address) as client:
        print(f"[CTRL] Connected. Enumerating ALL services...")

        # Discover ALL notifiable and writable characteristics
        notifiable = []
        writable = []
        for svc in client.services:
            svc_uuid = svc.uuid.lower()
            for char in svc.characteristics:
                props = char.properties
                if "notify" in props or "indicate" in props:
                    notifiable.append(char)
                    print(f"  [CTRL] Notifiable: {char.uuid}  [{','.join(props)}]  svc={svc_uuid[:8]}")
                if "write" in props or "write-without-response" in props:
                    writable.append(char)
                    print(f"  [CTRL] Writable:   {char.uuid}  [{','.join(props)}]  svc={svc_uuid[:8]}")

        if not notifiable:
            print("[CTRL] ERROR: No notifiable characteristic found.")
            return

        # Notification handler — shared across all subscriptions
        def on_notify(sender, data: bytearray):
            nonlocal prev
            raw = bytes(data)

            # Skip "RideOn" handshake echo
            if raw == b"RideOn":
                print(f"  [CTRL] RideOn echo received (handshake OK)")
                return

            # Always log raw data with sender UUID for debugging
            sender_uuid = str(sender.uuid) if hasattr(sender, 'uuid') else str(sender)
            print(f"  [CTRL] Notification from {sender_uuid} ({len(raw)}B): {raw.hex()}")

            # Try standard parser first
            buttons = parse_notification(raw, verbose=False)

            # Fallback: try scanning for inverted bitmap at any offset
            if buttons is None and len(raw) >= 4:
                for offset in range(len(raw) - 3):
                    bitmap = struct.unpack_from("<I", raw, offset)[0]
                    pressed = (~bitmap) & 0xFFFFFFFF
                    if 0 < pressed < 0x0000FFFF:  # reasonable button mask
                        shift_up = bool(pressed & MASK_SHIFT_UP)
                        shift_down = bool(pressed & MASK_SHIFT_DOWN)
                        if shift_up or shift_down:
                            pressed_bits = [i for i in range(32) if pressed & (1 << i)]
                            print(f"  [CTRL] Bitmap@{offset}: bits={pressed_bits} "
                                  f"shift_up={shift_up} shift_down={shift_down}")
                            buttons = {"shift_up": shift_up, "shift_down": shift_down, "raw_bitmap": bitmap}
                            break

            if buttons is None:
                return

            # Edge detection
            if buttons["shift_up"] and not prev["shift_up"]:
                print("[CTRL] → GEAR UP")
                gear_system.shift_up()
            if buttons["shift_down"] and not prev["shift_down"]:
                print("[CTRL] → GEAR DOWN")
                gear_system.shift_down()
            prev = {"shift_up": buttons["shift_up"], "shift_down": buttons["shift_down"]}

        # Subscribe to ALL notifiable characteristics
        for char in notifiable:
            try:
                await client.start_notify(char.uuid, on_notify)
                print(f"  [CTRL] ✓ Subscribed to {char.uuid}")
            except Exception as e:
                print(f"  [CTRL] ✗ Subscribe {char.uuid}: {e}")

        # Send RideOn handshake to ALL writable characteristics
        await asyncio.sleep(0.3)
        for char in writable:
            try:
                await client.write_gatt_char(char.uuid, b"RideOn", response=False)
                print(f"  [CTRL] ✓ RideOn sent to {char.uuid}")
            except Exception as e:
                print(f"  [CTRL] ✗ RideOn to {char.uuid}: {e}")

        print("[CTRL] Listening for buttons on ALL characteristics. Press + or - on the controller.")

        last_keepalive = time.time()
        while client.is_connected:
            await asyncio.sleep(1.0)
            now = time.time()
            if now - last_keepalive >= CONTROLLER_KEEPALIVE_S:
                last_keepalive = now
                for char in writable:
                    try:
                        await client.write_gatt_char(char.uuid, b"RideOn", response=False)
                        print(f"  [CTRL] keepalive RideOn sent to {char.uuid}")
                    except Exception as e:
                        print(f"  [CTRL] keepalive failed for {char.uuid}: {e}")

        print("[CTRL] Click v2 disconnected.")



# ---------------------------------------------------------------------------
# Zwift Play connection (encrypted)
# ---------------------------------------------------------------------------

async def connect_play(address: str, gear_system):
    """Connect to Zwift Play with X25519 encrypted handshake."""
    try:
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        from cryptography.hazmat.primitives.hashes import SHA256
        from cryptography.hazmat.primitives.ciphers.aead import AESCCM
    except ImportError:
        print("[CTRL] ERROR: 'cryptography' package required. Run: pip install cryptography")
        return

    print(f"[CTRL] Connecting to Zwift Play [{address}]...")

    private_key = X25519PrivateKey.generate()
    pub_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    # Handshake: "RideOn" + version bytes + 32-byte pub key + 32-byte padding
    handshake = b"RideOn\x01\x02" + pub_bytes + b"\x00" * 32

    aes_key = None
    prev = {"shift_up": False, "shift_down": False}
    handshake_response = asyncio.Event()
    device_pub_bytes_holder = [None]

    async with BleakClient(address) as client:
        print("[CTRL] Connected. Discovering characteristics...")
        notify_uuid, write_uuid = _discover_chars(client)
        print(f"[CTRL] notify={notify_uuid}  write={write_uuid}")

        def on_notify(sender, data: bytearray):
            nonlocal aes_key, prev
            raw = bytes(data)
            print(f"  [PLAY] raw ({len(raw)}B): {raw.hex()}")

            # Handshake response: "RideOn" prefix + device public key
            if raw.startswith(b"RideOn") and len(raw) >= 40:
                device_pub_bytes_holder[0] = raw[8:40]
                handshake_response.set()
                return

            if aes_key is None:
                print("  [PLAY] Encrypted data but no key yet — skipping")
                return

            if len(raw) < 5:
                return

            try:
                seq = struct.unpack_from("<I", raw, 0)[0]
                encrypted = raw[4:]
                nonce = struct.pack("<I", seq) + b"\x00" * 9
                aesccm = AESCCM(aes_key, tag_length=4)
                decrypted = aesccm.decrypt(nonce, encrypted, None)
                print(f"  [PLAY] decrypted: {decrypted.hex()}")

                buttons = parse_notification(decrypted, verbose=True)
                if buttons is None:
                    return
                if buttons["shift_up"] and not prev["shift_up"]:
                    print("[CTRL] → GEAR UP")
                    gear_system.shift_up()
                if buttons["shift_down"] and not prev["shift_down"]:
                    print("[CTRL] → GEAR DOWN")
                    gear_system.shift_down()
                prev = {"shift_up": buttons["shift_up"], "shift_down": buttons["shift_down"]}
            except Exception as e:
                print(f"  [PLAY] Decrypt error: {e}")

        if notify_uuid:
            await client.start_notify(notify_uuid, on_notify)

        if write_uuid:
            try:
                await client.write_gatt_char(write_uuid, handshake, response=True)
                print("[CTRL] Sent encrypted handshake")
            except Exception as e:
                print(f"[CTRL] Handshake write failed: {e}")
                return

        # Wait for device to send back its public key
        try:
            await asyncio.wait_for(handshake_response.wait(), timeout=5.0)
            dev_pub = device_pub_bytes_holder[0]
            if dev_pub:
                device_pub_key = X25519PublicKey.from_public_bytes(dev_pub)
                shared = private_key.exchange(device_pub_key)
                hkdf = HKDF(algorithm=SHA256(), length=16, salt=None, info=b"ZAP")
                aes_key = hkdf.derive(shared)
                print("[CTRL] ✓ Encryption key derived")
            else:
                print("[CTRL] No device public key received — buttons may not work")
        except asyncio.TimeoutError:
            print("[CTRL] Handshake response timeout — falling back to unencrypted")

        print("[CTRL] Listening for buttons...")
        last_keepalive = time.time()
        while client.is_connected:
            await asyncio.sleep(1.0)
            if write_uuid and time.time() - last_keepalive >= CONTROLLER_KEEPALIVE_S:
                last_keepalive = time.time()
                try:
                    await client.write_gatt_char(write_uuid, b"RideOn", response=False)
                    print("[PLAY] keepalive RideOn sent")
                except Exception as e:
                    print(f"[PLAY] keepalive failed: {e}")
        print("[CTRL] Play disconnected.")


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------

async def scan_for_controllers(timeout=10):
    """Scan and return list of (name, address, type)."""
    print(f"[CTRL] Scanning {timeout}s for controllers...")

    seen = {}

    def detection_callback(device, advertisement_data):
        seen[device.address] = (device, advertisement_data)

    async with BleakScanner(detection_callback=detection_callback):
        await asyncio.sleep(timeout)

    found = []
    for device, adv in seen.values():
        name = device.name or ""
        uuids_raw = [str(u).lower() for u in (adv.service_uuids or [])]
        uuids_joined = " ".join(uuids_raw)

        is_click = "fc82" in uuids_joined
        is_play  = PLAY_SERVICE_UUID in uuids_joined
        by_name  = any(kw in name.lower() for kw in ["zwift", "click", "play"])

        if is_click:
            found.append((name or "Zwift Click", device.address, "click"))
            print(f"  Found Click v2: {name} [{device.address}]")
        elif is_play:
            found.append((name or "Zwift Play", device.address, "play"))
            print(f"  Found Play: {name} [{device.address}]")
        elif by_name:
            ctype = "play" if "play" in name.lower() else "click"
            found.append((name, device.address, ctype))
            print(f"  Found (by name): {name} [{device.address}]")

    return found


async def connect_controller(controller_type: str, gear_system, timeout=10):
    """Scan and connect to the first Zwift controller found."""
    controllers = await scan_for_controllers(timeout=timeout)

    matching = [c for c in controllers if c[2] == controller_type]
    if not matching:
        matching = controllers  # try anything found

    if not matching:
        print("[CTRL] No controllers found. Make sure it's powered on and not paired elsewhere.")
        return

    name, address, ctype = matching[0]
    print(f"[CTRL] Using {ctype}: {name} [{address}]")

    if ctype == "play":
        await connect_play(address, gear_system)
    else:
        await connect_click(address, gear_system)
