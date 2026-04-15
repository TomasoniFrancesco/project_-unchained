/**
 * BLE Manager — Web Bluetooth scan, connect, and device management.
 * Port of fuckzwift/ble/manager.py
 */

import { state } from '../state.js';
import { FTMS_SERVICE, subscribeIndoorBikeData, getControlPoint, requestControl } from './ftms.js';

// Trainer state
let trainerServer = null;
let trainerControlPoint = null;
let bikeDataChar = null;

// Data callback
let onTrainerData = null;

/**
 * Scan and connect to an FTMS trainer.
 * Web Bluetooth requires user gesture — call from a button click handler.
 */
export async function scanAndConnectTrainer(dataCallback) {
    onTrainerData = dataCallback;
    state.set('scanning', true);

    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [FTMS_SERVICE] }],
            optionalServices: [FTMS_SERVICE],
        });

        state.update({
            scanning: false,
            trainer_name: device.name || 'Smart Trainer',
            trainer_status: 'connecting',
        });

        console.log(`[BLE] Selected: ${device.name}`);

        // Handle disconnection
        device.addEventListener('gattserverdisconnected', () => {
            console.log('[BLE] Trainer disconnected');
            trainerServer = null;
            trainerControlPoint = null;
            bikeDataChar = null;
            state.update({
                trainer_status: 'disconnected',
                trainer_name: '',
                power: 0,
                cadence: 0,
                speed: 0,
            });
        });

        // Connect
        trainerServer = await device.gatt.connect();
        console.log('[BLE] GATT connected');

        // Subscribe to Indoor Bike Data
        bikeDataChar = await subscribeIndoorBikeData(trainerServer, (data) => {
            state.update({
                power: data.power,
                cadence: data.cadence,
                speed: data.speed,
            });
            if (onTrainerData) onTrainerData(data);
        });

        // Get control point
        trainerControlPoint = await getControlPoint(trainerServer);
        if (trainerControlPoint) {
            await requestControl(trainerControlPoint);
        }

        state.set('trainer_status', 'connected');
        console.log('[BLE] Trainer fully connected');

        return device;

    } catch (err) {
        state.set('scanning', false);
        if (err.name === 'NotFoundError') {
            console.log('[BLE] User cancelled device selection');
        } else {
            console.error('[BLE] Connection failed:', err);
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

/**
 * Check if trainer is connected.
 */
export function isTrainerConnected() {
    return trainerServer !== null && trainerServer.connected;
}

/**
 * Disconnect the trainer.
 */
export function disconnectTrainer() {
    if (trainerServer && trainerServer.connected) {
        trainerServer.disconnect();
    }
    trainerServer = null;
    trainerControlPoint = null;
    bikeDataChar = null;
}

/**
 * Check if Web Bluetooth is available.
 */
export function isWebBluetoothAvailable() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}
