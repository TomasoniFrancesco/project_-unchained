/**
 * Profile storage — localStorage backed.
 * Port of fuckzwift/storage/profile.py
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

/**
 * Estimate calories burned (Keytel formula approximation).
 */
export function estimateCalories(profile, avgPowerW, durationS) {
    if (durationS <= 0 || avgPowerW <= 0) return 0;
    const hrs = durationS / 3600;
    const weight = profile.weight_kg || 75;
    const age = profile.age || 30;
    const isMale = profile.gender !== 'female';

    const vo2 = (avgPowerW * 10.8) / weight + 7;
    let cal;
    if (isMale) {
        cal = ((-55.0969 + 0.6309 * 140 + 0.1988 * weight + 0.2017 * age) / 4.184) * hrs;
    } else {
        cal = ((-20.4022 + 0.4472 * 140 + 0.1263 * weight + 0.074 * age) / 4.184) * hrs;
    }
    // Scale by actual VO2 fraction
    const scale = Math.min(vo2 / 35, 2.5);
    return Math.round(cal * scale);
}
