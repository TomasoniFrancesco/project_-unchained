/**
 * BLE Manager — Web Bluetooth scan, connect, and device management.
 * Handles both FTMS smart trainers and BLE remote controllers.
 *
 * Controllers: supports up to 2 simultaneous controllers.
 * Uses universal service discovery — works with any BLE service.
 */

import { state } from '../state.js';
import {
    FTMS_SERVICE,
    subscribeIndoorBikeData,
    getControlPoint,
    requestControl,
    resetToSimMode,
    startWorkout,
    stopWorkout,
    setSimulationParams,
} from './ftms.js';
import { ControllerDevice } from './controller-device.js';
import { virtualController } from '../controllers/virtual-controller.js';

// ── BLE Service UUIDs ──────────────────────────────────────────────
// NOTE: HID Service (0x1812) is BLOCKLISTED by Chrome's Web Bluetooth.
// We rely on universal service discovery instead.

// localStorage keys
const CUSTOM_UUID_KEY = 'fz_custom_service_uuids';
const MAP_KEY         = 'fz_controller_map';
const textEncoder     = new TextEncoder();

const CLICK_SERVICE_UUID   = uuid16('fc82');
const PLAY_SERVICE_UUID    = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const PLAY_NOTIFY_UUID     = '00000002-19ca-4651-86e5-fa29dcdd09d1';
const PLAY_WRITE_UUID      = '00000003-19ca-4651-86e5-fa29dcdd09d1';
const PLAY_ALT_NOTIFY_UUID = '00000004-19ca-4651-86e5-fa29dcdd09d1';

const GENERIC_ACCESS_SERVICE   = uuid16('1800');
const GENERIC_ATTRIBUTE_SERVICE = uuid16('1801');
const DEVICE_INFO_SERVICE      = uuid16('180a');
const BATTERY_SERVICE          = uuid16('180f');
const BATTERY_LEVEL_CHAR       = uuid16('2a19');
const DEVICE_NAME_CHAR         = uuid16('2a00');
const APPEARANCE_CHAR          = uuid16('2a01');

const IGNORED_CONTROLLER_SERVICES = new Set([
    GENERIC_ACCESS_SERVICE,
    GENERIC_ATTRIBUTE_SERVICE,
    DEVICE_INFO_SERVICE,
    BATTERY_SERVICE,
]);

const IGNORED_CONTROLLER_CHARACTERISTICS = new Set([
    BATTERY_LEVEL_CHAR,
    DEVICE_NAME_CHAR,
    APPEARANCE_CHAR,
]);

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
    CLICK_SERVICE_UUID,
    PLAY_SERVICE_UUID,
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
// Status FSM: disconnected → scanning → connecting → verifying → ready | degraded
const controllers = [
    { device: null, server: null, id: '', name: '', status: 'disconnected', subscriptions: [], writableChannels: [], inputReady: false, issue: '', heartbeatId: null },
    { device: null, server: null, id: '', name: '', status: 'disconnected', subscriptions: [], writableChannels: [], inputReady: false, issue: '', heartbeatId: null },
];
const controllerDevices = controllers.map((ctrl, slot) => new ControllerDevice(slot, ctrl));

// Slot mutex — prevents concurrent allocation races
const slotLocked = [false, false];

// ── Learn mode ────────────────────────────────────────────────────
let learnModeAction   = null;
let learnModeCallback = null;
let learnModeStartedAt = 0;
let learnModeBaselines = new Map();

const LEARN_BASELINE_WINDOW_MS = 350;

// ── Normalized controller reports ─────────────────────────────────
// Keeps the current 2-slot model, but routes reports through a small
// event target so aggregation can subscribe here.
const controllerReportEvents = new EventTarget();

// ── Controller action callbacks (set by ride.html) ─────────────────
const controllerCallbacks = {
    gearUp:   null,
    gearDown: null,
    pause:    null,
};

export function setControllerCallbacks(cb) {
    Object.assign(controllerCallbacks, cb);
}

