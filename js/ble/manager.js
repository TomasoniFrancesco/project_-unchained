/**
 * BLE Manager — Web Bluetooth scan, connect, and device management.
 * Handles both FTMS smart trainers and BLE remote controllers (HID).
 */

import { state } from '../state.js';
import { FTMS_SERVICE, subscribeIndoorBikeData, getControlPoint, requestControl } from './ftms.js';

// ── BLE Service UUIDs ──────────────────────────────────────────────
const HID_SERVICE = '00001812-0000-1000-8000-00805f9b34fb';
const HID_REPORT  = '00002a4d-0000-1000-8000-00805f9b34fb';

// ── Trainer state ──────────────────────────────────────────────────
let trainerDevice       = null;
let trainerServer       = null;
let trainerControlPoint = null;
let bikeDataChar        = null;
let onTrainerData       = null;

// ── Controller state ───────────────────────────────────────────────
let controllerDevice = null;
let controllerServer = null;

// ── Controller action callbacks (set by ride.html) ─────────────────
const controllerCallbacks = {
    gearUp:   null,
    gearDown: null,
    pause:    null,
};

export function setControllerCallbacks(cb) {
    Object.assign(controllerCallbacks, cb);
}

// ══════════════════════════════════════════════════════════════════
//  TRAINER
// ══════════════════════════════════════════════════════════════════

/**
 * Scan and connect to an FTMS smart trainer.
 * Requires a user gesture — call from a button click handler.
 */
export async function scanAndConnectTrainer(dataCallback) {
    onTrainerData = dataCallback;
    state.set('scanning', true);

    try {
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [FTMS_SERVICE],
        });

        trainerDevice = device;
        state.update({
            scanning:       false,
            trainer_name:   device.name || 'Smart Trainer',
            trainer_status: 'connecting',
        });

        console.log(`[BLE] Trainer selected: ${device.name}`);

        device.addEventListener('gattserverdisconnected', () => {
            console.log('[BLE] Trainer disconnected');
            trainerServer       = null;
            trainerControlPoint = null;
            bikeDataChar        = null;
            state.update({
                trainer_status: 'disconnected',
                trainer_name:   '',
                power:   0,
                cadence: 0,
                speed:   0,
            });
        });

        trainerServer = await device.gatt.connect();
        console.log('[BLE] Trainer GATT connected');

        bikeDataChar = await subscribeIndoorBikeData(trainerServer, (data) => {
            state.update({ power: data.power, cadence: data.cadence, speed: data.speed });
            if (onTrainerData) onTrainerData(data);
        });

        trainerControlPoint = await getControlPoint(trainerServer);
        if (trainerControlPoint) await requestControl(trainerControlPoint);

        state.set('trainer_status', 'connected');
        console.log('[BLE] Trainer fully connected');

        return device;

    } catch (err) {
        state.set('scanning', false);
        if (err.name === 'NotFoundError') {
            console.log('[BLE] Trainer selection cancelled');
        } else {
            console.error('[BLE] Trainer connection failed:', err);
            state.set('trainer_status', 'disconnected');
        }
        return null;
    }
}

/**
 * Send simulation parameters (grade) to the connected trainer.
 */
export async function sendSimulationParams(grade) {
    if (!trainerControlPoint) return;
    try {
        const { setSimulationParams } = await import('./ftms.js');
        await setSimulationParams(trainerControlPoint, grade);
    } catch (err) {
        console.warn('[BLE] Failed to send simulation params:', err.message);
    }
}

export function isTrainerConnected() {
    return trainerServer !== null && trainerServer.connected;
}

export function disconnectTrainer() {
    if (trainerServer && trainerServer.connected) trainerServer.disconnect();
    trainerServer       = null;
    trainerControlPoint = null;
    bikeDataChar        = null;
    trainerDevice       = null;
}

// ══════════════════════════════════════════════════════════════════
//  CONTROLLER (BLE HID remote)
// ══════════════════════════════════════════════════════════════════

