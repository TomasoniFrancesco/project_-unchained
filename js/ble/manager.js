/**
 * BLE Manager — Web Bluetooth scan, connect, and device management.
 * Handles both FTMS smart trainers and BLE remote controllers.
 *
 * Controllers: supports up to 2 simultaneous controllers.
 * Uses universal service discovery — works with any BLE service.
 */

import { state } from '../state.js';
import { FTMS_SERVICE, subscribeIndoorBikeData, getControlPoint, requestControl } from './ftms.js';

// ── BLE Service UUIDs ──────────────────────────────────────────────
// NOTE: HID Service (0x1812) is BLOCKLISTED by Chrome's Web Bluetooth.
// We rely on universal service discovery instead.

// localStorage keys
const CUSTOM_UUID_KEY = 'fz_custom_service_uuids';
const MAP_KEY         = 'fz_controller_map';

/**
 * Build full 128-bit UUID from 16-bit short form.
 */
function uuid16(short) {
    return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

/**
 * Comprehensive list of non-blocklisted BLE services.
 */
const KNOWN_CONTROLLER_SERVICES = [
    uuid16('1800'), uuid16('1801'), uuid16('180a'), uuid16('180f'),
    uuid16('1816'), uuid16('1818'), uuid16('1826'),
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
    uuid16('fee0'), uuid16('fee1'), uuid16('fee2'), uuid16('fee3'),
    uuid16('fee4'), uuid16('fee5'), uuid16('fee6'), uuid16('fee7'),
    uuid16('fee8'), uuid16('fee9'), uuid16('feea'), uuid16('feeb'),
    uuid16('feec'), uuid16('feed'), uuid16('feee'), uuid16('feef'),
    uuid16('fef0'), uuid16('fef1'), uuid16('fef2'), uuid16('fef3'),
    uuid16('fef4'), uuid16('fef5'),
    uuid16('fd00'), uuid16('fd01'), uuid16('fd02'),
    uuid16('fc00'), uuid16('fc01'), uuid16('fc02'),
    uuid16('fb00'), uuid16('fb01'), uuid16('fb02'),
    uuid16('fa00'), uuid16('fa01'), uuid16('fa02'),
    uuid16('6e40'),
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

// ── Trainer state ──────────────────────────────────────────────────
let trainerDevice       = null;
let trainerServer       = null;
let trainerControlPoint = null;
let bikeDataChar        = null;
let onTrainerData       = null;

// ── Controllers state (2 slots) ───────────────────────────────────
const controllers = [
    { device: null, server: null, name: '', status: 'disconnected' },
    { device: null, server: null, name: '', status: 'disconnected' },
];

// ── Learn mode ────────────────────────────────────────────────────
let learnModeAction   = null;
let learnModeCallback = null;

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
//  BUTTON MAP
// ══════════════════════════════════════════════════════════════════

function dataViewToBytes(dataView) {
    const bytes = [];
    for (let i = 0; i < dataView.byteLength; i++) {
        bytes.push(dataView.getUint8(i));
    }
    return bytes;
}

export function loadControllerMap() {
    try {
        return JSON.parse(localStorage.getItem(MAP_KEY)) || {};
    } catch {
        return {};
    }
}

export function saveButtonMapping(action, bytes) {
    const map = loadControllerMap();
    map[action] = { bytes };
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
    console.log(`[BLE] Saved mapping: ${action} → [${bytes.join(', ')}]`);
}

export function clearControllerMap() {
    localStorage.removeItem(MAP_KEY);
    console.log('[BLE] Controller map cleared');
}

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
//  CUSTOM SERVICE UUIDs
// ══════════════════════════════════════════════════════════════════

export function loadCustomServiceUUIDs() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_UUID_KEY)) || [];
    } catch {
        return [];
    }
}

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

export function removeCustomServiceUUID(uuid) {
    let uuids = loadCustomServiceUUIDs();
    uuids = uuids.filter(u => u !== uuid.toLowerCase().trim());
    localStorage.setItem(CUSTOM_UUID_KEY, JSON.stringify(uuids));
    return uuids;
}

function buildOptionalServices() {
    const custom = loadCustomServiceUUIDs();
    return [...KNOWN_CONTROLLER_SERVICES, ...custom];
}

// ══════════════════════════════════════════════════════════════════
//  TRAINER
// ══════════════════════════════════════════════════════════════════

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

function findFreeSlot() {
    for (let i = 0; i < controllers.length; i++) {
        if (!controllers[i].server || !controllers[i].server.connected) return i;
    }
    return -1;
}

