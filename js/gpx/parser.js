/**
 * GPX parser — parse GPX XML and compute slopes/distances.
 * Replaces gpxpy + geopy with DOMParser + Haversine.
 */

/**
 * Haversine distance between two lat/lon points in meters.
 */
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Parse a GPX XML string into track points with cumulative distance.
 * @param {string} gpxText - Raw GPX XML content
 * @returns {Array<{lat, lon, elevation, distance_from_start}>}
 */
export function parseGPX(gpxText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxText, 'application/xml');

    const trkpts = doc.querySelectorAll('trkpt');
    const points = [];
    let cumulativeDist = 0;

    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const eleEl = pt.querySelector('ele');
        const elevation = eleEl ? parseFloat(eleEl.textContent) : 0;

        if (i > 0 && points.length > 0) {
            const prev = points[points.length - 1];
            cumulativeDist += haversine(prev.lat, prev.lon, lat, lon);
        }

        points.push({ lat, lon, elevation, distance_from_start: cumulativeDist });
    }

    return points;
}

/**
 * Extract the track name from parsed GPX XML.
 */
export function getGPXName(gpxText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxText, 'application/xml');

    // Try <trk><name>
    const trkName = doc.querySelector('trk > name');
    if (trkName && trkName.textContent.trim()) return trkName.textContent.trim();

    // Try <metadata><name>
    const metaName = doc.querySelector('metadata > name');
    if (metaName && metaName.textContent.trim()) return metaName.textContent.trim();

    return 'Unnamed Route';
}

/**
 * Compute slope segments from track points.
 * @returns {Array<{start_dist, end_dist, slope_pct}>}
 */
export function computeSlopes(points) {
    const slopes = [];
    for (let i = 1; i < points.length; i++) {
        const dDist = points[i].distance_from_start - points[i - 1].distance_from_start;
        const dElev = points[i].elevation - points[i - 1].elevation;

        if (dDist < 0.5) continue; // Skip GPS noise

        let slope = (dElev / dDist) * 100;
        slope = Math.max(-20, Math.min(20, slope)); // clamp

        slopes.push({
            start_dist: points[i - 1].distance_from_start,
            end_dist: points[i].distance_from_start,
            slope_pct: slope,
        });
    }
    return slopes;
}

/**
 * Look up slope at a given distance.
 */
export function getSlopeAtDistance(slopes, distance) {
    for (const seg of slopes) {
        if (seg.start_dist <= distance && distance < seg.end_dist) {
            return seg.slope_pct;
        }
    }
    return 0;
}

/**
 * Interpolate elevation at a given distance.
 */
export function getElevationAtDistance(points, distance) {
    if (!points.length) return 0;
    if (distance <= 0) return points[0].elevation;
    if (distance >= points[points.length - 1].distance_from_start) {
        return points[points.length - 1].elevation;
    }

    for (let i = 1; i < points.length; i++) {
        if (points[i].distance_from_start >= distance) {
            const prev = points[i - 1];
            const curr = points[i];
            const segLen = curr.distance_from_start - prev.distance_from_start;
            if (segLen < 0.01) return prev.elevation;
            const ratio = (distance - prev.distance_from_start) / segLen;
            return prev.elevation + ratio * (curr.elevation - prev.elevation);
        }
    }
    return points[points.length - 1].elevation;
}

/**
 * Total route distance in meters.
 */
export function getTotalDistance(points) {
    if (!points.length) return 0;
    return points[points.length - 1].distance_from_start;
}

/**
 * Compute total elevation gain.
 */
export function getElevationGain(points) {
    let gain = 0;
    for (let i = 1; i < points.length; i++) {
        const delta = points[i].elevation - points[i - 1].elevation;
        if (delta > 0) gain += delta;
    }
    return gain;
}
