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

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'route';
}

function normalizeRouteType(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function classifyDistanceBand(distanceKm) {
    if (distanceKm < 15) return 'short';
    if (distanceKm < 40) return 'medium';
    if (distanceKm < 80) return 'long';
    return 'epic';
}

function classifyDifficulty(distanceKm, elevationGain) {
    const gainPerKm = elevationGain / Math.max(distanceKm, 1);
    const difficultyScore = (distanceKm * 0.35) + gainPerKm;

    if (difficultyScore >= 45 || elevationGain >= 1600) return 'hard';
    if (difficultyScore >= 22 || elevationGain >= 500) return 'medium';
    return 'easy';
}

function inferRouteType(points, explicitType = '') {
    if (explicitType) return normalizeRouteType(explicitType);
    if (!Array.isArray(points) || points.length < 2) return 'mixed';

    const totalDistanceKm = getTotalDistance(points) / 1000;
    const elevationGain = getElevationGain(points);
    const netElevation = points[points.length - 1].elevation - points[0].elevation;
    const gainPerKm = elevationGain / Math.max(totalDistanceKm, 1);

    if (gainPerKm < 8) return 'flat';
    if (netElevation > elevationGain * 0.6 && gainPerKm >= 18) return 'climb';
    if (netElevation < -elevationGain * 0.45 && gainPerKm >= 14) return 'descent';
    if (gainPerKm >= 22) return 'rolling';
    return 'mixed';
}

function enrichRoute(route) {
    const distanceKm = typeof route.distance_km === 'number'
        ? route.distance_km
        : Math.round((getTotalDistance(route.points || []) / 1000) * 10) / 10;
    const elevationGain = typeof route.elevation_gain === 'number'
        ? route.elevation_gain
        : Math.round(getElevationGain(route.points || []));
    const routeType = inferRouteType(route.points || [], route.route_type);
    const difficulty = route.difficulty || classifyDifficulty(distanceKm, elevationGain);
    const importedAt = route.imported_at || new Date().toISOString();
    const source = route.source || 'imported';

    return {
        ...route,
        distance_km: distanceKm,
        elevation_gain: elevationGain,
        route_type: routeType,
        difficulty,
        distance_band: classifyDistanceBand(distanceKm),
        source,
        imported_at: importedAt,
    };
}

async function routeExists(db, key) {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const result = await requestToPromise(tx.objectStore(STORE_NAME).get(key));
    return Boolean(result);
}

async function buildUniqueRouteKey(db, baseKey) {
    let candidate = slugify(baseKey);
    let suffix = 2;

    while (await routeExists(db, candidate)) {
        candidate = `${slugify(baseKey)}_${suffix}`;
        suffix += 1;
    }

    return candidate;
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

    const db = await openDB();
    const name = metadata.name || getGPXName(gpxText);
    const explicitKey = metadata.key ? slugify(metadata.key) : '';
    const baseKey = slugify(name);
    const key = explicitKey || await buildUniqueRouteKey(db, baseKey);

    const route = enrichRoute({
        key,
        name,
        description: metadata.description || '',
        emoji: metadata.emoji || '🚴',
        gpx_text: gpxText,
        points,
        distance_km: Math.round((getTotalDistance(points) / 1000) * 10) / 10,
        elevation_gain: Math.round(getElevationGain(points)),
        imported_at: new Date().toISOString(),
        route_type: metadata.route_type || metadata.terrain_type || '',
        difficulty: metadata.difficulty || '',
        source: metadata.source || (metadata.route_type ? 'generated' : 'imported'),
    });

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(route);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    console.log(`[ROUTES] Imported: ${route.name} (${route.distance_km}km)`);
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
        req.onsuccess = () => resolve(req.result.map(enrichRoute));
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
        req.onsuccess = () => resolve(req.result ? enrichRoute(req.result) : null);
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
