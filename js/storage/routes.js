/**
 * Route storage — IndexedDB backed.
 * Stores imported GPX routes for offline use.
 */

import { parseGPX, getGPXName, getTotalDistance, getElevationGain } from '../gpx/parser.js';

const DB_NAME = 'fz_routes';
const DB_VERSION = 1;
const STORE_NAME = 'routes';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Import a GPX file (File object or raw text).
 * Parses, computes stats, and stores in IndexedDB.
 * @returns {Object} route entry
 */
export async function importRoute(file, metadata = {}) {
    let gpxText;
    if (typeof file === 'string') {
        gpxText = file;
    } else {
        gpxText = await file.text();
    }

    const points = parseGPX(gpxText);
    if (points.length < 2) throw new Error('GPX file has too few points');

    const name = metadata.name || getGPXName(gpxText);
    const key = metadata.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const route = {
        key,
        name,
        description: metadata.description || '',
        emoji: metadata.emoji || '🚴',
        gpx_text: gpxText,
        points,
        distance_km: Math.round(getTotalDistance(points) / 100) / 10,
        elevation_gain: Math.round(getElevationGain(points)),
        imported_at: new Date().toISOString(),
    };

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(route);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    console.log(`[ROUTES] Imported: ${name} (${route.distance_km}km)`);
    return route;
}

/**
 * List all stored routes.
 * @returns {Promise<Array>}
 */
export async function listRoutes() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get a single route by key.
 */
export async function getRoute(key) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return new Promise((resolve, reject) => {
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Delete a route by key.
 */
export async function deleteRoute(key) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    console.log(`[ROUTES] Deleted: ${key}`);
}

/**
 * Check if any routes exist.
 */
export async function hasRoutes() {
    const routes = await listRoutes();
    return routes.length > 0;
}
