/**
 * Routes view — route selection, GPX import, GPX generation, and route management.
 */
import { listRoutes, importRoute, deleteRoute, getRoute } from '../storage/routes.js';
import { ensureDefaultRoutes } from '../data/default-routes.js';
import { navigateTo } from '../router.js';
import { generateRoute, downloadGeneratedGPX } from '../gpx/generator.js';

let selectedKey = null;
let allRoutes = [];
let currentFilters = null;

const ROUTE_TYPE_LABELS = {
    linear_climb: 'Steady climb',
    rolling: 'Rolling hills',
    climb_then_descent: 'Climb then descent',
    false_flat: 'False flat',
    punchy: 'Punchy efforts',
    valley: 'Valley profile',
    flat: 'Flat',
    climb: 'Climb',
    descent: 'Descent',
    mixed: 'Mixed terrain',
};

const DISTANCE_BAND_LABELS = {
    short: 'Short',
    medium: 'Medium',
    long: 'Long',
    epic: 'Epic',
};

const DIFFICULTY_LABELS = {
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
};

const SOURCE_LABELS = {
    imported: 'Imported',
    generated: 'Generated',
    default: 'Featured',
};

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function difficultyRank(value) {
    return { easy: 1, medium: 2, hard: 3 }[value] || 0;
}

function formatRouteType(value) {
    return ROUTE_TYPE_LABELS[value] || 'Custom';
}

function formatDistanceBand(value) {
    return DISTANCE_BAND_LABELS[value] || 'Custom';
}

function formatDifficulty(value) {
    return DIFFICULTY_LABELS[value] || 'Custom';
}

function formatSource(value) {
    return SOURCE_LABELS[value] || 'Stored';
}

function buildFallbackDescription(route) {
    return `${formatRouteType(route.route_type)} route with ${formatDifficulty(route.difficulty).toLowerCase()} difficulty.`;
}

function getSelectedRoute() {
    return allRoutes.find((route) => route.key === selectedKey) || null;
}

function getVisibleRoutes() {
    const query = currentFilters.query.trim().toLowerCase();

    return allRoutes
        .filter((route) => {
            if (query) {
                const haystack = [
                    route.name,
                    route.description,
                    formatRouteType(route.route_type),
                    formatDifficulty(route.difficulty),
                    formatDistanceBand(route.distance_band),
                ].join(' ').toLowerCase();
                if (!haystack.includes(query)) return false;
            }

            if (currentFilters.type !== 'all' && route.route_type !== currentFilters.type) return false;
            if (currentFilters.difficulty !== 'all' && route.difficulty !== currentFilters.difficulty) return false;
            if (currentFilters.distanceBand !== 'all' && route.distance_band !== currentFilters.distanceBand) return false;
            return true;
        })
        .sort((a, b) => {
            switch (currentFilters.sort) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'distance_asc':
                    return a.distance_km - b.distance_km;
                case 'distance_desc':
                    return b.distance_km - a.distance_km;
                case 'elevation_desc':
                    return b.elevation_gain - a.elevation_gain;
                case 'difficulty_desc':
                    return difficultyRank(b.difficulty) - difficultyRank(a.difficulty)
                        || b.elevation_gain - a.elevation_gain;
                case 'recent':
                default:
                    return String(b.imported_at || '').localeCompare(String(a.imported_at || ''));
            }
        });
}

function syncRangeControl(numberInput, rangeInput) {
    const applyValue = (value) => {
        numberInput.value = value;
        rangeInput.value = value;
    };

    rangeInput.addEventListener('input', () => applyValue(rangeInput.value));
    numberInput.addEventListener('input', () => {
        let next = numberInput.value;
        if (next === '') return;
        const min = Number(rangeInput.min);
        const max = Number(rangeInput.max);
        next = Math.min(max, Math.max(min, Number(next)));
        applyValue(next);
    });
}

