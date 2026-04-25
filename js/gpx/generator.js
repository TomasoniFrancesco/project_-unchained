/**
 * GPX Route Generator — client-side synthetic route creation.
 * Generates elevation profiles for indoor cycling simulations.
 * Supports 6 route types × 3 difficulty levels.
 */

/**
 * Difficulty presets — controls gradient variance and smoothing.
 */
const DIFFICULTY = {
    easy:   { variance: 0.3, smoothPasses: 5, sustainedLen: 0 },
    medium: { variance: 0.6, smoothPasses: 3, sustainedLen: 0.1 },
    hard:   { variance: 1.0, smoothPasses: 1, sustainedLen: 0.25 },
};

const EARTH_RADIUS_M = 6371000;

function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function destinationPoint(latDeg, lonDeg, distanceM, bearingDeg) {
    const lat1 = latDeg * Math.PI / 180;
    const lon1 = lonDeg * Math.PI / 180;
    const bearing = bearingDeg * Math.PI / 180;
    const angularDistance = distanceM / EARTH_RADIUS_M;

    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinAngularDistance = Math.sin(angularDistance);
    const cosAngularDistance = Math.cos(angularDistance);

    const lat2 = Math.asin(
        sinLat1 * cosAngularDistance
        + cosLat1 * sinAngularDistance * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * sinAngularDistance * cosLat1,
        cosAngularDistance - sinLat1 * Math.sin(lat2)
    );

    return {
        lat: lat2 * 180 / Math.PI,
        lon: ((lon2 * 180 / Math.PI) + 540) % 360 - 180,
    };
}

/**
 * Smooth an elevation array using a moving-average filter.
 */
function smoothElevation(elevations, passes) {
    let arr = [...elevations];
    for (let p = 0; p < passes; p++) {
        const next = [...arr];
        for (let i = 1; i < arr.length - 1; i++) {
            next[i] = arr[i - 1] * 0.25 + arr[i] * 0.5 + arr[i + 1] * 0.25;
        }
        arr = next;
    }
    return arr;
}

/**
 * Generate raw elevation shape for a given route type.
 * Returns an array of normalized values (roughly 0–1 scale, will be rescaled).
 */
function generateShape(numPoints, routeType, difficulty) {
    const diff = DIFFICULTY[difficulty];
    const t = (i) => i / (numPoints - 1); // normalised progress 0→1
    const shape = new Array(numPoints);

    switch (routeType) {
        case 'linear_climb': {
            // Steady ramp up with slight variance
            for (let i = 0; i < numPoints; i++) {
                shape[i] = t(i) + (Math.random() - 0.5) * 0.03 * diff.variance;
            }
            break;
        }
        case 'rolling': {
            // Sinusoidal alternating up/down
            const cycles = 3 + Math.floor(diff.variance * 3);
            for (let i = 0; i < numPoints; i++) {
                const base = Math.sin(t(i) * cycles * Math.PI * 2) * 0.5 + 0.5;
                shape[i] = base + (Math.random() - 0.5) * 0.08 * diff.variance;
            }
            break;
        }
        case 'climb_then_descent': {
            // Long climb to 70% then fast descent
            const peak = 0.65 + diff.variance * 0.05;
            for (let i = 0; i < numPoints; i++) {
                const p = t(i);
                if (p <= peak) {
                    shape[i] = (p / peak) + (Math.random() - 0.5) * 0.03 * diff.variance;
                } else {
                    const desc = (p - peak) / (1 - peak);
                    shape[i] = 1 - desc * 0.85 + (Math.random() - 0.5) * 0.03 * diff.variance;
                }
            }
            break;
        }
        case 'false_flat': {
            // Very gentle continuous incline
            for (let i = 0; i < numPoints; i++) {
                shape[i] = t(i) * 0.3 + (Math.random() - 0.5) * 0.01 * diff.variance;
            }
            break;
        }
        case 'punchy': {
            // Flat with short sharp ramps
            const numPunches = 3 + Math.floor(diff.variance * 4);
            for (let i = 0; i < numPoints; i++) shape[i] = 0;
            for (let p = 0; p < numPunches; p++) {
                const center = Math.floor(((p + 0.5) / numPunches) * numPoints * 0.9 + numPoints * 0.05);
                const width = Math.floor(numPoints * (0.02 + diff.variance * 0.02));
                const height = 0.3 + Math.random() * 0.7 * diff.variance;
                for (let i = Math.max(0, center - width); i < Math.min(numPoints, center + width); i++) {
                    const dist = Math.abs(i - center) / width;
                    shape[i] += height * Math.max(0, 1 - dist * dist);
                }
            }
            break;
        }
        case 'valley': {
            // Descent first, flat in the middle, then climb back
            for (let i = 0; i < numPoints; i++) {
                const p = t(i);
                let val;
                if (p < 0.3) {
                    val = 1 - (p / 0.3); // descent
                } else if (p < 0.7) {
                    val = 0.05 + (Math.random() - 0.5) * 0.02 * diff.variance; // flat bottom
                } else {
                    val = (p - 0.7) / 0.3; // climb back
                }
                shape[i] = val + (Math.random() - 0.5) * 0.04 * diff.variance;
            }
            break;
        }
        default:
            for (let i = 0; i < numPoints; i++) shape[i] = t(i);
    }

    return shape;
}

