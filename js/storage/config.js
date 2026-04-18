/**
 * App configuration — localStorage backed.
 * Replaces config.toml.
 */

const STORAGE_KEY = 'fz_config';

const DEFAULTS = {
    // Gear system
    gear: {
        count: 21,
        neutral: 5,
        step_grade: 0.5,
        max_difficulty_scale: 3.0,
        debounce_ms: 200,
        smoothing: 0.3,
        min_difficulty_scale: 0.15,
        downhill_scale: 0.5,
        startup_resistance_ramp_s: 12,
    },
    // Physics
    physics: {
        rider_mass: 80,
        crr: 0.005,
        cda: 0.4,
        slope_smoothing: 0.25,
        max_slope_rate: 2.0,
    },
    // Strava
    strava: {
        client_id: '',
        client_secret: '',
    },
    // BLE
    ble: {
        trainer_keywords: ['KICKR', 'TACX', 'ELITE', 'HAMMER', 'H3', 'FLUX', 'VAN RYSEL'],
    },
};

export function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return deepMerge(DEFAULTS, parsed);
        }
    } catch (e) {
        console.warn('[CONFIG] Failed to load:', e);
    }
    return structuredClone(DEFAULTS);
}

export function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    console.log('[CONFIG] Saved');
    return config;
}

export function updateStrava(clientId, clientSecret) {
    const config = loadConfig();
    config.strava.client_id = clientId;
    config.strava.client_secret = clientSecret;
    return saveConfig(config);
}

export function getStrava() {
    const config = loadConfig();
    return config.strava;
}

function deepMerge(target, source) {
    const result = structuredClone(target);
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}
