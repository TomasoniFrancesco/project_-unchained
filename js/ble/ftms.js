/**
 * FTMS BLE protocol — Web Bluetooth implementation.
 * Port of fuckzwift/ble/ftms.py
 *
 * Handles:
 * - Indoor Bike Data notifications (power, cadence, speed)
 * - FTMS Control Point writes (simulation params)
 */

// FTMS Service & Characteristic UUIDs
const FTMS_SERVICE        = '00001826-0000-1000-8000-00805f9b34fb';
const INDOOR_BIKE_DATA    = '00002ad2-0000-1000-8000-00805f9b34fb';
const FTMS_CONTROL_POINT  = '00002ad9-0000-1000-8000-00805f9b34fb';

// FTMS control opcodes
const OP_REQUEST_CONTROL  = 0x00;
const OP_START            = 0x07;
const OP_STOP             = 0x08;
const OP_SET_SIM_PARAMS   = 0x11;

/**
 * Subscribe to Indoor Bike Data notifications.
 * @param {BluetoothRemoteGATTServer} server
 * @param {function({power, cadence, speed})} callback - Called on each data update
 * @returns {BluetoothRemoteGATTCharacteristic} The characteristic (for cleanup)
 */
export async function subscribeIndoorBikeData(server, callback) {
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const char = await service.getCharacteristic(INDOOR_BIKE_DATA);

    char.addEventListener('characteristicvaluechanged', (event) => {
        const data = parseIndoorBikeData(event.target.value);
        callback(data);
    });

    await char.startNotifications();
    console.log('[FTMS] Subscribed to Indoor Bike Data');
    return char;
}

/**
 * Parse Indoor Bike Data characteristic value.
 * Spec: GATT Specification Supplement, Section 4.10
 */
function parseIndoorBikeData(dataView) {
    const flags = dataView.getUint16(0, true);
    let offset = 2;

    const result = {
        speed: 0,      // km/h
        cadence: 0,    // rpm
        power: 0,      // watts
    };

    // Bit 0: More Data (if 0, Instantaneous Speed is present)
    if (!(flags & 0x0001)) {
        result.speed = dataView.getUint16(offset, true) / 100; // Unit: 0.01 km/h
        offset += 2;
    }

    // Bit 1: Average Speed
    if (flags & 0x0002) {
        offset += 2; // skip
    }

    // Bit 2: Instantaneous Cadence
    if (flags & 0x0004) {
        result.cadence = Math.round(dataView.getUint16(offset, true) / 2); // Unit: 0.5 rpm
        offset += 2;
    }

    // Bit 3: Average Cadence
    if (flags & 0x0008) {
        offset += 2; // skip
    }

    // Bit 4: Total Distance (3 bytes)
    if (flags & 0x0010) {
        offset += 3; // skip
    }

    // Bit 5: Resistance Level
    if (flags & 0x0020) {
        offset += 2; // skip
    }

    // Bit 6: Instantaneous Power
    if (flags & 0x0040) {
        result.power = dataView.getInt16(offset, true); // Watts (signed)
        offset += 2;
    }

    // Bit 7: Average Power
    if (flags & 0x0080) {
        offset += 2; // skip
    }

    return result;
}

/**
 * Get the FTMS Control Point characteristic.
 */
export async function getControlPoint(server) {
    const service = await server.getPrimaryService(FTMS_SERVICE);
    try {
        return await service.getCharacteristic(FTMS_CONTROL_POINT);
    } catch (e) {
        console.warn('[FTMS] Control Point not available:', e.message);
        return null;
    }
}

/**
 * Request control of the trainer.
 */
export async function requestControl(controlPoint) {
    if (!controlPoint) return;
    const buf = new Uint8Array([OP_REQUEST_CONTROL]);
    await controlPoint.writeValue(buf);
    console.log('[FTMS] Control requested');
}

/**
 * Set simulation parameters (grade).
 * @param {BluetoothRemoteGATTCharacteristic} controlPoint
 * @param {number} grade - Grade in percent (-40 to +40)
 */
export async function setSimulationParams(controlPoint, grade) {
    if (!controlPoint) return;

    const clampedGrade = Math.max(-40, Math.min(40, grade));
    // Grade: sint16, resolution 0.01%
    const gradeInt = Math.round(clampedGrade * 100);
    // Wind speed: 0 m/s
    // CRR: 0.004 (resolution 0.0001)
    // CW: 0.51 (resolution 0.01)

    const buf = new ArrayBuffer(7);
    const view = new DataView(buf);
    view.setUint8(0, OP_SET_SIM_PARAMS);
    view.setInt16(1, 0, true);          // Wind speed (0 m/s)
    view.setInt16(3, gradeInt, true);   // Grade
    view.setUint8(5, 40);              // CRR = 0.004
    view.setUint8(6, 51);              // CW = 0.51

    await controlPoint.writeValue(new Uint8Array(buf));
}

export { FTMS_SERVICE };