/**
 * Rescale a shape array to match a target elevation gain,
 * while respecting max gradient constraints.
 */
function rescaleToTarget(elevations, totalDistanceM, targetGainM, maxGradientPct, numPoints) {
    const segLen = totalDistanceM / (numPoints - 1);
    const maxRise = segLen * (maxGradientPct / 100);

    // Compute current gain
    let currentGain = 0;
    for (let i = 1; i < elevations.length; i++) {
        const d = elevations[i] - elevations[i - 1];
        if (d > 0) currentGain += d;
    }

    if (currentGain < 0.01) currentGain = 0.01;
    const scale = targetGainM / currentGain;

    // Apply scale
    const baseEle = elevations[0];
    const scaled = elevations.map(e => baseEle + (e - baseEle) * scale);

    // Clamp gradients
    const clamped = [...scaled];
    for (let i = 1; i < clamped.length; i++) {
        const diff = clamped[i] - clamped[i - 1];
        if (Math.abs(diff) > maxRise) {
            clamped[i] = clamped[i - 1] + Math.sign(diff) * maxRise;
        }
    }

    // Ensure no elevation below 0
    const minEle = Math.min(...clamped);
    if (minEle < 0) {
        const offset = -minEle + 5; // 5m safety margin
        for (let i = 0; i < clamped.length; i++) clamped[i] += offset;
    }

    return clamped;
}

/**
 * Iteratively adjust elevations to match target gain within tolerance.
 */
function matchTargetGain(elevations, totalDistanceM, targetGainM, maxGradientPct, numPoints) {
    let current = [...elevations];
    const tolerance = targetGainM * 0.05;

    for (let iter = 0; iter < 20; iter++) {
        let gain = 0;
        for (let i = 1; i < current.length; i++) {
            const d = current[i] - current[i - 1];
            if (d > 0) gain += d;
        }

        const error = targetGainM - gain;
        if (Math.abs(error) <= tolerance) break;

        // Adjust by scaling deltas
        const ratio = targetGainM / Math.max(gain, 0.1);
        const base = current[0];
        for (let i = 1; i < current.length; i++) {
            current[i] = current[i - 1] + (current[i] - current[i - 1]) * Math.sqrt(ratio);
        }

        // Re-clamp
        const segLen = totalDistanceM / (numPoints - 1);
        const maxRise = segLen * (maxGradientPct / 100);
        for (let i = 1; i < current.length; i++) {
            const diff = current[i] - current[i - 1];
            if (Math.abs(diff) > maxRise) {
                current[i] = current[i - 1] + Math.sign(diff) * maxRise;
            }
        }

        // Ensure >= 0
        const minEle = Math.min(...current);
        if (minEle < 0) {
            const offset = -minEle + 5;
            for (let i = 0; i < current.length; i++) current[i] += offset;
        }
    }

    return current;
}

/**
 * Add slight natural noise for realism.
 */
function addNoise(elevations) {
    return elevations.map((e, i) => {
        if (i === 0 || i === elevations.length - 1) return e;
        return e + (Math.random() - 0.5) * 1.0; // ±0.5m
    });
}

/**
 * Generate a synthetic GPX route.
 * @param {Object} params
 * @param {string} params.route_name
 * @param {number} params.total_distance_km
 * @param {number} params.elevation_gain_m
 * @param {string} params.route_type
 * @param {number} params.max_gradient_percent
 * @param {string} params.difficulty
 * @returns {{ gpxXml: string, elevations: number[], distances: number[], validation: Object }}
 */
