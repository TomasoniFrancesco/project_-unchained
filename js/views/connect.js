/**
 * Connect/Devices view — BLE device management, controller mapping.
 */
import {
    scanAndConnectTrainer,
    scanAndConnectController,
    isWebBluetoothAvailable,
    loadControllerMap,
    clearControllerMap,
    startLearnMode,
    cancelLearnMode,
    isLearning,
    getControllerInfo,
    disconnectController,
    loadCustomServiceUUIDs,
    addCustomServiceUUID,
    removeCustomServiceUUID,
} from '../ble/manager.js';
import { state } from '../state.js';

const ACTIONS = ['gearUp', 'gearDown', 'pause'];
let stateListener = null;

export function mount(container) {
    container.innerHTML = `
    <style>
        .connect-page .section { max-width: 640px; }
        .connected-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .scan-area { width: 100%; max-width: 640px; margin-bottom: 0.75rem; }
        .empty-connected { font-size: 0.75rem; color: var(--text-muted); text-align: center; padding: 1.2rem; }
        .done-area { width: 100%; max-width: 640px; margin-top: 1.5rem; }
        .ble-not-supported { text-align: center; padding: 3rem 1rem; color: var(--text-muted); font-size: 0.85rem; }
        .scan-section-label { font-size: 0.58rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); margin-bottom: 0.4rem; }
        .scan-btn-row { display: flex; gap: 0.5rem; width: 100%; }
        .scan-btn-row .scan-btn { flex: 1; }
        .scan-btn-secondary { background: transparent !important; border-color: var(--border) !important; color: var(--text-muted) !important; font-size: 0.68rem !important; }
        .scan-btn-secondary:hover { border-color: var(--border-focus) !important; color: var(--text-secondary) !important; background: var(--primary-dim) !important; }
        .custom-uuid-section { width: 100%; max-width: 640px; margin-top: 0.5rem; }
        .custom-uuid-toggle { font-size: 0.62rem; color: var(--text-muted); background: none; border: none; cursor: pointer; font-family: inherit; text-decoration: underline; padding: 0; transition: color 0.2s; }
        .custom-uuid-toggle:hover { color: var(--primary); }
        .custom-uuid-body { display: none; margin-top: 0.5rem; padding: 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--glass-bg); }
        .custom-uuid-body.open { display: block; }
        .uuid-input-row { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
        .uuid-input-row input { flex: 1; padding: 0.4rem 0.6rem; font-size: 0.7rem; font-family: 'Courier New', monospace; background: rgba(255,255,255,0.05); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); outline: none; transition: border-color 0.2s; }
        .uuid-input-row input:focus { border-color: var(--primary); }
        .uuid-add-btn { padding: 0.4rem 0.8rem; font-family: inherit; font-size: 0.65rem; font-weight: 700; border: 1px solid var(--primary); border-radius: var(--radius-sm); background: var(--primary-dim); color: var(--primary); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .uuid-add-btn:hover { background: var(--primary); color: #fff; }
        .uuid-list { list-style: none; padding: 0; margin: 0; }
        .uuid-list li { display: flex; align-items: center; justify-content: space-between; padding: 0.3rem 0; font-size: 0.65rem; font-family: 'Courier New', monospace; color: var(--text-secondary); border-bottom: 1px solid rgba(255,255,255,0.04); }
        .uuid-list li:last-child { border-bottom: none; }
        .uuid-remove { font-size: 0.6rem; color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 2px 6px; font-family: inherit; transition: color 0.15s; }
        .uuid-remove:hover { color: #EF4444; }
        .uuid-hint { font-size: 0.6rem; color: var(--text-muted); margin-top: 0.4rem; line-height: 1.4; }
        .slots-info { font-size: 0.62rem; color: var(--text-muted); margin-top: 0.35rem; text-align: center; }
        #mapPanel { width: 100%; max-width: 640px; margin-top: 1rem; display: none; }
        .map-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem; }
        .map-title { font-size: 0.78rem; font-weight: 700; color: var(--text); }
        .map-reset { font-size: 0.65rem; color: var(--text-muted); background: none; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.22rem 0.6rem; cursor: pointer; font-family: inherit; transition: all 0.2s; }
        .map-reset:hover { color: #EF4444; border-color: rgba(239,68,68,0.4); }
        .map-action { display: flex; align-items: center; gap: 0.8rem; padding: 0.85rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--glass-bg); margin-bottom: 0.5rem; transition: border-color 0.2s; }
        .map-action.learning { border-color: var(--primary); background: var(--primary-dim); animation: learningPulse 1s ease-in-out infinite; }
        .map-action.mapped { border-color: rgba(255,255,255,0.12); }
        @keyframes learningPulse { 0%, 100% { box-shadow: 0 0 0 0 var(--primary-glow); } 50% { box-shadow: 0 0 12px 2px var(--primary-glow); } }
        .map-icon { font-size: 1.2rem; width: 28px; text-align: center; flex-shrink: 0; }
        .map-info { flex: 1; min-width: 0; }
        .map-action-name { font-size: 0.82rem; font-weight: 700; color: var(--text); }
        .map-action-status { font-size: 0.65rem; color: var(--text-muted); margin-top: 0.1rem; }
        .map-action-status.ok { color: var(--primary); }
        .map-action-status.wait { color: var(--accent); }
        .map-btn { padding: 0.38rem 0.9rem; font-family: inherit; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em; border-radius: var(--radius-sm); border: 1px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
        .map-btn:hover { border-color: var(--border-focus); color: var(--primary); background: var(--primary-dim); }
        .map-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .map-btn.learning-btn { border-color: var(--primary); color: var(--primary); background: var(--primary-dim); }
        .disconnect-btn { font-size: 0.58rem; font-weight: 600; font-family: inherit; padding: 0.2rem 0.6rem; border-radius: var(--radius-sm); border: 1px solid rgba(239,68,68,0.3); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
        .disconnect-btn:hover { color: #EF4444; border-color: rgba(239,68,68,0.6); background: rgba(239,68,68,0.08); }
    </style>
    <div class="page connect-page">
        <div class="brand-header">
            <h1 class="brand-title">FUCK ZWIFT</h1>
            <p class="brand-subtitle">Connect your devices</p>
        </div>
        <div style="width:100%;max-width:640px;margin-bottom:1.2rem;">
            <a class="back-link" href="#home">← Back to home</a>
        </div>

        <div class="section stagger-1" style="max-width:640px;">
            <div class="section-title">Connected Devices</div>
            <div class="connected-list" id="connectedList"><div class="empty-connected">No devices connected yet</div></div>
        </div>

        <div class="scan-area stagger-2">
            <div class="scan-section-label">🚴 Smart Trainer (FTMS)</div>
            <button class="scan-btn" id="scanTrainerBtn">
                <div class="scan-spinner" id="scanTrainerSpinner"></div>
                <span id="scanTrainerLabel">Scan for Bluetooth Trainer</span>
            </button>
        </div>

        <div class="scan-area stagger-3">
            <div class="scan-section-label">🎮 Remote Controllers (up to 2)</div>
            <div class="scan-btn-row">
                <button class="scan-btn" id="scanCtrlBtn">
                    <div class="scan-spinner" id="scanCtrlSpinner"></div>
                    <span id="scanCtrlLabel">Scan Known Controllers</span>
                </button>
                <button class="scan-btn scan-btn-secondary" id="scanCtrlAllBtn">
                    <div class="scan-spinner" id="scanCtrlAllSpinner"></div>
                    <span id="scanCtrlAllLabel">Scan All Devices</span>
                </button>
            </div>
            <div class="slots-info" id="slotsInfo">2 slots available</div>
        </div>

        <div class="custom-uuid-section stagger-3">
            <button class="custom-uuid-toggle" id="uuidToggleBtn">⚙ Advanced: Add custom service UUID</button>
            <div class="custom-uuid-body" id="customUuidBody">
                <div class="uuid-input-row">
                    <input type="text" id="customUuidInput" placeholder="e.g. 0000fff0-0000-1000-8000-00805f9b34fb" spellcheck="false">
                    <button class="uuid-add-btn" id="uuidAddBtn">Add</button>
                </div>
                <ul class="uuid-list" id="customUuidList"></ul>
                <div class="uuid-hint">💡 If your controller's buttons aren't detected, find its service UUID using <strong>nRF Connect</strong> app and add it here.</div>
            </div>
        </div>

        <div id="mapPanel" class="stagger-3">
            <div class="map-header">
                <div class="map-title">🗺 Configure Controller Buttons</div>
                <button class="map-reset" id="mapResetBtn">Reset all</button>
            </div>
            <div class="map-action" id="mapRow-gearUp"><div class="map-icon">⬆️</div><div class="map-info"><div class="map-action-name">Gear Up</div><div class="map-action-status" id="mapStatus-gearUp">Not configured</div></div><button class="map-btn" id="mapBtn-gearUp">Set</button></div>
            <div class="map-action" id="mapRow-gearDown"><div class="map-icon">⬇️</div><div class="map-info"><div class="map-action-name">Gear Down</div><div class="map-action-status" id="mapStatus-gearDown">Not configured</div></div><button class="map-btn" id="mapBtn-gearDown">Set</button></div>
            <div class="map-action" id="mapRow-pause"><div class="map-icon">⏸</div><div class="map-info"><div class="map-action-name">Pause / Resume</div><div class="map-action-status" id="mapStatus-pause">Not configured</div></div><button class="map-btn" id="mapBtn-pause">Set</button></div>
            <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.6rem;line-height:1.5;">
                💡 Click <strong>Set</strong> then press the physical button on your remote. The mapping is saved automatically.
                You can also use <strong>↑ ↓ arrow keys</strong> on any keyboard — no configuration needed.
            </div>
        </div>

        <div class="done-area stagger-4">
            <a class="btn btn-primary btn-full" href="#routes">Go to Routes →</a>
            <div style="text-align:center;margin-top:0.8rem;"><a class="back-link" href="#home">← Back to Home</a></div>
        </div>
    </div>`;

    if (!isWebBluetoothAvailable()) {
        container.querySelectorAll('.scan-area').forEach(el => {
            el.innerHTML = '<div class="ble-not-supported">⚠️ Web Bluetooth not available.<br>Use Chrome or Edge over HTTPS or localhost.</div>';
        });
    }

    const $ = (sel) => container.querySelector(sel);

    // ── Trainer scan ──
    $('#scanTrainerBtn').onclick = async () => {
        const btn = $('#scanTrainerBtn'), spinner = $('#scanTrainerSpinner'), label = $('#scanTrainerLabel');
        btn.classList.add('scanning'); spinner.style.display = 'block'; label.textContent = 'Select your trainer…';
        const device = await scanAndConnectTrainer();
        btn.classList.remove('scanning'); spinner.style.display = 'none';
        label.textContent = device ? 'Scan for another trainer' : 'Scan for Bluetooth Trainer';
        updateConnectedUI();
    };

    // ── Controller scan ──
    async function doControllerScan(mode) {
        const isFiltered = mode === 'filtered';
        const btn = $(isFiltered ? '#scanCtrlBtn' : '#scanCtrlAllBtn');
        const spinner = $(isFiltered ? '#scanCtrlSpinner' : '#scanCtrlAllSpinner');
        const label = $(isFiltered ? '#scanCtrlLabel' : '#scanCtrlAllLabel');
        btn.classList.add('scanning'); spinner.style.display = 'block';
        const origText = label.textContent; label.textContent = 'Select your remote…';
        const result = await scanAndConnectController(mode);
        btn.classList.remove('scanning'); spinner.style.display = 'none'; label.textContent = origText;
        updateConnectedUI(); updateSlotsInfo();
        if (result) { $('#mapPanel').style.display = 'block'; refreshMapUI(); }
    }
    $('#scanCtrlBtn').onclick = () => doControllerScan('filtered');
    $('#scanCtrlAllBtn').onclick = () => doControllerScan('all');

    // ── Learn mode ──
    ACTIONS.forEach(action => {
        $(`#mapBtn-${action}`).onclick = () => {
            const c1 = state.get('controller_1_status'), c2 = state.get('controller_2_status');
            if (c1 !== 'connected' && c2 !== 'connected') { alert('Connect at least one controller first.'); return; }
            cancelLearnMode();
            ACTIONS.forEach(a => { $(`#mapRow-${a}`).classList.remove('learning'); const b = $(`#mapBtn-${a}`); b.textContent = 'Set'; b.classList.remove('learning-btn'); });
            $(`#mapRow-${action}`).classList.add('learning');
            const btn = $(`#mapBtn-${action}`); btn.textContent = 'Press button…'; btn.classList.add('learning-btn');
            $(`#mapStatus-${action}`).textContent = '⌛ Waiting for button press…';
            $(`#mapStatus-${action}`).className = 'map-action-status wait';
            startLearnMode(action, (bytes) => {
                $(`#mapRow-${action}`).classList.remove('learning'); btn.textContent = 'Set'; btn.classList.remove('learning-btn');
                refreshMapUI();
            });
        };
    });

    // ── Reset map ──
    $('#mapResetBtn').onclick = () => {
        if (!confirm('Reset all button mappings?')) return;
        clearControllerMap(); cancelLearnMode();
        ACTIONS.forEach(a => { $(`#mapRow-${a}`).classList.remove('learning'); $(`#mapBtn-${a}`).classList.remove('learning-btn'); $(`#mapBtn-${a}`).textContent = 'Set'; });
        refreshMapUI();
    };

    // ── Custom UUID ──
    $('#uuidToggleBtn').onclick = () => { $('#customUuidBody').classList.toggle('open'); refreshCustomUuidList(); };
    $('#uuidAddBtn').onclick = () => {
        const input = $('#customUuidInput'); const val = input.value.trim(); if (!val) return;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) { alert('Invalid UUID format.'); return; }
        addCustomServiceUUID(val); input.value = ''; refreshCustomUuidList();
    };

    function refreshCustomUuidList() {
        const uuids = loadCustomServiceUUIDs(); const list = $('#customUuidList');
        if (!uuids.length) { list.innerHTML = ''; return; }
        list.innerHTML = uuids.map(u => `<li><span>${u}</span><button class="uuid-remove" data-uuid="${u}">✕</button></li>`).join('');
        list.querySelectorAll('.uuid-remove').forEach(btn => { btn.onclick = () => { removeCustomServiceUUID(btn.dataset.uuid); refreshCustomUuidList(); }; });
    }

    function refreshMapUI() {
        const map = loadControllerMap();
        ACTIONS.forEach(action => {
            const sig = map[action]; const status = $(`#mapStatus-${action}`);
            if (sig) {
                status.textContent = sig.bytes ? `✓ Mapped [${sig.bytes.join(', ')}]` : `✓ Mapped (byte ${sig.b0}, ${sig.b1})`;
                status.className = 'map-action-status ok'; $(`#mapRow-${action}`).classList.add('mapped');
            } else {
                status.textContent = 'Not configured'; status.className = 'map-action-status'; $(`#mapRow-${action}`).classList.remove('mapped');
            }
        });
    }

    function updateSlotsInfo() {
        const c1 = state.get('controller_1_status'), c2 = state.get('controller_2_status');
        let used = 0; if (c1 === 'connected' || c1 === 'connecting') used++; if (c2 === 'connected' || c2 === 'connecting') used++;
        const free = 2 - used; const el = $('#slotsInfo');
        if (free === 0) { el.textContent = 'Both slots occupied — disconnect one to add another'; el.style.color = 'var(--accent)'; }
        else { el.textContent = `${free} slot${free > 1 ? 's' : ''} available`; el.style.color = ''; }
    }

    function updateConnectedUI() {
        const list = $('#connectedList'); const rows = [];
        const trStatus = state.get('trainer_status'), trName = state.get('trainer_name');
        if (trStatus === 'connected' || trStatus === 'connecting') {
            const dotClass = trStatus === 'connected' ? 'connected' : 'connecting';
            const statusText = trStatus === 'connected' ? 'Connected ✓' : 'Connecting…';
            rows.push(`<div class="card device-row"><div class="device-dot ${dotClass}"></div><div style="flex:1;min-width:0;"><div class="device-name">${trName || 'Smart Trainer'}</div><div class="device-meta">${statusText}</div></div><span class="type-badge trainer">trainer</span></div>`);
        }
        for (let slot = 0; slot < 2; slot++) {
            const cStatus = state.get(`controller_${slot+1}_status`), cName = state.get(`controller_${slot+1}_name`);
            if (cStatus === 'connected' || cStatus === 'connecting') {
                const dotClass = cStatus === 'connected' ? 'connected' : 'connecting';
                const statusText = cStatus === 'connected' ? 'Connected ✓' : 'Connecting…';
                rows.push(`<div class="card device-row"><div class="device-dot ${dotClass}"></div><div style="flex:1;min-width:0;"><div class="device-name">${cName || 'Controller ' + (slot+1)}</div><div class="device-meta">${statusText} — Slot ${slot+1}</div></div><span class="type-badge controller">controller</span><button class="disconnect-btn" data-slot="${slot}">✕</button></div>`);
            }
        }
        if (state.get('controller_1_status') === 'connected' || state.get('controller_2_status') === 'connected') {
            $('#mapPanel').style.display = 'block'; refreshMapUI();
        }
        list.innerHTML = rows.length ? rows.join('') : '<div class="empty-connected">No devices connected yet</div>';
        // Bind disconnect buttons
        list.querySelectorAll('.disconnect-btn').forEach(btn => {
            btn.onclick = () => {
                disconnectController(parseInt(btn.dataset.slot)); updateConnectedUI(); updateSlotsInfo();
                if (state.get('controller_1_status') !== 'connected' && state.get('controller_2_status') !== 'connected') $('#mapPanel').style.display = 'none';
            };
        });
    }

    // Initial state
    updateConnectedUI(); refreshMapUI(); updateSlotsInfo(); refreshCustomUuidList();

    // State listener
    stateListener = () => { updateConnectedUI(); updateSlotsInfo(); };
    state.addEventListener('change', stateListener);
}

export function unmount() {
    if (stateListener) { state.removeEventListener('change', stateListener); stateListener = null; }
    cancelLearnMode();
}