function syncControllerState(slot) {
    const c = controllers[slot];
    const n = slot + 1;
    state.update({
        [`controller_${n}_status`]: c.status,
        [`controller_${n}_name`]:   c.name,
    });
}

/**
 * Subscribe to all notifiable characteristics on a connected GATT server.
 */
async function subscribeAllNotifiable(server, label) {
    let subscribed = false;
    try {
        const services = await server.getPrimaryServices();
        console.log(`[BLE] ${label}: found ${services.length} service(s)`);

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
                            console.log(`[BLE] ${label}: subscribed ${service.uuid} / ${char.uuid}`);
                        } catch (_) { /* skip */ }
                    }
                }
            } catch (_) { /* skip */ }
        }
    } catch (err) {
        console.warn(`[BLE] ${label}: discovery failed:`, err.message);
    }
    return subscribed;
}

/**
 * Scan and connect to a BLE remote controller.
 * Connection lives in current page context — no persistence across pages.
 * Both connect.html and ride.html can initiate connections.
 */
export async function scanAndConnectController(mode = 'all') {
    const slot = findFreeSlot();
    if (slot === -1) {
        console.warn('[BLE] Both controller slots occupied.');
        return null;
    }

    const n = slot + 1;
    state.set(`controller_${n}_status`, 'scanning');

    try {
        const optionalServices = buildOptionalServices();

        let requestOptions;
        if (mode === 'filtered') {
            requestOptions = {
                filters: [
                    { namePrefix: 'Zwift' },
                    { namePrefix: 'Remote' },
                    { namePrefix: 'Controller' },
                    { namePrefix: 'Tacx' },
                    { namePrefix: 'Wahoo' },
                    { namePrefix: 'Elite' },
                    { namePrefix: 'KICKR' },
                    { namePrefix: 'Shutter' },
                    { namePrefix: 'AB Shutter' },
                    { namePrefix: 'iTAG' },
                    { namePrefix: 'BT' },
                    { namePrefix: 'Gamepad' },
                    { namePrefix: 'Media' },
                    { namePrefix: 'Click' },
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

        const subscribed = await subscribeAllNotifiable(ctrl.server, `Controller ${n}`);

        if (!subscribed) {
            console.warn(`[BLE] Controller ${n}: no notifiable characteristics — buttons won't work.`);
        }

        ctrl.status = 'connected';
        syncControllerState(slot);
        console.log(`[BLE] Controller ${n} ready (subscribed: ${subscribed})`);
        return { device, slot };

    } catch (err) {
        state.set(`controller_${slot + 1}_status`, 'disconnected');
        if (err.name === 'NotFoundError') {
            console.log('[BLE] Controller scan cancelled');
        } else {
            console.error('[BLE] Controller connection failed:', err);
        }
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
//  CONTROLLER REPORT HANDLER
// ══════════════════════════════════════════════════════════════════

function handleControllerReport(dataView) {
    if (dataView.byteLength === 0) return;

    const bytes = dataViewToBytes(dataView);
    if (bytes.every(b => b === 0)) return;

    console.log(`[BLE] Report: [${bytes.join(', ')}]`);

    // ── LEARN MODE ──
    if (learnModeAction !== null) {
        saveButtonMapping(learnModeAction, bytes);
        const cb = learnModeCallback;
        learnModeAction   = null;
        learnModeCallback = null;
        if (cb) cb(bytes);
        return;
    }

    // ── NORMAL MODE — match saved mappings ──
    const map = loadControllerMap();
    for (const [action, sig] of Object.entries(map)) {
        if (sig && sig.bytes && arraysEqual(sig.bytes, bytes)) {
            fire(action);
            return;
        }
        // Legacy support (old b0/b1 format)
        if (sig && sig.b0 !== undefined) {
            if (sig.b0 === bytes[0] && sig.b1 === (bytes[1] || 0)) {
                fire(action);
                return;
            }
        }
    }

    console.log('[BLE] No mapping for this button.');
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function fire(action) {
    if (controllerCallbacks[action]) {
        controllerCallbacks[action]();
        console.log(`[BLE] → ${action}`);
    } else {
        console.log(`[BLE] Action "${action}" matched but no callback set (not on ride page?)`);
    }
}

// ══════════════════════════════════════════════════════════════════
//  STATUS & DISCONNECT
// ══════════════════════════════════════════════════════════════════

export function isControllerConnected() {
    return controllers.some(c => c.server !== null && c.server.connected);
}

export function getControllerInfo(slot) {
    const c = controllers[slot];
    return {
        name:      c.name,
        status:    c.status,
        connected: c.server !== null && c.server.connected,
    };
}

export function disconnectController(slot) {
    if (slot === undefined) {
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
