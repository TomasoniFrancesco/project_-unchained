/**
 * BLE Manager — Web Bluetooth scan, connect, and device management.
 * Handles both FTMS smart trainers and BLE remote controllers (HID).
 */

import { state } from '../state.js';
import { FTMS_SERVICE, subscribeIndoorBikeData, getControlPoint, requestControl } from './ftms.js';

// ── BLE Service UUIDs ──────────────────────────────────────────────
const HID_SERVICE = '00001812-0000-1000-8000-00805f9b34fb';
const HID_REPORT  = '00002a4d-0000-1000-8000-00805f9b34fb';

// ── Controller button map storage key ─────────────────────────────
const MAP_KEY = 'fz_controller_map';

// ── Trainer state ──────────────────────────────────────────────────
let trainerDevice       = null;
let trainerServer       = null;
let trainerControlPoint = null;
let bikeDataChar        = null;
let onTrainerData       = null;

// ── Controller state ───────────────────────────────────────────────
let controllerDevice = null;
let controllerServer = null;

// ── Learn mode ────────────────────────────────────────────────────
let learnModeAction   = null;   // 'gearUp' | 'gearDown' | 'pause' | null
let learnModeCallback = null;   // called with { b0, b1 } when a button is pressed

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
//  BUTTON MAP — localStorage persistence
// ══════════════════════════════════════════════════════════════════

/**
 * Load saved button mappings from localStorage.
 * Returns { gearUp: {b0, b1}, gearDown: {b0, b1}, pause: {b0, b1} }
 * Any action that hasn't been mapped yet will be null.
 */
export function loadControllerMap() {
    try {
        return JSON.parse(localStorage.getItem(MAP_KEY)) || {};
    } catch {
        return {};
    }
}

/**
 * Save a single action's button signature to localStorage.
 */
export function saveButtonMapping(action, b0, b1) {
    const map = loadControllerMap();
    map[action] = { b0, b1 };
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
    console.log(`[BLE] Saved mapping: ${action} → [${b0}, ${b1}]`);
}

/**
 * Clear all saved button mappings.
 */
export function clearControllerMap() {
    localStorage.removeItem(MAP_KEY);
    console.log('[BLE] Controller map cleared');
}

/**
 * Start learn mode: the next button press on the controller will be
 * captured and saved as the mapping for `action`.
 *
 * @param {string}   action   - 'gearUp' | 'gearDown' | 'pause'
 * @param {function} callback - called with (b0, b1) when button is captured
 */
export function startLearnMode(action, callback) {
    learnModeAction   = action;
    learnModeCallback = callback;
    console.log(`[BLE] Learn mode started for: ${action}`);
}

export function cancelLearnMode() {
    learnModeAction   = null;
    learnModeCallback = null;
}

export function isLearning() {
    return learnModeAction !== null;
}

// ══════════════════════════════════════════════════════════════════
//  TRAINER
// ══════════════════════════════════════════════════════════════════

/**
 * Scan and connect to an FTMS smart trainer.
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
                power: 0, cadence: 0, speed: 0,
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
    trainerServer = null; trainerControlPoint = null;
    bikeDataChar  = null; trainerDevice = null;
}

// ══════════════════════════════════════════════════════════════════
//  CONTROLLER (BLE HID remote)
// ══════════════════════════════════════════════════════════════════

/**
 * Scan and connect to a BLE remote controller.
 * Subscribes to HID Report notifications and dispatches button events.
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
            learnModeAction  = null;
            learnModeCallback = null;
            state.update({ controller_status: 'disconnected', controller_name: '' });
        });

        controllerServer = await device.gatt.connect();
        console.log('[BLE] Controller GATT connected');

        let subscribed = false;
        try {
            const hidService = await controllerServer.getPrimaryService(HID_SERVICE);
            const reports    = await hidService.getCharacteristics(HID_REPORT);

            for (const report of reports) {
                try {
                    await report.startNotifications();
                    report.addEventListener('characteristicvaluechanged', (e) => {
                        handleControllerReport(e.target.value);
                    });
                    subscribed = true;
                    console.log('[BLE] Subscribed to HID report characteristic');
                } catch (_) { /* not all chars support notifications */ }
            }
        } catch (err) {
            console.warn('[BLE] HID service not available:', err.message);
        }

        if (!subscribed) {
            console.warn('[BLE] No HID notifications — controller connected but buttons may not work');
        }

        state.set('controller_status', 'connected');
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
 * Parse a raw HID report DataView.
 *
 * In LEARN MODE: capture the signature and save it, then call the learn callback.
 * In NORMAL MODE: compare against saved mappings and fire the matching action.
 */
function handleControllerReport(dataView) {
    if (dataView.byteLength === 0) return;

    const b0 = dataView.getUint8(0);
    const b1 = dataView.byteLength > 1 ? dataView.getUint8(1) : 0;

    // Ignore pure release events (all zeros)
    if (b0 === 0 && b1 === 0) return;

    console.log(`[BLE] Controller report: [${b0}, ${b1}]`);

    // ── LEARN MODE ──────────────────────────────────────────────
    if (learnModeAction !== null) {
        saveButtonMapping(learnModeAction, b0, b1);
        const cb = learnModeCallback;
        learnModeAction   = null;
        learnModeCallback = null;
        if (cb) cb(b0, b1);
        return;
    }

    // ── NORMAL MODE — match against saved map ───────────────────
    const map = loadControllerMap();
    for (const [action, sig] of Object.entries(map)) {
        if (sig && sig.b0 === b0 && sig.b1 === b1) {
            fire(action);
            return;
        }
    }

    // Nothing matched — log for debugging
    console.log('[BLE] No mapping for this button. Open Devices → Configure to map it.');
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
