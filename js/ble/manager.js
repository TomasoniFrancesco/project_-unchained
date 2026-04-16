/**
 * BLE Manager — Web Bluetooth scan, connect, and device management.
 * Handles both FTMS smart trainers and BLE remote controllers.
 *
 * Controllers: supports up to 2 simultaneous controllers.
 * Uses universal service discovery — works with HID and proprietary services.
 */

import { state } from '../state.js';
import { FTMS_SERVICE, subscribeIndoorBikeData, getControlPoint, requestControl } from './ftms.js';

// ── BLE Service UUIDs ──────────────────────────────────────────────
// NOTE: HID Service (0x1812) is BLOCKLISTED by Chrome's Web Bluetooth.
// We cannot filter by it or access it. We rely on universal discovery instead.

// localStorage key for user-defined custom service UUIDs
const CUSTOM_UUID_KEY = 'fz_custom_service_uuids';

/**
 * Build full 128-bit UUID from 16-bit short form.
 */
function uuid16(short) {
    return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

/**
 * Comprehensive list of non-blocklisted BLE services commonly found
 * on remote controllers, buttons, and cycling accessories.
 */
const KNOWN_CONTROLLER_SERVICES = [
    // ── Standard GATT services (non-blocklisted) ──
    uuid16('1800'),   // Generic Access
    uuid16('1801'),   // Generic Attribute
    uuid16('180a'),   // Device Information
    uuid16('180f'),   // Battery Service
    uuid16('1816'),   // Cycling Speed and Cadence
    uuid16('1818'),   // Cycling Power
    uuid16('1826'),   // Fitness Machine (FTMS)

    // ── Common proprietary services (0xFFxx range) ──
    uuid16('ff00'), uuid16('ff01'), uuid16('ff02'), uuid16('ff03'),
    uuid16('ff04'), uuid16('ff05'), uuid16('ff06'), uuid16('ff07'),
    uuid16('ff08'), uuid16('ff09'), uuid16('ff0a'), uuid16('ff0b'),
    uuid16('ff0c'), uuid16('ff0d'), uuid16('ff0e'), uuid16('ff0f'),
    uuid16('ff10'), uuid16('ff20'), uuid16('ff30'), uuid16('ff40'),
    uuid16('ff50'), uuid16('ff60'), uuid16('ff70'), uuid16('ff80'),
    uuid16('ff90'), uuid16('ffa0'), uuid16('ffb0'), uuid16('ffc0'),
    uuid16('ffd0'), uuid16('ffe0'), uuid16('fff0'),
    uuid16('fff1'), uuid16('fff2'), uuid16('fff3'), uuid16('fff4'),
    uuid16('fff5'), uuid16('fff6'), uuid16('fff7'), uuid16('fff8'),
    uuid16('fff9'), uuid16('fffa'), uuid16('fffb'), uuid16('fffc'),
    uuid16('fffd'), uuid16('fffe'),

    // ── Common proprietary services (0xFExx range — Bluetooth SIG members) ──
    uuid16('fee0'), uuid16('fee1'), uuid16('fee2'), uuid16('fee3'),
    uuid16('fee4'), uuid16('fee5'), uuid16('fee6'), uuid16('fee7'),
    uuid16('fee8'), uuid16('fee9'), uuid16('feea'), uuid16('feeb'),
    uuid16('feec'), uuid16('feed'), uuid16('feee'), uuid16('feef'),
    uuid16('fef0'), uuid16('fef1'), uuid16('fef2'), uuid16('fef3'),
    uuid16('fef4'), uuid16('fef5'),

    // ── Common proprietary (cycling remotes like Tacx, Wahoo, Elite) ──
    uuid16('fd00'), uuid16('fd01'), uuid16('fd02'),
    uuid16('fc00'), uuid16('fc01'), uuid16('fc02'),
    uuid16('fb00'), uuid16('fb01'), uuid16('fb02'),
    uuid16('fa00'), uuid16('fa01'), uuid16('fa02'),
    uuid16('6e40'),  // Nordic UART Service (short form)
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',  // Nordic UART Service (full)
];

// ── Controller button map storage key ─────────────────────────────
const MAP_KEY = 'fz_controller_map';

// ── Trainer state ──────────────────────────────────────────────────
let trainerDevice       = null;
let trainerServer       = null;
let trainerControlPoint = null;
let bikeDataChar        = null;
let onTrainerData       = null;

// ── Controllers state (2 slots) ───────────────────────────────────
const controllers = [
    { device: null, server: null, name: '', status: 'disconnected' },  // slot 0 → controller_1
    { device: null, server: null, name: '', status: 'disconnected' },  // slot 1 → controller_2
];

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
 * Start learn mode: the next button press on any controller will be
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
//  CONTROLLER (BLE remote — up to 2 simultaneous)
// ══════════════════════════════════════════════════════════════════

/**
 * Find the next free controller slot (0 or 1). Returns -1 if both occupied.
 */
function findFreeSlot() {
    for (let i = 0; i < controllers.length; i++) {
        if (!controllers[i].server || !controllers[i].server.connected) return i;
    }
    return -1;
}

/**
 * Sync a controller slot's state to the reactive AppState.
 */
function syncControllerState(slot) {
    const c = controllers[slot];
    const n = slot + 1; // 1-indexed for UI
    state.update({
        [`controller_${n}_status`]: c.status,
        [`controller_${n}_name`]:   c.name,
    });
}

/**
 * Load user-defined custom service UUIDs from localStorage.
 */
export function loadCustomServiceUUIDs() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_UUID_KEY)) || [];
    } catch {
        return [];
    }
}