export function addControllerReportListener(listener) {
    controllerReportEvents.addEventListener('controllerreport', listener);
}

export function removeControllerReportListener(listener) {
    controllerReportEvents.removeEventListener('controllerreport', listener);
}

function emitControllerReportEvent(detail) {
    controllerReportEvents.dispatchEvent(new CustomEvent('controllerreport', { detail }));
}

controllerReportEvents.addEventListener('controllerreport', (event) => {
    dispatchControllerAction(event.detail);
});

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

function normalizeUuid(uuid) {
    return String(uuid || '').toLowerCase();
}

function shortUuid(uuid) {
    return normalizeUuid(uuid).slice(0, 8) || 'unknown';
}

function mappingsEqual(a, b) {
    if (!arraysEqual(a?.bytes || [], b?.bytes || [])) return false;

    const aDeviceId = a?.deviceId || '';
    const bDeviceId = b?.deviceId || '';
    if (aDeviceId && bDeviceId && aDeviceId !== bDeviceId) return false;

    const aHasSource = !!(a?.serviceUuid || a?.charUuid);
    const bHasSource = !!(b?.serviceUuid || b?.charUuid);
    if (!aHasSource || !bHasSource) return true;

    return normalizeUuid(a?.serviceUuid) === normalizeUuid(b?.serviceUuid)
        && normalizeUuid(a?.charUuid) === normalizeUuid(b?.charUuid);
}

export function saveButtonMapping(action, bytes, source = null) {
    const map = loadControllerMap();
    const nextMapping = {
        action,
        ...(source?.deviceId ? { deviceId: source.deviceId } : {}),
        ...(source?.assignment ? { assignment: source.assignment } : {}),
        bytes: Array.from(bytes),
        ...(source?.serviceUuid ? { serviceUuid: normalizeUuid(source.serviceUuid) } : {}),
        ...(source?.charUuid ? { charUuid: normalizeUuid(source.charUuid) } : {}),
    };

    for (const [otherAction, existing] of Object.entries(map)) {
        if (otherAction !== action && mappingsEqual(existing, nextMapping)) {
            console.warn(`[BLE] Refusing duplicate mapping: ${action} matches ${otherAction}`);
            return { ok: false, conflictAction: otherAction, mapping: nextMapping };
        }
    }

    map[action] = nextMapping;
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
    const deviceTag = nextMapping.deviceId ? `${String(nextMapping.deviceId).slice(-8)} / ` : '';
    console.log(`[BLE] Saved mapping: ${action} → [${bytes.join(', ')}] (${deviceTag}${shortUuid(nextMapping.serviceUuid)} / ${shortUuid(nextMapping.charUuid)})`);
    return { ok: true, mapping: nextMapping };
}

export function clearControllerMap() {
    localStorage.removeItem(MAP_KEY);
    console.log('[BLE] Controller map cleared');
}

export function startLearnMode(action, callback) {
    learnModeAction   = action;
    learnModeCallback = callback;
    learnModeStartedAt = Date.now();
    learnModeBaselines = new Map();
    console.log(`[BLE] Learn mode started for: ${action}`);
}