export function generateRoute(params) {
    const {
        route_name,
        total_distance_km,
        elevation_gain_m,
        route_type,
        max_gradient_percent,
        difficulty,
    } = params;

    const totalDistanceM = total_distance_km * 1000;
    const numPoints = Math.min(500, Math.max(200, Math.round(totalDistanceM / 20)));
    const segLen = totalDistanceM / (numPoints - 1);

    // 1. Generate raw shape
    const shape = generateShape(numPoints, route_type, difficulty);

    // 2. Smooth
    const diff = DIFFICULTY[difficulty];
    const smoothed = smoothElevation(shape, diff.smoothPasses);

    // 3. Convert to elevation values — start at base 200m
    const baseElevation = 200;
    const range = Math.max(...smoothed) - Math.min(...smoothed) || 1;
    let elevations = smoothed.map(v => baseElevation + ((v - Math.min(...smoothed)) / range) * elevation_gain_m);

    // 4. Rescale to match target gain
    elevations = rescaleToTarget(elevations, totalDistanceM, elevation_gain_m, max_gradient_percent, numPoints);

    // 5. Iterative correction
    elevations = matchTargetGain(elevations, totalDistanceM, elevation_gain_m, max_gradient_percent, numPoints);

    // 6. Add noise
    elevations = addNoise(elevations);

    // 7. Re-match target gain after noise
    elevations = matchTargetGain(elevations, totalDistanceM, elevation_gain_m, max_gradient_percent, numPoints);

    // 9. Final clamp: ensure >= 0 and gradient within limits
    const maxRise = segLen * (max_gradient_percent / 100);
    for (let i = 0; i < elevations.length; i++) {
        if (elevations[i] < 0) elevations[i] = 0;
        if (i > 0) {
            const d = elevations[i] - elevations[i - 1];
            if (Math.abs(d) > maxRise) {
                elevations[i] = elevations[i - 1] + Math.sign(d) * maxRise;
            }
        }
    }

    // 10. Re-check gain after the final gradient clamp.
    elevations = matchTargetGain(elevations, totalDistanceM, elevation_gain_m, max_gradient_percent, numPoints);

    // 11. Generate coordinates using spherical geometry so parsed distance
    // stays aligned with the requested route length.
    const startLat = 46.5;
    const startLon = 10.5;

    const points = [];
    const distances = [];
    const startTime = new Date('2024-01-01T08:00:00Z');

    for (let i = 0; i < numPoints; i++) {
        const dist = i * segLen;
        const { lat, lon } = destinationPoint(startLat, startLon, dist, 90);
        const ele = Math.max(0, elevations[i]);
        const time = new Date(startTime.getTime() + i * 10000); // +10s per point

        points.push({ lat, lon, ele, time });
        distances.push(dist);
    }

    let actualDistanceM = 0;
    for (let i = 1; i < points.length; i++) {
        actualDistanceM += haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    }

    // 9. Validation
    let actualGain = 0;
    let maxGrad = 0;
    let hasNegativeEle = false;
    for (let i = 1; i < elevations.length; i++) {
        const d = elevations[i] - elevations[i - 1];
        if (d > 0) actualGain += d;
        const grad = Math.abs(d / segLen) * 100;
        if (grad > maxGrad) maxGrad = grad;
        if (elevations[i] < 0) hasNegativeEle = true;
    }

    const gainError = elevation_gain_m > 0
        ? Math.abs(actualGain - elevation_gain_m) / elevation_gain_m
        : (actualGain <= 0.5 ? 0 : 1);
    const distanceError = Math.abs(actualDistanceM - totalDistanceM) / Math.max(totalDistanceM, 1);
    const validation = {
        valid: gainError <= 0.05
            && distanceError <= 0.01
            && maxGrad <= max_gradient_percent + 0.5
            && !hasNegativeEle,
        actualGain: Math.round(actualGain),
        targetGain: elevation_gain_m,
        gainErrorPct: Math.round(gainError * 100),
        actualDistanceKm: Math.round((actualDistanceM / 1000) * 100) / 100,
        targetDistanceKm: Math.round(total_distance_km * 100) / 100,
        distanceErrorPct: Math.round(distanceError * 1000) / 10,
        maxGradient: Math.round(maxGrad * 10) / 10,
        hasNegativeEle,
    };

    // 10. Build GPX XML
    const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const trkpts = points.map(p =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele><time>${p.time.toISOString()}</time></trkpt>`
    ).join('\n');

    const gpxXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CyclingRouteAI"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escXml(route_name)}</name>
    <desc>Distance: ${total_distance_km}km | Elevation: ${Math.round(actualGain)}m | Type: ${route_type} | Difficulty: ${difficulty}</desc>
  </metadata>
  <trk>
    <name>${escXml(route_name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

    return { gpxXml, elevations, distances, validation, numPoints };
}

/**
 * Download a generated GPX string.
 */
export function downloadGeneratedGPX(routeName, gpxXml) {
    const slug = routeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'route';
    const filename = `${slug}.gpx`;

    const blob = new Blob([gpxXml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`[GENERATOR] Downloaded: ${filename}`);
    return filename;
}
