/**
 * Ride engine — main ride loop, data accumulation, finalization.
 * Port of unchained_project/ride/engine.py — uses setInterval instead of asyncio.
 */

import { state } from '../state.js';
import { PhysicsEngine } from './physics.js';
import { GearSystem } from './gear.js';
import { getSlopeAtDistance, getElevationAtDistance, computeSlopes, getTotalDistance } from '../gpx/parser.js';
import { sendSimulationParams, releaseTrainerResistance } from '../ble/manager.js';
import { loadProfile, estimateCalories } from '../storage/profile.js';
import { loadConfig } from '../storage/config.js';
import { saveActivity } from '../storage/activities.js';
import { buildGPX, downloadGPX } from '../gpx/export.js';

// Subsystems
let physics = null;
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

// Data accumulators
let rideData = null;

function newRideData() {
    return {
        power_samples: [],
        cadence_samples: [],
        speed_samples: [],
        max_power: 0,
        elevation_gain: 0,
        prev_elevation: 0,
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

    // Init subsystems
    physics = new PhysicsEngine(
        profile.weight_kg || config.physics.rider_mass,
        config.physics.crr,
        config.physics.cda,
        config.physics.slope_smoothing,
        config.physics.max_slope_rate,
    );

    gears = new GearSystem(
        config.gear.count,
        config.gear.neutral,
        config.gear.step_grade,
        config.gear.debounce_ms,
        config.gear.smoothing,
    );

    rideData = newRideData();
    rideFinalized = false;

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
    });

    if (routePoints.length) {
        state.set('elevation', routePoints[0].elevation);
        rideData.prev_elevation = routePoints[0].elevation;
        recordTrackSample(0, 0);
    }

    // Clear any residual trainer load from the previous session before the first loop tick.
    void sendSimulationParams(0);

    startTime = performance.now() / 1000;
    lastTime = startTime;
    pauseStartedAt = null;
    pausedDurationTotal = 0;
    pausedElapsedSnapshot = 0;
    rideStartedAt = new Date();

    console.log(`[RIDE] Started: ${route.name} (${totalDistance.toFixed(0)}m)`);

    // Main loop — 1Hz
    rideInterval = setInterval(rideLoop, 1000);
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

    const speedMs = state.get('speed') / 3.6;
    let distance = state.get('distance') + speedMs * dt;
    distance = Math.min(distance, totalDistance);

    if (distance >= totalDistance) {
        state.update({
            distance: totalDistance,
            progress: 100,
            finished: true,
            ride_active: false,
        });
        recordTrackSample(totalDistance, state.get('elapsed'));
        void releaseTrainerResistance();
        console.log('[RIDE] Complete!');
        clearInterval(rideInterval);
        rideInterval = null;
        return;
    }

    const rawSlope = getSlopeAtDistance(slopes, distance);
    const smoothedSlope = physics.update(rawSlope, dt);
    const elevation = getElevationAtDistance(routePoints, distance);
    const elapsed = now - startTime - pausedDurationTotal;
    const progress = (distance / totalDistance) * 100;

    // Elevation gain
    if (elevation > rideData.prev_elevation) {
        rideData.elevation_gain += elevation - rideData.prev_elevation;
    }
    rideData.prev_elevation = elevation;

    // Record samples
    const power = state.get('power');
    rideData.power_samples.push(power);
    rideData.cadence_samples.push(state.get('cadence'));
    rideData.speed_samples.push(state.get('speed'));
    rideData.max_power = Math.max(rideData.max_power, power);
    recordTrackSample(distance, elapsed);

    // Gear offset
    const gearOffset = gears.getResistanceOffset();
    const effectiveSlope = Math.round(Math.max(-40, Math.min(40, smoothedSlope + gearOffset)) * 100) / 100;

    // Calories
    let calories = 0;
    if (elapsed > 0 && rideData.power_samples.length > 0) {
        const avgPower = rideData.power_samples.reduce((a, b) => a + b, 0) / rideData.power_samples.length;
        calories = estimateCalories(profile, avgPower, elapsed);
    }

    // Update state (batch)
    state.update({
        distance,
        slope: rawSlope,
        effective_slope: effectiveSlope,
        elevation,
        elevation_gain: Math.round(rideData.elevation_gain * 10) / 10,
        progress,
        elapsed,
        gear: gears.getDisplayGear(),
        gear_offset: Math.round(gearOffset * 100) / 100,
        calories,
    });

    // Send simulation to trainer
    sendSimulationParams(effectiveSlope);
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
    void releaseTrainerResistance();
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
export function gearUp() { if (gears) gears.shiftUp(); }
export function gearDown() { if (gears) gears.shiftDown(); }

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
        avg_speed_kmh: speedSamples.length ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length : 0,
        elevation_gain_m: rideData.elevation_gain,
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
