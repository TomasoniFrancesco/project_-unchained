/**
 * GPX export — generate GPX XML from ride track samples and trigger download.
 * Port of unchained_project/storage/export.py
 */

/**
 * Build a GPX XML string from track samples.
 * @param {string} routeName
 * @param {Date} startedAt
 * @param {Array<{lat, lon, ele, elapsed_s}>} samples
 * @returns {string} GPX XML
 */
export function buildGPX(routeName, startedAt, samples) {
    const pts = samples.map(s => {
        const time = new Date(startedAt.getTime() + s.elapsed_s * 1000).toISOString();
        return `      <trkpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><ele>${s.ele.toFixed(1)}</ele><time>${time}</time></trkpt>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="UNCHAINED_PROJECT_WEB"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(routeName)}</name>
    <time>${startedAt.toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(routeName)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Download a GPX string as a file.
 */
export function downloadGPX(routeName, startedAt, samples) {
    const xml = buildGPX(routeName, startedAt, samples);
    const slug = routeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'ride';
    const ts = startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const filename = `${ts}_${slug}.gpx`;

    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`[EXPORT] Downloaded: ${filename}`);
    return filename;
}

function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
