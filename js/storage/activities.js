/**
 * Activity storage — IndexedDB backed.
 * Stores completed ride data.
 */

const DB_NAME = 'fz_activities';
const DB_VERSION = 1;
const STORE_NAME = 'activities';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Save a completed ride activity.
 * @param {Object} data - Ride data payload
 * @returns {string} Activity ID
 */
export async function saveActivity(data) {
    const now = new Date();
    const id = now.toISOString().replace(/[-:T.]/g, '').slice(0, 15);

    const activity = {
        id,
        date: now.toISOString(),
        route_name: data.route_name || 'Unknown',
        duration_s: Math.round((data.duration_s || 0) * 10) / 10,
        distance_m: Math.round((data.distance_m || 0) * 10) / 10,
        avg_power_w: Math.round((data.avg_power_w || 0) * 10) / 10,
        max_power_w: Math.round(data.max_power_w || 0),
        avg_cadence: Math.round((data.avg_cadence || 0) * 10) / 10,
        avg_speed_kmh: Math.round((data.avg_speed_kmh || 0) * 10) / 10,
        elevation_gain_m: Math.round((data.elevation_gain_m || 0) * 10) / 10,
        power_samples: data.power_samples || [],
        track_samples: data.track_samples || [],
    };

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(activity);

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    console.log(`[ACTIVITY] Saved: ${id}`);
    return id;
}

/**
 * List all activities, newest first.
 */
export async function listActivities() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');

    return new Promise((resolve, reject) => {
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
            const activities = req.result
                .map(a => {
                    // Strip large arrays for list view
                    const { power_samples, track_samples, ...rest } = a;
                    return rest;
                })
                .sort((a, b) => b.date.localeCompare(a.date));
            resolve(activities);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get a single activity by ID (with full data).
 */
export async function getActivity(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return new Promise((resolve, reject) => {
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Delete an activity by ID.
 */
export async function deleteActivity(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}