/**
 * Save a custom service UUID to localStorage.
 */
export function addCustomServiceUUID(uuid) {
    const uuids = loadCustomServiceUUIDs();
    const normalized = uuid.toLowerCase().trim();
    if (!uuids.includes(normalized)) {
        uuids.push(normalized);
        localStorage.setItem(CUSTOM_UUID_KEY, JSON.stringify(uuids));
        console.log(`[BLE] Added custom service UUID: ${normalized}`);
    }
    return uuids;
}

/**
 * Remove a custom service UUID from localStorage.
 */
export function removeCustomServiceUUID(uuid) {
    let uuids = loadCustomServiceUUIDs();
    uuids = uuids.filter(u => u !== uuid.toLowerCase().trim());
    localStorage.setItem(CUSTOM_UUID_KEY, JSON.stringify(uuids));
    return uuids;
}

/**
 * Build the full optionalServices list including user custom UUIDs.
 */
function buildOptionalServices() {
    const custom = loadCustomServiceUUIDs();
    return [...KNOWN_CONTROLLER_SERVICES, ...custom];
}

/**
 * Scan and connect to a BLE remote controller.
 *
 * Both modes use acceptAllDevices — Chrome blocklists HID so we can't filter by it.
 * 'filtered' mode uses name-prefix filters for known controller names.
 * 'all' mode shows all BLE devices.
 *
 * @param {'filtered'|'all'} mode
 * @returns {object|null} The connected device or null.
 */
