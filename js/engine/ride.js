/**
 * Ride engine — main ride loop, data accumulation, finalization.
 *
 * Uses CyclingSimulator for Zwift-like physics:
 *   - Speed is computed from rider power via full force model
 *   - Trainer receives effective grade (slope × difficulty × gear)
 *   - Loop runs at 4 Hz for smooth simulation
 */

import { state } from '../state.js';
import { CyclingSimulator } from './physics.js';
import { GearSystem } from './gear.js';
import { getSlopeAtDistance, getElevationAtDistance, computeSlopes, getTotalDistance } from '../gpx/parser.js';
import * as bleManager from '../ble/manager.js';
import { loadProfile, estimateCyclingCalories } from '../storage/profile.js';
import { loadConfig } from '../storage/config.js';
import { saveActivity } from '../storage/activities.js';
import { buildGPX, downloadGPX } from '../gpx/export.js';

// Subsystems
let simulator = null;
let gears = null;
let profile = null;

// Ride state
let routePoints = [];
let slopes = [];
let totalDistance = 0;
let rideInterval = null;
let startTime = 0;
let lastTime = 0;
let pauseStartedAt = null;
let pausedDurationTotal = 0;
let pausedElapsedSnapshot = 0;
let rideStartedAt = null;
let rideFinalized = false;
let startupResistanceRampS = 0;

// Tick rate — 4 Hz for smooth physics
const TICK_INTERVAL_MS = 250;

// Data accumulators
let rideData = null;

function sendTrainerSimulationParams(grade) {
    if (typeof bleManager.sendSimulationParams === 'function') {
        return bleManager.sendSimulationParams(grade);
    }
    return undefined;
}

function releaseTrainerLoad() {
    if (typeof bleManager.releaseTrainerResistance === 'function') {
        return bleManager.releaseTrainerResistance();
    }
    return sendTrainerSimulationParams(0);
}

function newRideData() {
    return {
        power_samples: [],
        cadence_samples: [],
        heart_rate_samples: [],
        speed_samples: [],
        max_power: 0,
        elevation_gain: 0,
        prev_elevation: 0,
        calories_total: 0,
        calories_active: 0,
        calories_resting: 0,
        track_samples: [],
    };
}

function interpolateRouteSample(points, distanceM) {
    if (!points.length) return null;
    if (points.length === 1) {
        const p = points[0];
        return { lat: p.lat, lon: p.lon, ele: p.elevation, dist: 0 };
    }
    const d = Math.max(0, Math.min(distanceM, points[points.length - 1].distance_from_start));
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        if (curr.distance_from_start >= d) {
            const seg = curr.distance_from_start - prev.distance_from_start;
            const t = seg <= 0 ? 0 : (d - prev.distance_from_start) / seg;
            return {
                lat: prev.lat + (curr.lat - prev.lat) * t,
                lon: prev.lon + (curr.lon - prev.lon) * t,
                ele: prev.elevation + (curr.elevation - prev.elevation) * t,
                dist: d,
            };
        }
    }
    const last = points[points.length - 1];
    return { lat: last.lat, lon: last.lon, ele: last.elevation, dist: d };
}

function recordTrackSample(distanceM, elapsedS) {
    const sample = interpolateRouteSample(routePoints, distanceM);
    if (!sample) return;
    const ts = rideData.track_samples;
    if (ts.length && elapsedS <= ts[ts.length - 1].elapsed_s) return;
    ts.push({
        lat: sample.lat,
        lon: sample.lon,
        ele: sample.ele,
        dist: Math.round(sample.dist * 10) / 10,
        elapsed_s: Math.round(elapsedS * 10) / 10,
    });
}

function applyStartupResistanceRamp(targetGrade, elapsedS) {
    if (startupResistanceRampS <= 0) return targetGrade;

    const progress = Math.max(0, Math.min(elapsedS / startupResistanceRampS, 1));
    const easedProgress = progress * progress;
    return targetGrade * easedProgress;
}