/**
 * Scan and connect to a BLE remote controller.
 * Tries to subscribe to HID Report notifications and maps button bytes
 * to gear shift / pause actions.
 */
export async function scanAndConnectController() {
    state.set('controller_scanning', true);

    try {
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [HID_SERVICE, FTMS_SERVICE],
        });

        controllerDevice = device;
        state.update({
            controller_scanning: false,
            controller_name:     device.name || 'Remote Controller',
            controller_status:   'connecting',
        });

        console.log(`[BLE] Controller selected: ${device.name}`);

        device.addEventListener('gattserverdisconnected', () => {
            console.log('[BLE] Controller disconnected');
            controllerServer = null;
            state.update({
                controller_status: 'disconnected',
                controller_name:   '',
            });
        });

        controllerServer = await device.gatt.connect();
        console.log('[BLE] Controller GATT connected');

        // Try to subscribe to HID notifications
        let subscribed = false;
        try {
            const hidService = await controllerServer.getPrimaryService(HID_SERVICE);
            const reports = await hidService.getCharacteristics(HID_REPORT);

            for (const report of reports) {
                try {
                    await report.startNotifications();
                    report.addEventListener('characteristicvaluechanged', (e) => {
                        handleControllerReport(e.target.value);
                    });
                    subscribed = true;
                    console.log('[BLE] Subscribed to HID report');
                } catch (_) { /* not all report chars are notifiable */ }
            }
        } catch (err) {
            console.warn('[BLE] HID service not found on controller:', err.message);
        }

        if (!subscribed) {
            console.warn('[BLE] No HID notifications available — controller connected but no button events');
        }

        state.set('controller_status', 'connected');
        console.log('[BLE] Controller ready');

        return device;

    } catch (err) {
        state.set('controller_scanning', false);
        if (err.name === 'NotFoundError') {
            console.log('[BLE] Controller selection cancelled');
        } else {
            console.error('[BLE] Controller connection failed:', err);
            state.set('controller_status', 'disconnected');
        }
        return null;
    }
}

/**
 * Parse a raw HID report and fire the appropriate action.
 *
 * Most BLE cycling remotes send a 1–4 byte report:
 *   byte[0] = modifier / consumer page
 *   byte[1] = key / button code
 *
 * Common mappings (expand as needed for specific hardware):
 *   0x00 / 0xB5 → Next track  → Gear Up
 *   0x00 / 0xB6 → Prev track  → Gear Down
 *   0x00 / 0xCD → Play/Pause  → Pause ride
 *   0x01        (any)         → Button 1 → Gear Up
 *   0x02        (any)         → Button 2 → Gear Down
 */
function handleControllerReport(dataView) {
    if (dataView.byteLength === 0) return;

    const b0 = dataView.getUint8(0);
    const b1 = dataView.byteLength > 1 ? dataView.getUint8(1) : 0;

    console.log(`[BLE] Controller report: [${b0}, ${b1}]`);

    // Consumer control codes (common for media remotes)
    if (b1 === 0xB5 || b0 === 0x01) { fire('gearUp');   return; }
    if (b1 === 0xB6 || b0 === 0x02) { fire('gearDown'); return; }
    if (b1 === 0xCD || b0 === 0x04) { fire('pause');    return; }

    // Fallback: any non-zero b0 alternates gear up/down
    if (b0 !== 0) fire('gearUp');
}

function fire(action) {
    if (controllerCallbacks[action]) {
        controllerCallbacks[action]();
        console.log(`[BLE] Controller action: ${action}`);
    }
}

export function isControllerConnected() {
    return controllerServer !== null && controllerServer.connected;
}

export function disconnectController() {
    if (controllerServer && controllerServer.connected) controllerServer.disconnect();
    controllerServer = null;
    controllerDevice = null;
}

// ══════════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════════

export function isWebBluetoothAvailable() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}