export async function scanAndConnectController(mode = 'all') {
    const slot = findFreeSlot();
    if (slot === -1) {
        console.warn('[BLE] Both controller slots are occupied. Disconnect one first.');
        return null;
    }

    const n = slot + 1;
    state.set(`controller_${n}_status`, 'scanning');

    try {
        const optionalServices = buildOptionalServices();

        let requestOptions;
        if (mode === 'filtered') {
            // Filter by common controller name prefixes
            requestOptions = {
                filters: [
                    { namePrefix: 'Remote' },
                    { namePrefix: 'Controller' },
                    { namePrefix: 'Tacx' },
                    { namePrefix: 'Wahoo' },
                    { namePrefix: 'Elite' },
                    { namePrefix: 'KICKR' },
                    { namePrefix: 'Shutter' },
                    { namePrefix: 'AB Shutter' },
                    { namePrefix: 'iTAG' },
                    { namePrefix: 'Bluetooth' },
                    { namePrefix: 'BT' },
                    { namePrefix: 'Gamepad' },
                    { namePrefix: 'Media' },
                ],
                optionalServices,
            };
        } else {
            requestOptions = {
                acceptAllDevices: true,
                optionalServices,
            };
        }

        const device = await navigator.bluetooth.requestDevice(requestOptions);

        const ctrl = controllers[slot];
        ctrl.device = device;
        ctrl.name   = device.name || `Controller ${n}`;
        ctrl.status = 'connecting';
        syncControllerState(slot);

        console.log(`[BLE] Controller ${n} selected: ${device.name}`);

        device.addEventListener('gattserverdisconnected', () => {
            console.log(`[BLE] Controller ${n} disconnected`);
            ctrl.server = null;
            ctrl.status = 'disconnected';
            ctrl.name   = '';
            syncControllerState(slot);
        });

        ctrl.server = await device.gatt.connect();
        console.log(`[BLE] Controller ${n} GATT connected`);

        // ── Universal service discovery ─────────────────────────
        // Enumerate ALL accessible services and subscribe to every
        // characteristic that supports notifications.
        let subscribed = false;

        try {
            const services = await ctrl.server.getPrimaryServices();
            console.log(`[BLE] Controller ${n}: found ${services.length} service(s)`);

            for (const service of services) {
                try {
                    const chars = await service.getCharacteristics();
                    for (const char of chars) {
                        if (char.properties.notify || char.properties.indicate) {
                            try {
                                await char.startNotifications();
                                char.addEventListener('characteristicvaluechanged', (e) => {
                                    handleControllerReport(e.target.value);
                                });
                                subscribed = true;
                                console.log(`[BLE] Controller ${n}: subscribed to ${service.uuid} / ${char.uuid}`);
                            } catch (_) { /* skip */ }
                        }
                    }
                } catch (_) { /* skip inaccessible service */ }
            }
        } catch (err) {
            console.warn(`[BLE] Controller ${n}: service discovery failed:`, err.message);
        }

        if (!subscribed) {
            console.warn(`[BLE] Controller ${n}: no notifiable characteristics found — buttons won't work.`);
            console.warn('[BLE] Try adding your controller\'s service UUID in the custom UUID field.');
        }

        ctrl.status = 'connected';
        syncControllerState(slot);
        console.log(`[BLE] Controller ${n} fully connected (slot ${slot}), subscribed: ${subscribed}`);
        return { device, slot };

    } catch (err) {
        state.set(`controller_${slot + 1}_status`, 'disconnected');
        if (err.name === 'NotFoundError') {
            console.log('[BLE] Controller selection cancelled');
        } else {
            console.error('[BLE] Controller connection failed:', err);
        }
        return null;
    }
}

/**
 * Parse a raw report DataView from any controller.
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

/**
 * Check if at least one controller is connected.
 */
export function isControllerConnected() {
    return controllers.some(c => c.server !== null && c.server.connected);
}

/**
 * Get controller info for a given slot (0 or 1).
 */
export function getControllerInfo(slot) {
    const c = controllers[slot];
    return {
        name:      c.name,
        status:    c.status,
        connected: c.server !== null && c.server.connected,
    };
}

/**
 * Disconnect a specific controller by slot (0 or 1).
 */
export function disconnectController(slot) {
    if (slot === undefined) {
        // Disconnect all
        controllers.forEach((_, i) => disconnectController(i));
        return;
    }
    const c = controllers[slot];
    if (c.server && c.server.connected) c.server.disconnect();
    c.server = null;
    c.device = null;
    c.name   = '';
    c.status = 'disconnected';
    syncControllerState(slot);
}

// ══════════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════════

export function isWebBluetoothAvailable() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}