/**
 * Start a ride on the given route.
 * @param {Object} route - Route object from storage (must have .points)
 */
export function startRide(route) {
    if (state.get('ride_active')) return;

    profile = loadProfile();
    const config = loadConfig();

    routePoints = route.points;
    slopes = computeSlopes(routePoints);
    totalDistance = getTotalDistance(routePoints);

    // ── Init physics simulator ──
    simulator = new CyclingSimulator({
        riderMass:         profile.weight_kg || config.physics.rider_mass,
        bikeMass:          config.physics.bike_mass || 9,
        crr:               config.physics.crr,
        cda:               config.physics.cda,
        airDensity:        config.physics.air_density || 1.225,
        trainerDifficulty: config.physics.trainer_difficulty ?? 0.50,
        slopeSmoothing:    config.physics.slope_smoothing,
        maxSlopeRate:      config.physics.max_slope_rate,
    });

    // ── Init gear system ──
    gears = new GearSystem({
        debounceMs: config.gear.debounce_ms || 200,
        smoothing:  config.gear.smoothing || 0.3,
        rollerMinGrade: config.gear.roller_min_grade ?? -10,
        rollerMaxGrade: config.gear.roller_max_grade ?? 10,
    });

    rideData = newRideData();
    rideFinalized = false;
    startupResistanceRampS = Math.max(0, Number(config.gear.startup_resistance_ramp_s || 0));

    // Reset state
    state.update({
        ride_active: true,
        ride_paused: false,
        finished: false,
        selected_route_name: route.name,
        total_distance: totalDistance,
        distance: 0,
        progress: 0,
        elapsed: 0,
        elevation_gain: 0,
        slope: 0,
        effective_slope: 0,
        gear: gears.getDisplayGear(),
        gear_offset: 0,
        calories: 0,
        active_calories: 0,
    });

    if (routePoints.length) {
        state.set('elevation', routePoints[0].elevation);
        rideData.prev_elevation = routePoints[0].elevation;
        recordTrackSample(0, 0);
    }

    // Clear any residual trainer load from the previous session before the first loop tick.
    void sendTrainerSimulationParams(0);

    startTime = performance.now() / 1000;
    lastTime = startTime;
    pauseStartedAt = null;
    pausedDurationTotal = 0;
    pausedElapsedSnapshot = 0;
    rideStartedAt = new Date();

    console.log(`[RIDE] Started: ${route.name} (${totalDistance.toFixed(0)}m) | Physics: CdA=${simulator.cda} Crr=${simulator.crr} Mass=${simulator.mass}kg Difficulty=${simulator.trainerDifficulty}`);

    // Main loop — 4 Hz for smooth physics
    rideInterval = setInterval(rideLoop, TICK_INTERVAL_MS);
}

