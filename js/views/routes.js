/**
 * Routes view — route selection, GPX import, GPX generation, start ride.
 */
import { listRoutes, importRoute, deleteRoute, getRoute } from '../storage/routes.js';
import { ensureDefaultRoutes } from '../data/default-routes.js';
import { navigateTo } from '../router.js';
import { generateRoute, downloadGeneratedGPX } from '../gpx/generator.js';

let selectedKey = null;

/* ── Route-type label map ── */
const ROUTE_TYPE_LABELS = {
    linear_climb:        'Salita costante',
    rolling:             'Sali e scendi',
    climb_then_descent:  'Salita + discesa',
    false_flat:          'Falso piano',
    punchy:              'Pianura con strappi',
    valley:              'Discesa, pianura, risalita',
};

export async function mount(container) {
    selectedKey = null;

    container.innerHTML = `
    <style>
        .routes-grid { width:100%; max-width:580px; display:flex; flex-direction:column; gap:0.7rem; }
        .start-area { width:100%; max-width:580px; margin-top:1.5rem; }
        .route-stat .val.elev-color { color: var(--color-elevation); }
        .import-area { width:100%; max-width:580px; margin-top:1rem; }
        .drop-zone { border:2px dashed var(--border); border-radius:var(--radius-lg); padding:1.5rem; text-align:center; cursor:pointer; transition:all 0.2s; color:var(--text-muted); font-size:0.78rem; }
        .drop-zone:hover, .drop-zone.dragover { border-color:var(--primary); color:var(--primary); background:var(--primary-dim); }
        .drop-zone input { display:none; }
        .delete-btn { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.7rem; padding:0.3rem 0.5rem; border-radius:6px; transition:all 0.2s; }
        .delete-btn:hover { color:#EF4444; background:rgba(239,68,68,0.1); }
        .generate-area { width:100%; max-width:580px; margin-top:0.8rem; }

        /* ── Generator Modal ── */
        .gen-overlay {
            position:fixed; inset:0; z-index:100;
            background:rgba(0,0,0,0.65);
            backdrop-filter:blur(8px);
            -webkit-backdrop-filter:blur(8px);
            display:flex; align-items:center; justify-content:center;
            opacity:0; pointer-events:none;
            transition:opacity 0.25s ease;
            padding:1rem;
        }
        .gen-overlay.open { opacity:1; pointer-events:auto; }
        .gen-modal {
            background:var(--surface);
            border:1px solid var(--glass-border);
            border-radius:var(--radius-xl);
            width:100%; max-width:520px;
            max-height:90vh; overflow-y:auto;
            box-shadow:var(--shadow-lg);
            animation:scaleIn 0.3s ease;
            padding:0;
        }
        .gen-modal-header {
            display:flex; justify-content:space-between; align-items:center;
            padding:1.3rem 1.6rem 0.8rem;
            border-bottom:1px solid var(--border);
        }
        .gen-modal-title {
            font-size:1.1rem; font-weight:800; letter-spacing:0.04em;
            background:linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip:text; -webkit-text-fill-color:transparent;
            background-clip:text;
        }
        .gen-close-btn {
            background:none; border:1px solid var(--border); border-radius:8px;
            color:var(--text-muted); cursor:pointer; font-size:1.2rem;
            width:34px; height:34px; display:flex; align-items:center; justify-content:center;
            transition:all 0.2s;
        }
        .gen-close-btn:hover { color:var(--text); border-color:var(--border-hover); background:rgba(255,255,255,0.04); }
        .gen-modal-body { padding:1.3rem 1.6rem; }
        .gen-modal-footer {
            padding:0.8rem 1.6rem 1.3rem;
            border-top:1px solid var(--border);
            display:flex; gap:0.7rem; flex-wrap:wrap;
        }
        .gen-row { display:grid; grid-template-columns:1fr 1fr; gap:0.8rem; }
        @media (max-width:480px) { .gen-row { grid-template-columns:1fr; } }

        /* Difficulty radio group */
        .diff-group { display:flex; gap:0.4rem; }
        .diff-option {
            flex:1; text-align:center; padding:0.5rem 0.3rem;
            border:1px solid var(--border); border-radius:var(--radius-sm);
            font-size:0.72rem; font-weight:600; cursor:pointer;
            color:var(--text-muted); background:transparent; transition:all 0.2s;
            font-family:inherit; text-transform:uppercase; letter-spacing:0.06em;
        }
        .diff-option:hover { border-color:var(--border-hover); color:var(--text-secondary); }
        .diff-option.active { border-color:var(--primary); color:var(--primary); background:var(--primary-dim); }
        .diff-option input { display:none; }

        /* Elevation preview chart */
        .elev-preview {
            width:100%; height:140px;
            background:rgba(255,255,255,0.03);
            border:1px solid var(--border);
            border-radius:var(--radius-md);
            margin-top:0.5rem; margin-bottom:0.5rem;
            position:relative; overflow:hidden;
        }
        .elev-preview canvas { width:100%; height:100%; display:block; }
        .elev-preview-empty {
            position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
            color:var(--text-muted); font-size:0.72rem; font-weight:500;
        }
        .elev-stats {
            display:flex; gap:1.2rem; margin-top:0.4rem; margin-bottom:0.3rem;
        }
        .elev-stat-val { font-size:0.95rem; font-weight:800; color:var(--primary); font-variant-numeric:tabular-nums; }
        .elev-stat-lbl { font-size:0.52rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; }

        /* Success toast */
        .gen-toast {
            position:fixed; bottom:5rem; left:50%; transform:translateX(-50%) translateY(20px);
            background:var(--surface); border:1px solid rgba(249,115,22,0.4);
            color:var(--primary); font-size:0.8rem; font-weight:600;
            padding:0.6rem 1.4rem; border-radius:var(--radius-full);
            box-shadow:var(--shadow-md);
            opacity:0; pointer-events:none;
            transition:all 0.35s ease; z-index:200;
        }
        .gen-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
    </style>
    <div class="page">
        <div class="brand-header">
            <h1 class="brand-title">UNCHAINED PROJECT</h1>
            <p class="brand-subtitle">Select your route</p>
        </div>
        <div class="routes-grid" id="routesList"></div>
        <div class="generate-area">
            <button class="btn btn-secondary btn-full" id="generateBtn">⚡ Genera Route</button>
        </div>
        <div class="import-area">
            <div class="drop-zone" id="dropZone">
                📂 Drag a GPX file here, or click to select
                <input type="file" id="gpxInput" accept=".gpx">
            </div>
        </div>
        <div class="start-area">
            <button class="btn btn-primary btn-full disabled" id="startBtn">Start Ride →</button>
            <div style="text-align:center;margin-top:0.8rem;">
                <a class="back-link" href="#home">← Back to home</a>
            </div>
        </div>
    </div>

    <!-- Generator modal -->
    <div class="gen-overlay" id="genOverlay">
        <div class="gen-modal">
            <div class="gen-modal-header">
                <span class="gen-modal-title">⚡ Generate Route</span>
                <button class="gen-close-btn" id="genCloseBtn">✕</button>
            </div>
            <div class="gen-modal-body">
                <div class="form-group">
                    <label class="form-label" for="genName">Route Name</label>
                    <input class="form-input" type="text" id="genName" placeholder="My Custom Route" value="Generated Route">
                </div>

                <div class="gen-row">
                    <div class="form-group">
                        <label class="form-label" for="genDistance">Distance (km)</label>
                        <input class="form-input" type="number" id="genDistance" min="1" max="300" step="0.1" value="20">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="genElevation">Elevation Gain (m)</label>
                        <input class="form-input" type="number" id="genElevation" min="0" max="5000" step="10" value="500">
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label" for="genType">Route Type</label>
                    <select class="form-select" id="genType">
                        <option value="linear_climb">Salita costante</option>
                        <option value="rolling" selected>Sali e scendi</option>
                        <option value="climb_then_descent">Salita + discesa</option>
                        <option value="false_flat">Falso piano</option>
                        <option value="punchy">Pianura con strappi</option>
                        <option value="valley">Discesa, pianura, risalita</option>
                    </select>
                </div>

                <div class="gen-row">
                    <div class="form-group">
                        <label class="form-label" for="genGradient">Max Gradient (%)</label>
                        <input class="form-input" type="number" id="genGradient" min="3" max="25" step="1" value="12">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Difficulty</label>
                        <div class="diff-group" id="diffGroup">
                            <button class="diff-option" data-diff="easy">Easy</button>
                            <button class="diff-option active" data-diff="medium">Medium</button>
                            <button class="diff-option" data-diff="hard">Hard</button>
                        </div>
                    </div>
                </div>

                <!-- Elevation preview -->
                <label class="form-label">Elevation Preview</label>
                <div class="elev-preview" id="elevPreview">
                    <canvas id="elevCanvas"></canvas>
                    <div class="elev-preview-empty" id="elevEmpty">Click "Preview" to see the elevation profile</div>
                </div>
                <div class="elev-stats" id="elevStats" style="display:none;">
                    <div><div class="elev-stat-val" id="statGain">—</div><div class="elev-stat-lbl">Elev. Gain</div></div>
                    <div><div class="elev-stat-val" id="statMaxGrad">—</div><div class="elev-stat-lbl">Max Grad.</div></div>
                    <div><div class="elev-stat-val" id="statPoints">—</div><div class="elev-stat-lbl">Points</div></div>
                </div>
            </div>
            <div class="gen-modal-footer">
                <button class="btn btn-secondary" id="genPreviewBtn" style="flex:1;">👁 Preview</button>
                <button class="btn btn-primary" id="genConfirmBtn" style="flex:1;">⬇ Download GPX</button>
            </div>
        </div>
    </div>

    <!-- Success toast -->
    <div class="gen-toast" id="genToast">✅ GPX downloaded!</div>
    `;

    await ensureDefaultRoutes();
    await renderRoutes();

    // ── Start ride ──
    container.querySelector('#startBtn').onclick = async () => {
        if (!selectedKey) return;
        const route = await getRoute(selectedKey);
        if (!route) return;
        sessionStorage.setItem('fz_selected_route', JSON.stringify(route));
        navigateTo('ride');
    };

    // ── GPX import ──
    const dropZone = container.querySelector('#dropZone');
    const gpxInput = container.querySelector('#gpxInput');

    dropZone.onclick = () => gpxInput.click();

    gpxInput.onchange = async (e) => {
        for (const file of e.target.files) await handleGPXFile(file);
        gpxInput.value = '';
    };

    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = async (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        for (const file of e.dataTransfer.files) {
            if (file.name.endsWith('.gpx')) await handleGPXFile(file);
        }
    };

    async function handleGPXFile(file) {
        try {
            await importRoute(file);
            await renderRoutes();
        } catch (err) {
            alert('Error importing GPX: ' + err.message);
        }
    }

    // ── Generator modal ──
    const overlay = container.querySelector('#genOverlay');
    const closeBtn = container.querySelector('#genCloseBtn');
    const previewBtn = container.querySelector('#genPreviewBtn');
    const confirmBtn = container.querySelector('#genConfirmBtn');
    const diffGroup = container.querySelector('#diffGroup');
    let lastResult = null;

    container.querySelector('#generateBtn').onclick = () => {
        overlay.classList.add('open');
        lastResult = null;
        container.querySelector('#elevEmpty').style.display = '';
        container.querySelector('#elevStats').style.display = 'none';
        clearCanvas();
    };

    closeBtn.onclick = () => overlay.classList.remove('open');
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('open'); };

    // Difficulty radio buttons
    diffGroup.querySelectorAll('.diff-option').forEach(btn => {
        btn.onclick = () => {
            diffGroup.querySelectorAll('.diff-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });

    // Preview
    previewBtn.onclick = () => {
        lastResult = runGenerate();
        if (lastResult) drawPreview(lastResult);
    };

    // Confirm download
    confirmBtn.onclick = async () => {
        if (!lastResult) {
            lastResult = runGenerate();
            if (lastResult) drawPreview(lastResult);
        }
        if (!lastResult) return;

        const name = container.querySelector('#genName').value.trim() || 'Generated Route';

        // Download GPX file
        downloadGeneratedGPX(name, lastResult.gpxXml);

        // Also import into library so user can ride it immediately
        try {
            await importRoute(lastResult.gpxXml, {
                name,
                description: `Generated | ${container.querySelector('#genType').selectedOptions[0].text} | ${getSelectedDifficulty()}`,
                emoji: '⚡',
            });
            await renderRoutes();
        } catch (err) {
            console.warn('[GENERATOR] Could not import into library:', err);
        }

        // Show toast
        const toast = container.querySelector('#genToast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);

        // Close modal
        overlay.classList.remove('open');
    };

    function getSelectedDifficulty() {
        const active = diffGroup.querySelector('.diff-option.active');
        return active ? active.dataset.diff : 'medium';
    }

    function runGenerate() {
        const name = container.querySelector('#genName').value.trim() || 'Generated Route';
        const dist = parseFloat(container.querySelector('#genDistance').value);
        const elev = parseFloat(container.querySelector('#genElevation').value);
        const type = container.querySelector('#genType').value;
        const grad = parseFloat(container.querySelector('#genGradient').value);
        const diff = getSelectedDifficulty();

        if (!dist || dist <= 0 || !elev || elev < 0 || !grad || grad < 3 || grad > 25) {
            alert('Please fill in all fields with valid values.');
            return null;
        }

        const result = generateRoute({
            route_name: name,
            total_distance_km: dist,
            elevation_gain_m: elev,
            route_type: type,
            max_gradient_percent: grad,
            difficulty: diff,
        });

        if (!result.validation.valid) {
            console.warn('[GENERATOR] Validation warnings:', result.validation);
        }

        return result;
    }

    function clearCanvas() {
        const canvas = container.querySelector('#elevCanvas');
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth * 2;
        canvas.height = canvas.offsetHeight * 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawPreview(result) {
        const canvas = container.querySelector('#elevCanvas');
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 2;

        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);

        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        const pad = { top: 12, right: 12, bottom: 8, left: 12 };

        ctx.clearRect(0, 0, w, h);
        container.querySelector('#elevEmpty').style.display = 'none';

        const elevs = result.elevations;
        const minE = Math.min(...elevs);
        const maxE = Math.max(...elevs);
        const range = maxE - minE || 1;

        const drawW = w - pad.left - pad.right;
        const drawH = h - pad.top - pad.bottom;

        const xStep = drawW / (elevs.length - 1);

        // Fill gradient
        const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
        grad.addColorStop(0, 'rgba(249,115,22,0.35)');
        grad.addColorStop(1, 'rgba(249,115,22,0.02)');

        ctx.beginPath();
        ctx.moveTo(pad.left, h - pad.bottom);
        for (let i = 0; i < elevs.length; i++) {
            const x = pad.left + i * xStep;
            const y = pad.top + drawH - ((elevs[i] - minE) / range) * drawH;
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(pad.left + (elevs.length - 1) * xStep, h - pad.bottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke line
        ctx.beginPath();
        for (let i = 0; i < elevs.length; i++) {
            const x = pad.left + i * xStep;
            const y = pad.top + drawH - ((elevs[i] - minE) / range) * drawH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#F97316';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Update stats
        container.querySelector('#elevStats').style.display = '';
        container.querySelector('#statGain').textContent = `${result.validation.actualGain}m`;
        container.querySelector('#statMaxGrad').textContent = `${result.validation.maxGradient}%`;
        container.querySelector('#statPoints').textContent = result.numPoints;
    }

    // ── Render routes list ──
    async function renderRoutes() {
        const routes = await listRoutes();
        const list = container.querySelector('#routesList');

        if (!routes.length) {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🗺️</div>No routes yet. Import a GPX file below.</div>';
            return;
        }

        list.innerHTML = routes.map((r, i) => `
            <div class="card route-card stagger-${i+1}" data-key="${r.key}">
                <div class="route-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <div><span class="route-emoji">${r.emoji}</span><span class="route-name">${r.name}</span></div>
                    <button class="delete-btn" data-delete="${r.key}" title="Delete">🗑</button>
                </div>
                <div class="route-desc">${r.description}</div>
                <div class="route-stats">
                    <div class="route-stat"><div class="val">${r.distance_km}</div><div class="lbl">km</div></div>
                    <div class="route-stat"><div class="val elev-color">${r.elevation_gain}</div><div class="lbl">m elevation</div></div>
                </div>
            </div>
        `).join('');

        // Click handlers
        list.querySelectorAll('.route-card').forEach(card => {
            card.style.cursor = 'pointer';
            card.onclick = (e) => {
                if (e.target.closest('.delete-btn')) return;
                list.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedKey = card.dataset.key;
                container.querySelector('#startBtn').classList.remove('disabled');
            };
        });

        list.querySelectorAll('.delete-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const key = btn.dataset.delete;
                if (!confirm('Delete this route?')) return;
                await deleteRoute(key);
                if (selectedKey === key) selectedKey = null;
                await renderRoutes();
            };
        });
    }
}

export function unmount() {
    selectedKey = null;
}