export async function mount(container) {
    selectedKey = null;
    currentFilters = {
        query: '',
        type: 'all',
        difficulty: 'all',
        distanceBand: 'all',
        sort: 'recent',
    };

    container.innerHTML = `
    <style>
        .routes-page {
            padding-bottom: 2rem;
        }
        .routes-shell {
            width: 100%;
            max-width: 980px;
            min-height: calc(100vh - 11rem);
            display: grid;
            grid-template-rows: auto auto minmax(0, 1fr) auto;
            gap: 0.9rem;
        }
        .routes-card {
            padding: 1rem;
        }
        .routes-toolbar {
            display: grid;
            gap: 0.9rem;
        }
        .toolbar-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.8rem;
            flex-wrap: wrap;
        }
        .toolbar-copy {
            flex: 1;
            min-width: 220px;
        }
        .toolbar-title {
            font-size: 1rem;
            font-weight: 800;
            color: var(--text);
        }
        .toolbar-subtitle {
            font-size: 0.74rem;
            color: var(--text-muted);
            margin-top: 0.15rem;
            line-height: 1.5;
        }
        .toolbar-actions {
            display: flex;
            gap: 0.7rem;
            flex-wrap: wrap;
        }
        .compact-btn {
            min-width: 168px;
        }
        .routes-drop-zone {
            border: 1px dashed var(--border-hover);
            border-radius: var(--radius-lg);
            padding: 1rem 1.1rem;
            background: rgba(255,255,255,0.03);
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .routes-drop-zone:hover,
        .routes-drop-zone.dragover {
            border-color: var(--primary);
            background: var(--primary-dim);
        }
        .routes-drop-zone input {
            display: none;
        }
        .drop-title {
            font-size: 0.78rem;
            font-weight: 700;
            color: var(--text);
        }
        .drop-copy {
            font-size: 0.7rem;
            color: var(--text-muted);
            margin-top: 0.2rem;
        }
        .routes-filters {
            display: grid;
            gap: 0.9rem;
        }
        .filters-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.4fr) repeat(4, minmax(0, 1fr));
            gap: 0.7rem;
        }
        .filters-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.8rem;
            flex-wrap: wrap;
            font-size: 0.72rem;
            color: var(--text-muted);
        }
        .routes-library {
            display: grid;
            grid-template-rows: auto minmax(0, 1fr);
            min-height: 0;
        }
        .routes-library-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.8rem;
            margin-bottom: 0.85rem;
        }
        .routes-library-title {
            font-size: 0.72rem;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: var(--text-muted);
        }
        .routes-library-meta {
            font-size: 0.68rem;
            color: var(--text-muted);
        }
        .routes-list-scroll {
            min-height: 0;
            overflow: auto;
            padding-right: 0.2rem;
        }
        .routes-grid {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 0.8rem;
        }
        .route-card {
            padding: 1rem;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 0.9rem;
            border: 1px solid var(--glass-border);
        }
        .route-card:hover {
            transform: translateY(-1px);
        }
        .route-card.selected {
            border-color: rgba(249,115,22,0.6);
            box-shadow: 0 0 0 1px rgba(249,115,22,0.2), var(--shadow-md);
            background: rgba(255,255,255,0.06);
        }
        .route-card-top {
            display: flex;
            justify-content: space-between;
            gap: 0.8rem;
            align-items: flex-start;
        }
        .route-title-wrap {
            min-width: 0;
        }
        .route-title-row {
            display: flex;
            align-items: center;
            gap: 0.55rem;
            min-width: 0;
        }
        .route-emoji {
            font-size: 1.1rem;
            flex-shrink: 0;
        }
        .route-name {
            font-size: 0.92rem;
            font-weight: 800;
            color: var(--text);
            word-break: break-word;
        }
        .route-desc {
            font-size: 0.72rem;
            color: var(--text-muted);
            margin-top: 0.3rem;
            line-height: 1.55;
        }
        .delete-btn {
            background: none;
            border: 1px solid var(--border);
            color: var(--text-muted);
            cursor: pointer;
            font-size: 0.72rem;
            padding: 0.35rem 0.55rem;
            border-radius: 8px;
            transition: all 0.2s;
        }
        .delete-btn:hover {
            color: #EF4444;
            border-color: rgba(239,68,68,0.35);
            background: rgba(239,68,68,0.08);
        }
        .route-stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.55rem;
        }
        .route-stat {
            padding: 0.65rem 0.7rem;
            border-radius: 12px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.05);
        }
        .route-stat .val {
            font-size: 1rem;
            font-weight: 800;
            color: var(--text);
            font-variant-numeric: tabular-nums;
        }
        .route-stat .lbl {
            font-size: 0.56rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-top: 0.1rem;
        }
        .route-stat .val.elev-color {
            color: var(--color-elevation);
        }
        .route-tags {
            display: flex;
            gap: 0.45rem;
            flex-wrap: wrap;
        }
        .route-tag {
            padding: 0.28rem 0.58rem;
            border-radius: var(--radius-full);
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.08);
            font-size: 0.58rem;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-secondary);
        }
        .route-tag.primary {
            color: var(--primary);
            background: var(--primary-dim);
            border-color: rgba(249,115,22,0.22);
        }
        .route-tag.blue {
            color: var(--secondary);
            background: rgba(14,165,233,0.12);
            border-color: rgba(14,165,233,0.18);
        }
        .route-tag.purple {
            color: var(--color-elevation);
            background: rgba(167,139,250,0.12);
            border-color: rgba(167,139,250,0.18);
        }
        .routes-selection {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 1rem;
        }
        .selection-label {
            font-size: 0.58rem;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: var(--text-muted);
        }
        .selection-name {
            font-size: 1rem;
            font-weight: 800;
            color: var(--text);
            margin-top: 0.2rem;
        }
        .selection-meta {
            font-size: 0.72rem;
            color: var(--text-muted);
            margin-top: 0.25rem;
            line-height: 1.55;
        }
        .selection-actions {
            display: flex;
            flex-direction: column;
            gap: 0.7rem;
            min-width: 220px;
        }
        .selection-actions .back-link {
            justify-content: center;
        }
        .gen-overlay {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: rgba(0,0,0,0.65);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease;
            padding: 1rem;
        }
        .gen-overlay.open {
            opacity: 1;
            pointer-events: auto;
        }
        .gen-modal {
            background: var(--surface);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-xl);
            width: 100%;
            max-width: 560px;
            max-height: 92vh;
            overflow-y: auto;
            box-shadow: var(--shadow-lg);
            animation: scaleIn 0.3s ease;
        }
        .gen-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.3rem 1.4rem 0.9rem;
            border-bottom: 1px solid var(--border);
        }
        .gen-modal-title {
            font-size: 1.05rem;
            font-weight: 800;
            letter-spacing: 0.04em;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .gen-close-btn {
            background: none;
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 1.1rem;
            width: 34px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .gen-close-btn:hover {
            color: var(--text);
            border-color: var(--border-hover);
            background: rgba(255,255,255,0.04);
        }
        .gen-modal-body {
            padding: 1.2rem 1.4rem;
        }
        .gen-modal-footer {
            padding: 0.9rem 1.4rem 1.3rem;
            border-top: 1px solid var(--border);
            display: flex;
            gap: 0.7rem;
            flex-wrap: wrap;
        }
        .gen-section {
            padding: 0.95rem;
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            background: rgba(255,255,255,0.03);
            margin-bottom: 0.95rem;
        }
        .gen-section-title {
            font-size: 0.58rem;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 0.8rem;
        }
        .gen-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.8rem;
        }
        .metric-input {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 88px;
            gap: 0.7rem;
            align-items: center;
        }
        .form-range {
            width: 100%;
            accent-color: var(--primary);
        }
        .diff-group {
            display: flex;
            gap: 0.4rem;
        }
        .diff-option {
            flex: 1;
            text-align: center;
            padding: 0.55rem 0.3rem;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 0.72rem;
            font-weight: 600;
            cursor: pointer;
            color: var(--text-muted);
            background: transparent;
            transition: all 0.2s;
            font-family: inherit;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }
        .diff-option:hover {
            border-color: var(--border-hover);
            color: var(--text-secondary);
        }
        .diff-option.active {
            border-color: var(--primary);
            color: var(--primary);
            background: var(--primary-dim);
        }
        .elev-preview {
            width: 100%;
            height: 150px;
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            margin-top: 0.5rem;
            margin-bottom: 0.5rem;
            position: relative;
            overflow: hidden;
        }
        .elev-preview canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
        .elev-preview-empty {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: 0.72rem;
            font-weight: 500;
        }
        .elev-stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 0.8rem;
            margin-top: 0.5rem;
        }
        .elev-stat-val {
            font-size: 0.95rem;
            font-weight: 800;
            color: var(--primary);
            font-variant-numeric: tabular-nums;
        }
        .elev-stat-lbl {
            font-size: 0.52rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }
        .gen-toast {
            position: fixed;
            bottom: 5rem;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: var(--surface);
            border: 1px solid rgba(249,115,22,0.4);
            color: var(--primary);
            font-size: 0.8rem;
            font-weight: 600;
            padding: 0.6rem 1.4rem;
            border-radius: var(--radius-full);
            box-shadow: var(--shadow-md);
            opacity: 0;
            pointer-events: none;
            transition: all 0.35s ease;
            z-index: 200;
        }
        .gen-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        @media (max-width: 860px) {
            .routes-shell {
                min-height: auto;
                grid-template-rows: auto auto auto auto;
            }
            .filters-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .routes-selection {
                grid-template-columns: 1fr;
            }
            .selection-actions {
                min-width: 0;
            }
            .routes-list-scroll {
                max-height: 50vh;
            }
        }
        @media (max-width: 560px) {
            .routes-page {
                padding-left: 1rem;
                padding-right: 1rem;
            }
            .filters-grid,
            .gen-row,
            .metric-input,
            .elev-stats {
                grid-template-columns: 1fr;
            }
            .toolbar-actions {
                width: 100%;
            }
            .toolbar-actions .btn {
                width: 100%;
            }
            .route-stats {
                grid-template-columns: 1fr 1fr;
            }
            .route-stats .route-stat:last-child {
                grid-column: span 2;
            }
            .gen-modal-footer {
                flex-direction: column;
            }
        }
    </style>

    <div class="page routes-page">
        <div class="brand-header">
            <h1 class="brand-title">UNCHAINED PROJECT</h1>
            <p class="brand-subtitle">Route Library</p>
        </div>

        <div class="routes-shell">
            <section class="card routes-card routes-toolbar">
                <div class="toolbar-top">
                    <div class="toolbar-copy">
                        <div class="toolbar-title">Build, import, and manage routes</div>
                    </div>
                    <div class="toolbar-actions">
                        <button class="btn btn-primary compact-btn" id="generateBtn">Generate Route</button>
                        <button class="btn btn-secondary compact-btn" id="browseBtn">Import GPX</button>
                    </div>
                </div>
                <div class="routes-drop-zone" id="dropZone">
                    <div class="drop-title">Drag and drop GPX files here</div>
                    <div class="drop-copy">Multiple routes are supported and new imports will no longer replace older ones with the same name.</div>
                    <input type="file" id="gpxInput" accept=".gpx" multiple>
                </div>
            </section>

            <section class="card routes-card routes-filters">
                <div class="filters-grid">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="routeSearch">Search</label>
                        <input class="form-input" id="routeSearch" type="text" placeholder="Search by name, description, type, or difficulty">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="routeTypeFilter">Type</label>
                        <select class="form-select" id="routeTypeFilter">
                            <option value="all">All types</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="routeDifficultyFilter">Difficulty</label>
                        <select class="form-select" id="routeDifficultyFilter">
                            <option value="all">All difficulties</option>
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="routeDistanceFilter">Distance</label>
                        <select class="form-select" id="routeDistanceFilter">
                            <option value="all">All distances</option>
                            <option value="short">Short</option>
                            <option value="medium">Medium</option>
                            <option value="long">Long</option>
                            <option value="epic">Epic</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="routeSort">Sort</label>
                        <select class="form-select" id="routeSort">
                            <option value="recent">Most recent</option>
                            <option value="name">Name</option>
                            <option value="distance_asc">Distance: short to long</option>
                            <option value="distance_desc">Distance: long to short</option>
                            <option value="elevation_desc">Elevation: high to low</option>
                            <option value="difficulty_desc">Difficulty: hard to easy</option>
                        </select>
                    </div>
                </div>
                <div class="filters-summary">
                    <span id="routesSummary">Loading routes…</span>
                    <button class="btn btn-ghost" id="clearFiltersBtn" type="button">Clear filters</button>
                </div>
            </section>

            <section class="card routes-card routes-library">
                <div class="routes-library-head">
                    <div class="routes-library-title">Available routes</div>
                    <div class="routes-library-meta" id="routesMeta">0 routes</div>
                </div>
                <div class="routes-list-scroll">
                    <div class="routes-grid" id="routesList"></div>
                </div>
            </section>

            <section class="card routes-card routes-selection">
                <div>
                    <div class="selection-label">Selected route</div>
                    <div class="selection-name" id="selectedRouteName">No route selected</div>
                    <div class="selection-meta" id="selectedRouteMeta">Choose a route from the library, import a GPX file, or generate a new one.</div>
                </div>
                <div class="selection-actions">
                    <button class="btn btn-primary btn-full disabled" id="startBtn">Start Ride</button>
                    <a class="back-link" href="#home">← Back to home</a>
                </div>
            </section>
        </div>
    </div>

    <div class="gen-overlay" id="genOverlay">
        <div class="gen-modal">
            <div class="gen-modal-header">
                <span class="gen-modal-title">Generate Route</span>
                <button class="gen-close-btn" id="genCloseBtn" type="button">✕</button>
            </div>
            <div class="gen-modal-body">
                <div class="gen-section">
                    <div class="gen-section-title">Identity</div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="genName">Route name</label>
                        <input class="form-input" type="text" id="genName" placeholder="My custom route" value="Generated Route">
                    </div>
                </div>

                <div class="gen-section">
                    <div class="gen-section-title">Targets</div>
                    <div class="gen-row">
                        <div class="form-group">
                            <label class="form-label" for="genDistance">Distance (km)</label>
                            <div class="metric-input">
                                <input class="form-range" type="range" id="genDistanceRange" min="1" max="300" step="0.5" value="20">
                                <input class="form-input" type="number" id="genDistance" min="1" max="300" step="0.5" value="20">
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="genElevation">Elevation gain (m)</label>
                            <div class="metric-input">
                                <input class="form-range" type="range" id="genElevationRange" min="0" max="5000" step="25" value="500">
                                <input class="form-input" type="number" id="genElevation" min="0" max="5000" step="25" value="500">
                            </div>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="genGradient">Maximum gradient (%)</label>
                        <div class="metric-input">
                            <input class="form-range" type="range" id="genGradientRange" min="3" max="25" step="1" value="12">
                            <input class="form-input" type="number" id="genGradient" min="3" max="25" step="1" value="12">
                        </div>
                    </div>
                </div>

                <div class="gen-section">
                    <div class="gen-section-title">Profile</div>
                    <div class="gen-row">
                        <div class="form-group">
                            <label class="form-label" for="genType">Route type</label>
                            <select class="form-select" id="genType">
                                <option value="linear_climb">Steady climb</option>
                                <option value="rolling" selected>Rolling hills</option>
                                <option value="climb_then_descent">Climb then descent</option>
                                <option value="false_flat">False flat</option>
                                <option value="punchy">Punchy efforts</option>
                                <option value="valley">Valley profile</option>
                            </select>
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label">Difficulty</label>
                            <div class="diff-group" id="diffGroup">
                                <button class="diff-option" data-diff="easy" type="button">Easy</button>
                                <button class="diff-option active" data-diff="medium" type="button">Medium</button>
                                <button class="diff-option" data-diff="hard" type="button">Hard</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="gen-section" style="margin-bottom:0;">
                    <div class="gen-section-title">Preview</div>
                    <label class="form-label">Elevation preview</label>
                    <div class="elev-preview" id="elevPreview">
                        <canvas id="elevCanvas"></canvas>
                        <div class="elev-preview-empty" id="elevEmpty">Click preview to inspect the generated elevation profile.</div>
                    </div>
                    <div class="elev-stats" id="elevStats" style="display:none;">
                        <div><div class="elev-stat-val" id="statDistance">—</div><div class="elev-stat-lbl">Distance</div></div>
                        <div><div class="elev-stat-val" id="statGain">—</div><div class="elev-stat-lbl">Gain</div></div>
                        <div><div class="elev-stat-val" id="statMaxGrad">—</div><div class="elev-stat-lbl">Max grade</div></div>
                        <div><div class="elev-stat-val" id="statPoints">—</div><div class="elev-stat-lbl">Points</div></div>
                    </div>
                </div>
            </div>
            <div class="gen-modal-footer">
                <button class="btn btn-secondary" id="genPreviewBtn" type="button" style="flex:1;">Preview</button>
                <button class="btn btn-primary" id="genConfirmBtn" type="button" style="flex:1;">Download & save</button>
            </div>
        </div>
    </div>

    <div class="gen-toast" id="genToast">Route saved to your library.</div>
    `;

    const $ = (selector) => container.querySelector(selector);

    await ensureDefaultRoutes();
    await refreshRoutes();

    const startBtn = $('#startBtn');
    const browseBtn = $('#browseBtn');
    const gpxInput = $('#gpxInput');
    const dropZone = $('#dropZone');

    browseBtn.onclick = () => gpxInput.click();
    dropZone.onclick = (event) => {
        if (event.target === gpxInput) return;
        gpxInput.click();
    };

    startBtn.onclick = async () => {
        if (!selectedKey) return;
        const route = await getRoute(selectedKey);
        if (!route) return;
        sessionStorage.setItem('fz_selected_route', JSON.stringify(route));
        navigateTo('ride');
    };

    gpxInput.onchange = async (event) => {
        const files = Array.from(event.target.files || []);
        for (const file of files) await handleGPXFile(file);
        gpxInput.value = '';
    };

    dropZone.ondragover = (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = async (event) => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        const files = Array.from(event.dataTransfer.files || []).filter((file) => /\.gpx$/i.test(file.name));
        for (const file of files) await handleGPXFile(file);
    };

    $('#routeSearch').addEventListener('input', (event) => {
        currentFilters.query = event.target.value;
        renderRoutes();
    });
    $('#routeTypeFilter').addEventListener('change', (event) => {
        currentFilters.type = event.target.value;
        renderRoutes();
    });
    $('#routeDifficultyFilter').addEventListener('change', (event) => {
        currentFilters.difficulty = event.target.value;
        renderRoutes();
    });
    $('#routeDistanceFilter').addEventListener('change', (event) => {
        currentFilters.distanceBand = event.target.value;
        renderRoutes();
    });
    $('#routeSort').addEventListener('change', (event) => {
        currentFilters.sort = event.target.value;
        renderRoutes();
    });
    $('#clearFiltersBtn').onclick = () => {
        currentFilters = {
            query: '',
            type: 'all',
            difficulty: 'all',
            distanceBand: 'all',
            sort: 'recent',
        };
        $('#routeSearch').value = '';
        $('#routeTypeFilter').value = 'all';
        $('#routeDifficultyFilter').value = 'all';
        $('#routeDistanceFilter').value = 'all';
        $('#routeSort').value = 'recent';
        renderRoutes();
    };

    const overlay = $('#genOverlay');
    const closeBtn = $('#genCloseBtn');
    const previewBtn = $('#genPreviewBtn');
    const confirmBtn = $('#genConfirmBtn');
    const diffGroup = $('#diffGroup');
    let lastResult = null;

    syncRangeControl($('#genDistance'), $('#genDistanceRange'));
    syncRangeControl($('#genElevation'), $('#genElevationRange'));
    syncRangeControl($('#genGradient'), $('#genGradientRange'));

    $('#generateBtn').onclick = () => {
        overlay.classList.add('open');
        lastResult = null;
        $('#elevEmpty').style.display = '';
        $('#elevStats').style.display = 'none';
        clearCanvas();
    };

    closeBtn.onclick = () => overlay.classList.remove('open');
    overlay.onclick = (event) => {
        if (event.target === overlay) overlay.classList.remove('open');
    };

    diffGroup.querySelectorAll('.diff-option').forEach((button) => {
        button.onclick = () => {
            diffGroup.querySelectorAll('.diff-option').forEach((candidate) => candidate.classList.remove('active'));
            button.classList.add('active');
        };
    });

    previewBtn.onclick = () => {
        lastResult = runGenerate();
        if (lastResult) drawPreview(lastResult);
    };

    confirmBtn.onclick = async () => {
        if (!lastResult) {
            lastResult = runGenerate();
            if (lastResult) drawPreview(lastResult);
        }
        if (!lastResult) return;
        if (!lastResult.validation.valid) {
            alert('This preview does not satisfy the requested constraints yet. Adjust the settings and preview the route again before saving it.');
            return;
        }

        const name = $('#genName').value.trim() || 'Generated Route';
        const selectedType = $('#genType').value;
        const selectedDifficulty = getSelectedDifficulty();

        downloadGeneratedGPX(name, lastResult.gpxXml);

        try {
            const route = await importRoute(lastResult.gpxXml, {
                name,
                description: `${formatRouteType(selectedType)} route generated for ${selectedDifficulty} difficulty.`,
                emoji: '⚡',
                route_type: selectedType,
                difficulty: selectedDifficulty,
                source: 'generated',
            });
            selectedKey = route.key;
            await refreshRoutes();
        } catch (err) {
            console.warn('[GENERATOR] Could not import route into the library:', err);
        }

        const toast = $('#genToast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);

        overlay.classList.remove('open');
    };

    function getSelectedDifficulty() {
        const active = diffGroup.querySelector('.diff-option.active');
        return active ? active.dataset.diff : 'medium';
    }

    function runGenerate() {
        const name = $('#genName').value.trim() || 'Generated Route';
        const distance = parseFloat($('#genDistance').value);
        const elevation = parseFloat($('#genElevation').value);
        const type = $('#genType').value;
        const maxGradient = parseFloat($('#genGradient').value);
        const difficulty = getSelectedDifficulty();

        const hasValidDistance = Number.isFinite(distance) && distance > 0;
        const hasValidElevation = Number.isFinite(elevation) && elevation >= 0;
        const hasValidGradient = Number.isFinite(maxGradient) && maxGradient >= 3 && maxGradient <= 25;

        if (!hasValidDistance || !hasValidElevation || !hasValidGradient) {
            alert('Please provide valid route settings before generating a preview.');
            return null;
        }

        const result = generateRoute({
            route_name: name,
            total_distance_km: distance,
            elevation_gain_m: elevation,
            route_type: type,
            max_gradient_percent: maxGradient,
            difficulty,
        });

        if (!result.validation.valid) {
            console.warn('[GENERATOR] Validation warnings:', result.validation);
        }

        return result;
    }

    function clearCanvas() {
        const canvas = $('#elevCanvas');
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth * 2;
        canvas.height = canvas.offsetHeight * 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawPreview(result) {
        const canvas = $('#elevCanvas');
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 2;

        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);

        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        const padding = { top: 12, right: 12, bottom: 8, left: 12 };

        ctx.clearRect(0, 0, width, height);
        $('#elevEmpty').style.display = 'none';

        const elevations = result.elevations;
        const minElevation = Math.min(...elevations);
        const maxElevation = Math.max(...elevations);
        const range = maxElevation - minElevation || 1;

        const drawWidth = width - padding.left - padding.right;
        const drawHeight = height - padding.top - padding.bottom;
        const xStep = drawWidth / Math.max(elevations.length - 1, 1);

        const fillGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        fillGradient.addColorStop(0, 'rgba(249,115,22,0.35)');
        fillGradient.addColorStop(1, 'rgba(249,115,22,0.02)');

        ctx.beginPath();
        ctx.moveTo(padding.left, height - padding.bottom);
        for (let i = 0; i < elevations.length; i += 1) {
            const x = padding.left + i * xStep;
            const y = padding.top + drawHeight - ((elevations[i] - minElevation) / range) * drawHeight;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(padding.left + (elevations.length - 1) * xStep, height - padding.bottom);
        ctx.closePath();
        ctx.fillStyle = fillGradient;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < elevations.length; i += 1) {
            const x = padding.left + i * xStep;
            const y = padding.top + drawHeight - ((elevations[i] - minElevation) / range) * drawHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#F97316';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        $('#elevStats').style.display = '';
        $('#statDistance').textContent = `${result.validation.actualDistanceKm.toFixed(1)}km`;
        $('#statGain').textContent = `${result.validation.actualGain}m`;
        $('#statMaxGrad').textContent = `${result.validation.maxGradient}%`;
        $('#statPoints').textContent = result.numPoints;
    }

    async function refreshRoutes() {
        allRoutes = await listRoutes();
        renderRoutes();
    }

    async function handleGPXFile(file) {
        try {
            const route = await importRoute(file, { source: 'imported' });
            selectedKey = route.key;
            await refreshRoutes();
        } catch (err) {
            alert(`Error importing GPX: ${err.message}`);
        }
    }

    function renderTypeOptions() {
        const typeFilter = $('#routeTypeFilter');
        const uniqueTypes = [...new Set(allRoutes.map((route) => route.route_type).filter(Boolean))];
        const currentValue = currentFilters.type;

        typeFilter.innerHTML = [
            '<option value="all">All types</option>',
            ...uniqueTypes
                .sort((a, b) => formatRouteType(a).localeCompare(formatRouteType(b)))
                .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(formatRouteType(type))}</option>`),
        ].join('');

        typeFilter.value = uniqueTypes.includes(currentValue) ? currentValue : 'all';
        currentFilters.type = typeFilter.value;
    }

    function renderSelectionState(visibleRoutes) {
        const startButton = $('#startBtn');
        const nameEl = $('#selectedRouteName');
        const metaEl = $('#selectedRouteMeta');
        const route = getSelectedRoute();

        if (!route) {
            startButton.classList.add('disabled');
            nameEl.textContent = 'No route selected';
            metaEl.textContent = 'Choose a route from the library, import a GPX file, or generate a new one.';
            return;
        }

        startButton.classList.remove('disabled');
        nameEl.textContent = route.name;
        const isVisible = visibleRoutes.some((candidate) => candidate.key === route.key);
        const visibilityHint = isVisible ? '' : ' This route is currently hidden by your filters.';
        metaEl.textContent = `${route.distance_km.toFixed(1)} km • ${route.elevation_gain} m elevation • ${formatRouteType(route.route_type)} • ${formatDifficulty(route.difficulty)}.${visibilityHint}`;
    }

    function renderRoutes() {
        renderTypeOptions();

        const visibleRoutes = getVisibleRoutes();
        const list = $('#routesList');
        const totalCount = allRoutes.length;

        $('#routesSummary').textContent = totalCount === visibleRoutes.length
            ? `Showing all ${totalCount} routes`
            : `Showing ${visibleRoutes.length} of ${totalCount} routes`;
        $('#routesMeta').textContent = `${visibleRoutes.length} visible • ${totalCount} stored`;

        if (!visibleRoutes.length) {
            list.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;">
                    <div class="empty-state-icon">🗺️</div>
                    No routes match the current filters. Try clearing the filters or import a new GPX file.
                </div>
            `;
            renderSelectionState(visibleRoutes);
            return;
        }

        list.innerHTML = visibleRoutes.map((route) => `
            <div class="card route-card ${selectedKey === route.key ? 'selected' : ''}" data-key="${escapeHtml(route.key)}">
                <div class="route-card-top">
                    <div class="route-title-wrap">
                        <div class="route-title-row">
                            <span class="route-emoji">${escapeHtml(route.emoji || '🚴')}</span>
                            <span class="route-name">${escapeHtml(route.name)}</span>
                        </div>
                        <div class="route-desc">${escapeHtml(route.description || buildFallbackDescription(route))}</div>
                    </div>
                    <button class="delete-btn" data-delete="${escapeHtml(route.key)}" title="Delete route" type="button">Delete</button>
                </div>
                <div class="route-stats">
                    <div class="route-stat"><div class="val">${route.distance_km.toFixed(1)}</div><div class="lbl">km</div></div>
                    <div class="route-stat"><div class="val elev-color">${route.elevation_gain}</div><div class="lbl">Elevation</div></div>
                    <div class="route-stat"><div class="val">${formatDifficulty(route.difficulty)}</div><div class="lbl">Difficulty</div></div>
                </div>
                <div class="route-tags">
                    <span class="route-tag primary">${escapeHtml(formatRouteType(route.route_type))}</span>
                    <span class="route-tag blue">${escapeHtml(formatDistanceBand(route.distance_band))}</span>
                    <span class="route-tag purple">${escapeHtml(formatSource(route.source))}</span>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.route-card').forEach((card) => {
            card.onclick = (event) => {
                if (event.target.closest('.delete-btn')) return;
                selectedKey = card.dataset.key;
                renderRoutes();
            };
        });

        list.querySelectorAll('.delete-btn').forEach((button) => {
            button.onclick = async (event) => {
                event.stopPropagation();
                const key = button.dataset.delete;
                if (!confirm('Delete this route from the library?')) return;
                await deleteRoute(key);
                if (selectedKey === key) selectedKey = null;
                await refreshRoutes();
            };
        });

        renderSelectionState(visibleRoutes);
    }
}

export function unmount() {
    selectedKey = null;
    allRoutes = [];
    currentFilters = null;
}