function rideLoop() {
    if (!state.get('ride_active') || state.get('finished')) {
        clearInterval(rideInterval);
        rideInterval = null;
        return;
    }

    const now = performance.now() / 1000;

    if (state.get('ride_paused')) {
        lastTime = now;
        state.set('elapsed', pausedElapsedSnapshot);
        return;
    }

    const dt = now - lastTime;
    lastTime = now;

    // ── 1. Read rider power from trainer ──
    const power = state.get('power') || 0;

    // ── 2. Get route slope at current position ──
    const distance = state.get('distance');
    const rawSlope = getSlopeAtDistance(slopes, distance);

    // ── 3. Update slope smoothing / rate limiting ──
    const smoothedSlope = simulator.updateSlope(rawSlope, dt);

    // ── 3b. Update gear smoothing ──
    gears.update(dt);

    // ── 4. Compute speed from power + physics ──
    // Speed is computed using the TRUE slope (for virtual world accuracy).
    // The trainer's felt resistance is scaled separately via trainerDifficulty.
    simulator.computeSpeed(power, dt);

    // ── 5. Advance position using physics-computed speed ──
    const speedMs = simulator.speedMs;
    let newDistance = distance + speedMs * dt;
    newDistance = Math.min(newDistance, totalDistance);

    // ── 6. Check for route completion ──
    if (newDistance >= totalDistance) {
        state.update({
            distance: totalDistance,
            progress: 100,
            finished: true,
            ride_active: false,
            speed: simulator.speedKmh,
        });
        recordTrackSample(totalDistance, state.get('elapsed'));
        void releaseTrainerLoad();
        console.log('[RIDE] Complete!');
        clearInterval(rideInterval);
        rideInterval = null;
        return;
    }

    const elevation = getElevationAtDistance(routePoints, newDistance);
    const elapsed = now - startTime - pausedDurationTotal;
    const progress = (newDistance / totalDistance) * 100;

    // ── 7. Elevation gain tracking ──
    if (elevation > rideData.prev_elevation) {
        rideData.elevation_gain += elevation - rideData.prev_elevation;
    }
    rideData.prev_elevation = elevation;

    // ── 8. Record data samples (throttled to ~1 Hz) ──
    rideData.power_samples.push(power);
    rideData.cadence_samples.push(state.get('cadence'));
    rideData.heart_rate_samples.push(state.get('heart_rate') || 0);
    rideData.speed_samples.push(simulator.speedKmh);
    rideData.max_power = Math.max(rideData.max_power, power);
    recordTrackSample(newDistance, elapsed);

    // ── 9. Compute effective grade for trainer ──
    // effectiveGrade = slope × trainerDifficulty + gearGradeOffset
    // The gear offset is additive — it works on flats, climbs, and descents.
    // Harder gear → positive offset → trainer pushes back harder.
    // Easier gear → negative offset → trainer lets you spin easier.
    const gearGradeOffset = gears.getGradeOffset();
    const baseTrainerGrade = simulator.computeTrainerGrade(1.0); // no gear scaling here
    const targetGrade = Math.max(-40, Math.min(40, baseTrainerGrade + gearGradeOffset));
    const effectiveGrade = Math.round(applyStartupResistanceRamp(targetGrade, elapsed) * 100) / 100;

    // ── 10. Calories ──
    const calorieTick = estimateCyclingCalories(profile, {
        powerW: power,
        durationS: dt,
        measuredPowerAvailable: state.get('trainer_status') === 'connected',
        speedMs,
        slopePct: smoothedSlope,
        riderMass: simulator.riderMass,
        bikeMass: simulator.bikeMass,
        crr: simulator.crr,
        cda: simulator.cda,
        airDensity: simulator.airDensity,
    });
    rideData.calories_total += calorieTick.total;
    rideData.calories_active += calorieTick.active;
    rideData.calories_resting += calorieTick.resting;

    // ── 11. Batch state update ──
    state.update({
        distance: newDistance,
        speed: simulator.speedKmh,
        slope: rawSlope,
        effective_slope: effectiveGrade,
        elevation,
        elevation_gain: Math.round(rideData.elevation_gain * 10) / 10,
        progress,
        elapsed,
        gear: gears.getDisplayGear(),
        gear_offset: Math.round(gearGradeOffset * 100) / 100,
        gear_ratio: gears.getRatio(),
        calories: Math.round(rideData.calories_total),
        active_calories: Math.round(rideData.calories_active),
    });

    // ── 12. Send effective grade to trainer via FTMS ──
    sendTrainerSimulationParams(effectiveGrade);
}

/**
 * Stop the ride.
 */
export function stopRide() {
    state.update({ ride_active: false, ride_paused: false });
    if (rideInterval) {
        clearInterval(rideInterval);
        rideInterval = null;
    }
    void releaseTrainerLoad();
    console.log('[RIDE] Stopped by user');
}

/**
 * Toggle pause/resume.
 */