export function cancelLearnMode() {
    learnModeAction   = null;
    learnModeCallback = null;
    learnModeStartedAt = 0;
    learnModeBaselines = new Map();
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
    return [...new Set([...KNOWN_CONTROLLER_SERVICES, ...custom])];
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
        if (trainerControlPoint) {
            await requestControl(trainerControlPoint);
            await resetToSimMode(trainerControlPoint);
            await startWorkout(trainerControlPoint);
            await setSimulationParams(trainerControlPoint, 0);
        }

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

let _lastSentGrade = null;
let _simWriteInProgress = false;
let _lastSimWriteTime = 0;
const SIM_WRITE_MIN_INTERVAL_MS = 500; // max 2 Hz FTMS writes

export async function sendSimulationParams(grade) {
    if (!trainerControlPoint) return;

    // Round to 0.01% to avoid micro-jitter writes
    const roundedGrade = Math.round(grade * 100) / 100;

    // Skip if grade hasn't changed
    if (roundedGrade === _lastSentGrade) return;

    // Throttle: don't write faster than 2 Hz
    const now = performance.now();
    if ((now - _lastSimWriteTime) < SIM_WRITE_MIN_INTERVAL_MS) return;

    // Prevent concurrent GATT writes
    if (_simWriteInProgress) return;

    _simWriteInProgress = true;
    _lastSimWriteTime = now;

    try {
        await setSimulationParams(trainerControlPoint, roundedGrade);
        _lastSentGrade = roundedGrade;
    } catch (err) {
        console.warn('[BLE] Failed to send simulation params:', err.message);
    } finally {
        _simWriteInProgress = false;
    }
}

/**
 * Reset the throttle so the next sendSimulationParams call writes immediately.
 * Call this on gear shift so the rider feels instant feedback.
 */
export function forceNextSimWrite() {
    _lastSentGrade = null;
    _lastSimWriteTime = 0;
}

export async function releaseTrainerResistance() {
    const controlPoint = trainerControlPoint;
    if (!controlPoint) return;
    try {
        await setSimulationParams(controlPoint, 0);
    } catch (err) {
        console.warn('[BLE] Failed to zero trainer grade:', err.message);
    }

    try {
        await stopWorkout(controlPoint);
    } catch (err) {
        console.warn('[BLE] Failed to stop workout cleanly:', err.message);
    }

    try {
        await resetToSimMode(controlPoint);
    } catch (err) {
        console.warn('[BLE] Failed to reset trainer mode:', err.message);
    }
}

export function isTrainerConnected() {
    return trainerServer !== null && trainerServer.connected;
}

export function disconnectTrainer() {
    void releaseTrainerResistance();
    if (trainerServer && trainerServer.connected) trainerServer.disconnect();
    trainerServer = null; trainerControlPoint = null;
    bikeDataChar  = null; trainerDevice = null;
}

// ══════════════════════════════════════════════════════════════════
//  CONTROLLER (BLE remote — up to 2 simultaneous)
// ══════════════════════════════════════════════════════════════════

function findFreeSlot() {
    for (let i = 0; i < controllers.length; i++) {
        if (slotLocked[i]) continue;
        if (controllers[i].status === 'disconnected') return i;
    }
    return -1;
}

function syncControllerState(slot) {
    const c = controllerDevices[slot];
    const n = slot + 1;
    const assignment = virtualController.getAssignment(c.id, c.name);
    state.update({
        [`controller_${n}_status`]: c.status,
        [`controller_${n}_name`]:   c.name,
        [`controller_${n}_input_ready`]: !!c.inputReady,
        [`controller_${n}_issue`]: c.issue || '',
        [`controller_${n}_gatt_connected`]: c.gattConnected,
        [`controller_${n}_assignment`]: assignment,
    });
}

// ── Connection heartbeat ──────────────────────────────────────────
// Polls server.connected every 2s to catch silent disconnections
// that Chrome's gattserverdisconnected event sometimes misses.

function startHeartbeat(slot) {
    stopHeartbeat(slot);
    const n = slot + 1;
    controllerDevices[slot].setHeartbeat(setInterval(() => {
        const ctrl = controllerDevices[slot];
        const gattAlive = ctrl.gattConnected;
        if (!gattAlive && ctrl.status !== 'disconnected') {
            console.warn(`[BLE] Controller ${n}: heartbeat detected silent disconnect`);
            resetControllerSlot(slot);
        }
        // Always re-sync so UI reflects true GATT state
        syncControllerState(slot);
    }, 2000));
}

function stopHeartbeat(slot) {
    const ctrl = controllerDevices[slot];
    if (ctrl.heartbeatId) {
        clearInterval(ctrl.heartbeatId);
        ctrl.clearHeartbeat();
    }
}

/**
 * Tear down notification subscriptions and writable channels for a slot.
 */
function clearControllerRuntime(slot) {
    controllerDevices[slot].clearRuntime(reportStates);
}

function resetControllerSlot(slot) {
    stopHeartbeat(slot);
    controllerDevices[slot].reset(reportStates);
    slotLocked[slot] = false;
    syncControllerState(slot);
}

function markControllerInputReady(slot, charUuid) {
    const ctrl = controllerDevices[slot];
    if (ctrl.inputReady && String(ctrl.issue || '').startsWith('Input verified via')) return;

    ctrl.setInputReady(`Input verified via ${shortUuid(charUuid)}`);
    syncControllerState(slot);
}

function findExistingControllerSlotByDeviceId(deviceId, ignoreSlot = -1) {
    if (!deviceId) return -1;

    for (let i = 0; i < controllers.length; i++) {
        if (i === ignoreSlot) continue;
        const ctrl = controllerDevices[i];
        if (ctrl.id === deviceId && ctrl.status !== 'disconnected') return i;
    }

    return -1;
}

function isLikelyZwiftService(serviceUuid) {
    const uuid = normalizeUuid(serviceUuid);
    return uuid === CLICK_SERVICE_UUID || uuid === PLAY_SERVICE_UUID
        || uuid.includes('fc82')
        || uuid.replace(/-/g, '').includes('19ca4651');
}

function scoreControllerChannel(serviceUuid, charUuid) {
    const svc = normalizeUuid(serviceUuid);
    const chr = normalizeUuid(charUuid);

    if (IGNORED_CONTROLLER_SERVICES.has(svc) || IGNORED_CONTROLLER_CHARACTERISTICS.has(chr)) {
        return -100;
    }
    if (chr === PLAY_NOTIFY_UUID) return 100;
    if (chr === PLAY_ALT_NOTIFY_UUID) return 95;
    if (chr === PLAY_WRITE_UUID) return 90;
    if (isLikelyZwiftService(svc)) return 80;
    return 10;
}

function selectPreferredChannels(channels) {
    if (!channels.length) return [];

    const viable = channels.filter(channel => channel.score >= 0);
    if (!viable.length) return [];

    const maxScore = Math.max(...viable.map(channel => channel.score));
    const threshold = maxScore >= 80 ? maxScore - 10 : maxScore;
    return viable.filter(channel => channel.score >= threshold);
}

async function writeRideOn(channel, label) {
    const char = channel.characteristic;
    const payload = textEncoder.encode('RideOn');

    try {
        if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) {
            await char.writeValueWithoutResponse(payload);
            console.log(`[BLE] ${label}: RideOn sent to ${shortUuid(channel.charUuid)}`);
            return true;
        }
        if (char.properties.write && char.writeValueWithResponse) {
            await char.writeValueWithResponse(payload);
            console.log(`[BLE] ${label}: RideOn sent to ${shortUuid(channel.charUuid)}`);
            return true;
        }
        if (char.properties.write && char.writeValue) {
            await char.writeValue(payload);
            console.log(`[BLE] ${label}: RideOn sent to ${shortUuid(channel.charUuid)}`);
            return true;
        }
    } catch (err) {
        console.warn(`[BLE] ${label}: RideOn failed for ${shortUuid(channel.charUuid)}:`, err.message);
    }

    return false;
}

