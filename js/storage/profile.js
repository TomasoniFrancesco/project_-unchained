/**
 * Profile storage — localStorage backed.
 * Port of unchained_project/storage/profile.py
 */

const STORAGE_KEY = 'fz_profile';

const DEFAULTS = {
    name: '',
    age: 30,
    gender: 'male',
    weight_kg: 75,
    height_cm: null,
    ftp: null,
};

export function loadProfile() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ...DEFAULTS, ...parsed };
        }
    } catch (e) {
        console.warn('[PROFILE] Failed to load:', e);
    }
    return { ...DEFAULTS };
}

export function saveProfile(data) {
    const profile = { ...DEFAULTS };
    if (data.name != null) profile.name = String(data.name).trim();
    if (data.age != null) profile.age = parseInt(data.age) || DEFAULTS.age;
    if (data.gender != null) profile.gender = data.gender;
    if (data.weight_kg != null) profile.weight_kg = parseFloat(data.weight_kg) || DEFAULTS.weight_kg;
    if (data.height_cm != null) profile.height_cm = parseInt(data.height_cm) || null;
    if (data.ftp != null) profile.ftp = parseInt(data.ftp) || null;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    console.log('[PROFILE] Saved:', profile.name);
    return profile;
}

export function isProfileComplete() {
    const p = loadProfile();
    return !!(p.name && p.weight_kg > 0);
}

export function getRestingKcalPerSecond(profile = {}) {
    const weight = Math.max(1, Number(profile.weight_kg) || DEFAULTS.weight_kg);
    const height = Number(profile.height_cm) || 175;
    const age = Number(profile.age) || DEFAULTS.age;
    const isMale = profile.gender !== 'female';

    const bmrKcalDay = isMale
        ? 10 * weight + 6.25 * height - 5 * age + 5
        : 10 * weight + 6.25 * height - 5 * age - 161;

    return Math.max(0, bmrKcalDay / 86400);
}

function estimatePhysicsPowerW(sample = {}) {
    const speedMs = Math.max(0, Number(sample.speedMs) || 0);
    if (speedMs <= 0) return 0;

    const riderMass = Number(sample.riderMass) || DEFAULTS.weight_kg;
    const bikeMass = Number(sample.bikeMass) || 9;
    const totalMass = Math.max(1, riderMass + bikeMass);
    const crr = Number(sample.crr) || 0.005;
    const cda = Number(sample.cda) || 0.32;
    const airDensity = Number(sample.airDensity) || 1.225;
    const g = 9.8067;
    const slopeFraction = (Number(sample.slopePct) || 0) / 100;
    const theta = Math.atan(slopeFraction);

    const fGravity = totalMass * g * Math.sin(theta);
    const fRolling = crr * totalMass * g * Math.cos(theta);
    const fAero = 0.5 * airDensity * cda * speedMs * speedMs;
    return Math.max(0, (fGravity + fRolling + fAero) * speedMs);
}

export function estimateCyclingCalories(profile = {}, sample = {}) {
    const durationS = Math.max(0, Number(sample.durationS) || 0);
    if (durationS <= 0) return { total: 0, active: 0, resting: 0, sourcePowerW: 0 };

    const grossEfficiency = Math.max(0.18, Math.min(0.30, Number(sample.grossEfficiency) || 0.24));
    const measuredPowerW = Math.max(0, Number(sample.powerW) || 0);
    const fallbackPowerW = estimatePhysicsPowerW(sample);
    const hasMeasuredPower = sample.measuredPowerAvailable !== false;
    const sourcePowerW = hasMeasuredPower ? measuredPowerW : fallbackPowerW;

    const active = (sourcePowerW * durationS) / (4184 * grossEfficiency);
    const resting = getRestingKcalPerSecond(profile) * durationS;

    return {
        total: active + resting,
        active,
        resting,
        sourcePowerW,
        fallbackPowerW,
        measuredPowerW,
    };
}

/**
 * Estimate calories burned from average power.
 * Kept for compatibility with older call sites; live rides should prefer
 * estimateCyclingCalories() per tick so short efforts and coasting are handled.
 */
export function estimateCalories(profile, avgPowerW, durationS) {
    return Math.round(estimateCyclingCalories(profile, {
        powerW: avgPowerW,
        durationS,
    }).total);
}
