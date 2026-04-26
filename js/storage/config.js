/**
 * App configuration — localStorage backed.
 * Replaces config.toml.
 */

const STORAGE_KEY = 'fz_config';

const DEFAULTS = {
    // Gear system (virtual drivetrain)
    gear: {
        debounce_ms: 200,
        smoothing: 0.3,
        startup_resistance_ramp_s: 12,
        virtual_gear_count: 22,
        roller_min_grade: 1,
        roller_max_grade: 22,
    },
    // Physics
    physics: {
        rider_mass: 80,
        bike_mass: 9,
        crr: 0.005,
        cda: 0.32,
        air_density: 1.225,
        trainer_difficulty: 0.50,
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

export function updateGearRange(minGrade, maxGrade, gearCount = null) {
    const config = loadConfig();
    config.gear.roller_min_grade = minGrade;
    config.gear.roller_max_grade = maxGrade;
    if (gearCount !== null) config.gear.virtual_gear_count = gearCount;
    return saveConfig(config);
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