async function subscribeControllerChannels(slot, server, label) {
    let subscribed = false;
    const ctrl = controllers[slot];
    clearControllerRuntime(slot);

    try {
        const services = await server.getPrimaryServices();
        console.log(`[BLE] ${label}: found ${services.length} service(s)`);

        const notifyChannels = [];
        const writableChannels = [];

        for (const service of services) {
            try {
                const serviceUuid = normalizeUuid(service.uuid);
                const chars = await service.getCharacteristics();

                for (const char of chars) {
                    const charUuid = normalizeUuid(char.uuid);
                    const channel = {
                        serviceUuid,
                        charUuid,
                        score: scoreControllerChannel(serviceUuid, charUuid),
                        characteristic: char,
                    };

                    if (char.properties.notify || char.properties.indicate) {
                        notifyChannels.push(channel);
                    }
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        writableChannels.push(channel);
                    }
                }
            } catch (_) { /* skip inaccessible service */ }
        }

        const selectedNotify = selectPreferredChannels(notifyChannels);
        const selectedWritable = selectPreferredChannels(writableChannels);
        ctrl.writableChannels = selectedWritable;

        console.log(`[BLE] ${label}: notify candidates=${notifyChannels.length}, selected=${selectedNotify.length}`);

        for (const channel of selectedNotify) {
            try {
                await channel.characteristic.startNotifications();
                const listener = (event) => {
                    handleControllerReport({
                        slot,
                        label,
                        serviceUuid: channel.serviceUuid,
                        charUuid: channel.charUuid,
                        dataView: event.target.value,
                    });
                };

                channel.listener = listener;
                channel.characteristic.addEventListener('characteristicvaluechanged', listener);
                ctrl.subscriptions.push(channel);
                subscribed = true;
                console.log(`[BLE] ${label}: subscribed ${channel.serviceUuid} / ${channel.charUuid}`);
            } catch (err) {
                console.warn(`[BLE] ${label}: subscribe failed for ${channel.charUuid}:`, err.message);
            }
        }

        for (const channel of selectedWritable) {
            await writeRideOn(channel, label);
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
export async function scanAndConnectController() {
    const slot = findFreeSlot();
    if (slot === -1) {
        console.warn('[BLE] Both controller slots occupied.');
        return null;
    }

    const n = slot + 1;
    slotLocked[slot] = true;

    const ctrl = controllerDevices[slot];
    ctrl.setStatus('scanning', '');
    syncControllerState(slot);

    try {
        const optionalServices = buildOptionalServices();

        // Always use explicit filters — never acceptAllDevices.
        // This prevents Chrome from showing cached/bonded devices
        // that are no longer nearby.
        const device = await navigator.bluetooth.requestDevice({
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
                { namePrefix: 'Play' },
                { namePrefix: 'HID' },
            ],
            optionalServices,
        });

        // ── Duplicate check ──
        const existingSlot = findExistingControllerSlotByDeviceId(device.id, slot);
        if (existingSlot !== -1) {
            console.warn(`[BLE] Duplicate controller: ${device.name} already in slot ${existingSlot + 1}`);
            slotLocked[slot] = false;
            resetControllerSlot(slot);
            return { device, duplicateOf: existingSlot };
        }

        ctrl.hydrate(device, `Controller ${n}`);
        ctrl.setStatus('connecting', 'Establishing GATT connection…');
        syncControllerState(slot);

        console.log(`[BLE] Controller ${n} selected: ${device.name}`);

        // ── GATT disconnect handler ──
        device.addEventListener('gattserverdisconnected', () => {
            console.log(`[BLE] Controller ${n} disconnected (GATT event)`);
            resetControllerSlot(slot);
        });

        // ── GATT connect ──
        ctrl.attachServer(await device.gatt.connect());
        console.log(`[BLE] Controller ${n} GATT connected`);

        // Immediate GATT sanity check
        if (!ctrl.gattConnected) {
            console.warn(`[BLE] Controller ${n}: server.connected is false right after connect()`);
            slotLocked[slot] = false;
            resetControllerSlot(slot);
            return null;
        }

        // ── Verifying phase: discover services & subscribe ──
        ctrl.setStatus('verifying', 'GATT connected. Discovering services…');
        syncControllerState(slot);

        const subscribed = await subscribeControllerChannels(slot, ctrl.server, `Controller ${n}`);

        if (!subscribed) {
            console.warn(`[BLE] Controller ${n}: no notifiable characteristics — buttons won't work.`);
            ctrl.setStatus('degraded', 'Connected but no button channel detected. Buttons won\'t work.');
            ctrl.setInputReadyState(false);
        } else {
            ctrl.setStatus('ready', 'Connected. Press any button to verify input.');
            ctrl.setInputReadyState(false);
        }

        syncControllerState(slot);

        // ── Start heartbeat monitoring ──
        startHeartbeat(slot);
        slotLocked[slot] = false;

        console.log(`[BLE] Controller ${n} setup complete (status: ${ctrl.status})`);
        return { device, slot, status: ctrl.status, issue: ctrl.issue };

    } catch (err) {
        slotLocked[slot] = false;
        resetControllerSlot(slot);
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

const reportStates = new Map(); // keyed by slot/service/char for edge detection
const actionCooldowns = {};     // debounce: { device/source/action: lastFireTime }
const COOLDOWN_MS = 400;        // minimum ms between same action fires

function decodeZwiftButtons(bytes) {
    if (bytes.length < 7 || bytes[0] !== 0x23) return null;

    const bitmap = (
        bytes[2]
        | (bytes[3] << 8)
        | (bytes[4] << 16)
        | (bytes[5] << 24)
    ) >>> 0;

    const pressed = (~bitmap) >>> 0;
    const actions = [];
    if (pressed & ((1 << 13) | (1 << 4) | (1 << 6))) actions.push('gearUp');
    if (pressed & ((1 << 9) | (1 << 5) | (1 << 8))) actions.push('gearDown');

    return {
        kind: 'zwift',
        stateSig: `zwift:${bitmap}`,
        active: pressed !== 0,
        actions,
    };
}

function extractAsciiPayload(bytes) {
    let best = '';

    for (let start = 0; start < bytes.length; start++) {
        let current = '';

        for (let i = start; i < bytes.length; i++) {
            const byte = bytes[i];
            if (byte === 0) break;
            if (byte >= 32 && byte <= 126) {
                current += String.fromCharCode(byte);
                continue;
            }
            current = '';
            break;
        }

        if (current.length > best.length) best = current;
    }

    return best;
}

function isTelemetryReport(bytes) {
    if (bytes.length === 3 && bytes[0] === 0x19 && bytes[1] === 0x10 && bytes[2] >= 0 && bytes[2] <= 100) {
        return true;
    }

    const asciiPayload = extractAsciiPayload(bytes);
    if (!asciiPayload) return false;

    return /batt|volt|mv|battery|temp|firmware|version/i.test(asciiPayload);
}

function classifyControllerReport(bytes) {
    if (!bytes.length) return { skip: true };
    if (bytes.every(byte => byte === 0)) return { skip: true };

    const ascii = String.fromCharCode(...bytes);
    if (ascii === 'RideOn') return { skip: true };
    if (isTelemetryReport(bytes)) return { skip: true };

    const zwift = decodeZwiftButtons(bytes);
    if (zwift) return zwift;

    return {
        kind: 'raw',
        stateSig: `raw:${bytes.join(',')}`,
        active: true,
        actions: [],
    };
}

function handleControllerReport(report) {
    const { slot, label, serviceUuid, charUuid, dataView } = report;
    if (dataView.byteLength === 0) return;

    const ctrl = controllerDevices[slot];
    const deviceId = ctrl?.id || '';
    const bytes = dataViewToBytes(dataView);
    const parsed = classifyControllerReport(bytes);
    if (parsed.skip) return;

    const sourceKey = `${slot}|${serviceUuid}|${charUuid}`;
    const previous = reportStates.get(sourceKey) || { stateSig: null, changedAt: 0 };
    if (previous.stateSig === parsed.stateSig) return;

    previous.stateSig = parsed.stateSig;
    previous.changedAt = Date.now();
    reportStates.set(sourceKey, previous);

    markControllerInputReady(slot, charUuid);

    const normalizedReport = {
        deviceId,
        slot,
        label,
        assignment: virtualController.getAssignment(deviceId, ctrl?.name),
        virtualControllerId: 'virtual-controller-1',
        serviceUuid,
        charUuid,
        data: bytes,
        parsed,
        timestamp: Date.now(),
    };
    emitControllerReportEvent(normalizedReport);

    console.log(`[BLE] ${label} report ${shortUuid(serviceUuid)} / ${shortUuid(charUuid)}: [${bytes.join(', ')}]`);
}

function dispatchControllerAction(report) {
    const { deviceId, assignment, slot, serviceUuid, charUuid, data: bytes, parsed, timestamp } = report;
    if (!parsed.active) return;

    if (learnModeAction !== null) {
        if (timestamp < learnModeStartedAt) return;

        const sourceKey = `${slot}|${serviceUuid}|${charUuid}`;
        const baseline = learnModeBaselines.get(sourceKey);
        const learnAge = Date.now() - learnModeStartedAt;

        if (!baseline) {
            if (parsed.kind === 'zwift' && parsed.actions.length) {
                console.log(`[BLE] Learn mode: direct button event detected on ${shortUuid(charUuid)}`);
            } else if (learnAge < LEARN_BASELINE_WINDOW_MS) {
                learnModeBaselines.set(sourceKey, parsed.stateSig);
                console.log(`[BLE] Learn mode: baseline captured on ${shortUuid(charUuid)} (${parsed.stateSig})`);
                return;
            } else {
                console.log(`[BLE] Learn mode: no baseline seen, accepting event fallback on ${shortUuid(charUuid)}`);
            }
        } else if (baseline === parsed.stateSig) {
            return;
        } else {
            console.log(`[BLE] Learn mode: state change detected on ${shortUuid(charUuid)} (${baseline} -> ${parsed.stateSig})`);
        }

        const result = saveButtonMapping(learnModeAction, bytes, { deviceId, assignment, serviceUuid, charUuid });
        const cb = learnModeCallback;
        learnModeAction = null;
        learnModeCallback = null;
        learnModeStartedAt = 0;
        learnModeBaselines = new Map();
        if (cb) cb({ ...result, bytes, deviceId, assignment, serviceUuid, charUuid });
        return;
    }

    const resolution = virtualController.resolveAction(report, loadControllerMap());
    if (resolution.kind === 'ambiguous') {
        console.warn(`[BLE] Ambiguous mapping for [${bytes.join(', ')}]: ${resolution.actions.join(', ')}`);
        return;
    }

    if (resolution.action) {
        fire(resolution.action, report);
        if (resolution.kind === 'parsed') {
            console.log(`[BLE] Auto-decoded ${resolution.action} from Zwift packet`);
        }
        return;
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

function fire(action, report = {}) {
    // Debounce per controller source so two physical controllers do not
    // suppress each other when they emit the same semantic action.
    const now = Date.now();
    const cooldownSource = report.deviceId || `${report.slot ?? 'unknown'}|${report.serviceUuid || ''}|${report.charUuid || ''}`;
    const cooldownKey = `${cooldownSource}|${action}`;
    if (actionCooldowns[cooldownKey] && (now - actionCooldowns[cooldownKey]) < COOLDOWN_MS) {
        return; // too soon, skip
    }
    actionCooldowns[cooldownKey] = now;

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
    return controllerDevices.some(c => c.gattConnected
        && (c.status === 'ready' || c.status === 'degraded'));
}

export function getControllerInfo(slot) {
    const c = controllerDevices[slot];
    return c.toInfo(virtualController.getAssignment(c.id, c.name));
}

export function getVirtualControllerInfo() {
    return virtualController.getSnapshot(controllerDevices);
}

export function setControllerAssignment(slot, assignment) {
    const controller = controllerDevices[slot];
    const ok = virtualController.setAssignment(controller.id, assignment);
    if (ok) {
        if (assignment === 'left' || assignment === 'right') {
            for (const other of controllerDevices) {
                if (other.slot === slot || !other.id) continue;
                if (virtualController.getAssignment(other.id, other.name) === assignment) {
                    virtualController.setAssignment(other.id, 'standalone');
                }
            }
        }

        controllers.forEach((_, i) => {
            syncControllerState(i);
        });
    }
    return ok;
}

export function disconnectController(slot) {
    if (slot === undefined) {
        controllers.forEach((_, i) => disconnectController(i));
        return;
    }
    resetControllerSlot(slot);
}

// ══════════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════════

export function isWebBluetoothAvailable() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}