export function togglePause() {
    if (!state.get('ride_active') || state.get('finished')) return state.get('ride_paused');

    const now = performance.now() / 1000;
    if (state.get('ride_paused')) {
        if (pauseStartedAt !== null) {
            pausedDurationTotal += now - pauseStartedAt;
        }
        pauseStartedAt = null;
        state.update({ ride_paused: false, elapsed: pausedElapsedSnapshot });
        console.log('[RIDE] Resumed');
    } else {
        pausedElapsedSnapshot = state.get('elapsed');
        pauseStartedAt = now;
        state.update({ ride_paused: true, elapsed: pausedElapsedSnapshot });
        console.log('[RIDE] Paused');
    }
    return state.get('ride_paused');
}

/**
 * Shift gear up/down.
 */
export function gearUp() {
    if (!gears) return;
    gears.shiftUp();
    // Force immediate FTMS write so the rider feels the change now
    if (typeof bleManager.forceNextSimWrite === 'function') bleManager.forceNextSimWrite();
}
export function gearDown() {
    if (!gears) return;
    gears.shiftDown();
    if (typeof bleManager.forceNextSimWrite === 'function') bleManager.forceNextSimWrite();
}

/**
 * Finalize and save the ride.
 * @param {string} mode - 'local_only' | 'strava' | 'discard'
 */
export async function finalizeRide(mode) {
    if (rideFinalized) return { status: 'already_saved' };
    rideFinalized = true;

    stopRide();

    if (mode === 'discard') {
        return { status: 'discarded', message: 'Ride discarded.' };
    }

    const samples = rideData.power_samples;
    if (!samples.length || state.get('elapsed') < 5) {
        return { status: 'skipped', message: 'Ride too short to save.' };
    }

    const n = samples.length;
    const avgPower = samples.reduce((a, b) => a + b, 0) / n;
    const cadenceSamples = rideData.cadence_samples;
    const hrSamples = rideData.heart_rate_samples.filter(hr => hr > 0);
    const speedSamples = rideData.speed_samples;

    // Build sparkline (max 100 points)
    let sparkline = samples;
    if (samples.length > 100) {
        const step = samples.length / 100;
        sparkline = Array.from({ length: 100 }, (_, i) => samples[Math.floor(i * step)]);
    }

    const payload = {
        route_name: state.get('selected_route_name'),
        duration_s: state.get('elapsed'),
        distance_m: state.get('distance'),
        avg_power_w: avgPower,
        max_power_w: rideData.max_power,
        avg_cadence: cadenceSamples.length ? cadenceSamples.reduce((a, b) => a + b, 0) / cadenceSamples.length : 0,
        avg_heart_rate_bpm: hrSamples.length ? hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length : 0,
        max_heart_rate_bpm: hrSamples.length ? Math.max(...hrSamples) : 0,
        avg_speed_kmh: speedSamples.length ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length : 0,
        elevation_gain_m: rideData.elevation_gain,
        calories_kcal: rideData.calories_total,
        active_calories_kcal: rideData.calories_active,
        resting_calories_kcal: rideData.calories_resting,
        power_samples: sparkline,
        track_samples: rideData.track_samples,
    };

    // Save activity
    const activityId = await saveActivity(payload);

    // Export GPX
    let gpxFilename = null;
    if (rideStartedAt && rideData.track_samples.length) {
        gpxFilename = downloadGPX(
            state.get('selected_route_name') || 'Ride',
            rideStartedAt,
            rideData.track_samples,
        );
    }

    const result = {
        status: 'saved',
        message: 'Ride saved locally.',
        activity_id: activityId,
        gpx_file: gpxFilename,
    };

    // Strava upload
    if (mode === 'strava') {
        try {
            const { uploadToStrava } = await import('../integrations/strava.js');
            const gpxXml = buildGPX(
                state.get('selected_route_name') || 'Ride',
                rideStartedAt,
                rideData.track_samples,
            );
            const stravaResult = await uploadToStrava(gpxXml, state.get('selected_route_name'));
            result.strava = stravaResult;
        } catch (err) {
            result.strava = { status: 'error', message: err.message };
        }
    }

    return result;
}

/**
 * Get route points for the current ride (for rendering).
 */
export function getRoutePoints() {
    return routePoints;
}

export function getRideTotalDistance() {
    return totalDistance;
}
