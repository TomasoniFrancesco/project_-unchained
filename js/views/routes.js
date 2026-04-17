/**
 * Routes view — route selection, GPX import, start ride.
 */
import { listRoutes, importRoute, deleteRoute, getRoute } from '../storage/routes.js';
import { ensureDefaultRoutes } from '../data/default-routes.js';
import { navigateTo } from '../router.js';

let selectedKey = null;

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
    </style>
    <div class="page">
        <div class="brand-header">
            <h1 class="brand-title">FUCK ZWIFT</h1>
            <p class="brand-subtitle">Select your route</p>
        </div>
        <div class="routes-grid" id="routesList"></div>
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
    </div>`;

    await ensureDefaultRoutes();
    await renderRoutes();

    // Start ride
    container.querySelector('#startBtn').onclick = async () => {
        if (!selectedKey) return;
        const route = await getRoute(selectedKey);
        if (!route) return;
        sessionStorage.setItem('fz_selected_route', JSON.stringify(route));
        navigateTo('ride');
    };

    // GPX import
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
