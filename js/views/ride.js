/**
 * Ride view — full-screen cycling ride with canvas, HUD, and controller support.
 * Most complex view — handles canvas lifecycle, animation frames, modals.
 */
import { state } from '../state.js';
import { startRide, stopRide, togglePause, gearUp, gearDown, finalizeRide, updateRideGearSettings } from '../engine/ride.js';
import { loadProfile } from '../storage/profile.js';
import { loadConfig, updateGearRange } from '../storage/config.js';
import {
    setControllerCallbacks,
    getControllerInfo,
    scanAndConnectTrainer,
    scanAndConnectHeartRate,
    scanAndConnectController,
    disconnectTrainer,
    disconnectHeartRate,
    disconnectController,
    isWebBluetoothAvailable,
} from '../ble/manager.js';
import { navigateTo } from '../router.js';

let animFrameId = null;
let stateListener = null;
let deviceStateListener = null;
let keyListener = null;
let resizeListener = null;

export function mount(container) {
    // Load route
    const routeRaw = sessionStorage.getItem('fz_selected_route');
    if (!routeRaw) { navigateTo('routes'); return; }
    const route = JSON.parse(routeRaw);

    // Ride-specific full-screen CSS
    container.innerHTML = `
    <style>
        #rideRoot { position:fixed; inset:0; z-index:50; background:#0B1220; }
        #sceneCanvas { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0; }
        .hud { position:absolute; inset:0; z-index:10; pointer-events:none; }
        .hud > * { pointer-events:auto; }
        .pill { background:var(--glass-bg); backdrop-filter:blur(var(--glass-blur)); -webkit-backdrop-filter:blur(var(--glass-blur)); border:1px solid var(--glass-border); border-radius:16px; }
        .pill-sm { background:rgba(11,18,32,0.60); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); border:1px solid var(--glass-border); border-radius:12px; }
        .top-bar { position:absolute; top:16px; left:20px; right:20px; display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .top-left { display:flex; align-items:center; gap:12px; }
        .brand { font-size:0.7rem; font-weight:700; letter-spacing:0.3em; background:linear-gradient(135deg,var(--primary),var(--secondary)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
        .route-name-pill { padding:6px 14px; font-size:0.72rem; font-weight:600; color:rgba(255,255,255,0.7); display:flex; align-items:center; gap:8px; }
        .live-dot { width:7px; height:7px; border-radius:50%; background:var(--text-muted); transition:all 0.3s; }
        .live-dot.live { background:var(--primary); box-shadow:0 0 8px var(--primary-glow); }
        .top-actions { display:flex; gap:8px; }
        .action-btn { padding:8px 18px; font-family:inherit; font-size:0.72rem; font-weight:600; color:rgba(255,255,255,0.78); background:rgba(11,18,32,0.55); backdrop-filter:blur(14px); border:1px solid var(--glass-border); border-radius:12px; cursor:pointer; transition:all 0.2s; }
        .action-btn:hover { background:rgba(255,255,255,0.12); color:#fff; }
        .action-btn.pause.paused { border-color:rgba(245,158,11,0.5); color:#F59E0B; }
        .action-btn.stop:hover { border-color:rgba(239,68,68,0.5); color:#EF4444; }
        .action-btn.utility { padding-inline:14px; }
        .center-hud { position:absolute; top:16px; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:6px; }
        .timer-pill { padding:8px 28px; text-align:center; }
        .timer-value { font-size:2.2rem; font-weight:800; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; text-shadow:0 2px 20px rgba(0,0,0,0.5); }
        .main-metrics { display:flex; align-items:center; gap:2px; padding:6px 8px; }
        .metric-block { display:flex; align-items:baseline; gap:5px; padding:4px 16px; }
        .metric-block .icon { font-size:0.85rem; opacity:0.6; }
        .metric-block .val { font-size:2.6rem; font-weight:900; letter-spacing:-0.03em; font-variant-numeric:tabular-nums; line-height:1; text-shadow:0 2px 16px rgba(0,0,0,0.4); }
        .metric-divider { width:1px; height:32px; background:rgba(255,255,255,0.12); }
        .power-val { color:var(--color-power); } .cadence-val { color:var(--color-cadence); } .hr-val { color:var(--color-hr); }
        .sub-metrics { display:flex; align-items:center; gap:20px; padding:6px 20px; }
        .sub-item { display:flex; align-items:baseline; gap:5px; font-size:0.8rem; font-weight:600; color:rgba(255,255,255,0.7); }
        .sub-item .sub-val { font-variant-numeric:tabular-nums; color:#fff; }
        .sub-item .sub-unit { font-size:0.65rem; opacity:0.5; }
        .right-hud { position:absolute; top:80px; right:20px; display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
        .gradient-pill { padding:10px 18px; text-align:center; }
        .gradient-value { font-size:2rem; font-weight:800; font-variant-numeric:tabular-nums; text-shadow:0 2px 12px rgba(0,0,0,0.4); }
        .gradient-label { font-size:0.55rem; font-weight:600; text-transform:uppercase; letter-spacing:0.12em; color:rgba(255,255,255,0.4); margin-top:2px; }
        .gradient-flat{color:var(--gradient-flat)} .gradient-mild{color:var(--gradient-mild)} .gradient-steep{color:var(--gradient-steep)} .gradient-brutal{color:var(--gradient-brutal)}
        .zone-bar { display:flex; gap:3px; padding:4px 8px; }
        .zone-segment { width:28px; height:5px; border-radius:3px; background:rgba(255,255,255,0.1); transition:background 0.3s; }
        .zone-segment.z1{background:#9CA3AF} .zone-segment.z2{background:#3B82F6} .zone-segment.z3{background:#F97316} .zone-segment.z4{background:#F59E0B} .zone-segment.z5{background:#EF4444} .zone-segment.z6{background:#DC2626}
        .zone-segment.active { box-shadow:0 0 8px currentColor; transform:scaleY(1.6); }
        .bottom-bar { position:absolute; bottom:0; left:0; right:0; display:flex; flex-direction:column; }
        .bottom-controls { display:flex; justify-content:space-between; align-items:flex-end; padding:0 20px 10px; }
        .bottom-left { display:flex; gap:10px; align-items:flex-end; }
        .stat-mini { padding:12px 18px; text-align:center; min-width:92px; }
        .stat-mini .mini-val { font-size:1.55rem; font-weight:900; font-variant-numeric:tabular-nums; line-height:1; }
        .stat-mini .mini-label { font-size:0.6rem; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:rgba(255,255,255,0.45); margin-top:5px; }
        .calories-val{color:var(--color-calories)} .elevation-val{color:var(--color-elevation)} .climb-val{color:var(--color-elevation)}
        .gear-block { padding:12px 20px; display:flex; align-items:center; gap:16px; }
        .gear-number { font-size:3.2rem; font-weight:900; line-height:1; font-variant-numeric:tabular-nums; color:#fff; text-shadow:0 2px 16px rgba(0,0,0,0.4); }
        .gear-label { font-size:0.6rem; font-weight:600; text-transform:uppercase; letter-spacing:0.12em; color:rgba(255,255,255,0.4); }
        .gear-arrows { display:flex; gap:6px; }
        .gear-arrow { width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.6); font-size:1.1rem; display:flex; align-items:center; justify-content:center; cursor:pointer; font-family:inherit; transition:all 0.15s; }
        .gear-arrow:hover { background:rgba(255,255,255,0.15); color:#fff; }
        .elev-strip { height:120px; background:rgba(11,18,32,0.75); backdrop-filter:blur(14px); border-top:1px solid var(--glass-border); position:relative; }
        #elevCanvas { width:100%; height:100%; display:block; }
        .progress-strip { height:4px; background:rgba(255,255,255,0.06); }
        .progress-fill { height:100%; width:0%; background:linear-gradient(90deg,var(--primary),var(--secondary)); transition:width 0.8s ease; }
        .modal-backdrop { position:fixed; inset:0; background:rgba(11,18,32,0.75); backdrop-filter:blur(14px); display:none; align-items:center; justify-content:center; z-index:60; }
        .modal-backdrop.show { display:flex; }
        .modal { width:min(92%,420px); padding:30px; }
        .modal-header { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
        .modal-header-icon { font-size:1.4rem; }
        .modal-title { font-size:1.15rem; font-weight:800; letter-spacing:0.04em; }
        .modal-text { font-size:0.78rem; color:rgba(255,255,255,0.50); line-height:1.5; margin-bottom:20px; }
        .modal-options { display:flex; flex-direction:column; gap:8px; }
        .modal-option { display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:12px; border:1px solid var(--glass-border); border-left:3px solid transparent; background:rgba(255,255,255,0.04); color:#fff; font-family:inherit; cursor:pointer; text-align:left; transition:all 0.18s ease; }
        .modal-option:hover { background:rgba(255,255,255,0.08); transform:translateX(2px); }
        .modal-option:disabled { opacity:0.4; cursor:wait; transform:none; }
        .opt-icon { font-size:1.3rem; width:32px; text-align:center; flex-shrink:0; }
        .opt-text { flex:1; } .opt-label { font-size:0.82rem; font-weight:700; display:block; }
        .opt-desc { font-size:0.65rem; color:rgba(255,255,255,0.40); display:block; margin-top:2px; }
        .modal-option.local { border-left-color:rgba(249,115,22,0.5); }
        .modal-option.strava { border-left-color:rgba(252,76,2,0.5); }
        .modal-option.discard { border-left-color:rgba(239,68,68,0.4); }
        .modal-option.cancel { border-left-color:rgba(156,163,175,0.3); }
        .modal-status { text-align:center; padding:24px; font-size:0.82rem; color:rgba(255,255,255,0.65); line-height:1.6; }
        .modal-status .status-icon { font-size:2rem; display:block; margin-bottom:8px; }
        .power-trend { font-size:0.55em; vertical-align:super; margin-left:3px; opacity:0.65; }
        .power-trend.up { color:#EF4444; } .power-trend.down { color:var(--primary); }
        .ride-panel-body { display:grid; gap:12px; margin-top:16px; }
        .settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .form-row { display:grid; gap:6px; }
        .form-row.full { grid-column:1 / -1; }
        .form-row label { font-size:0.58rem; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:rgba(255,255,255,0.48); }
        .ride-input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:#fff; font:inherit; font-size:0.82rem; outline:none; }
        .ride-input:focus { border-color:rgba(249,115,22,0.65); }
        .panel-copy { font-size:0.74rem; color:rgba(255,255,255,0.52); line-height:1.5; }
        .device-panel-grid { display:grid; gap:8px; }
        .device-row-live { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.045); }
        .device-dot-live { width:9px; height:9px; border-radius:50%; background:#6B7280; box-shadow:0 0 0 0 transparent; flex-shrink:0; }
        .device-dot-live.connected { background:#22C55E; box-shadow:0 0 10px rgba(34,197,94,0.45); }
        .device-dot-live.connecting { background:#F59E0B; box-shadow:0 0 10px rgba(245,158,11,0.35); }
        .device-live-main { flex:1; min-width:0; }
        .device-live-name { font-size:0.82rem; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .device-live-status { font-size:0.66rem; color:rgba(255,255,255,0.5); margin-top:2px; }
        .device-actions { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
        .mini-btn { padding:7px 10px; border-radius:9px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.78); font:inherit; font-size:0.66rem; font-weight:700; cursor:pointer; }
        .mini-btn:hover { border-color:rgba(249,115,22,0.5); color:#fff; background:rgba(249,115,22,0.14); }
        .mini-btn.danger:hover { border-color:rgba(239,68,68,0.5); background:rgba(239,68,68,0.12); color:#FCA5A5; }

        /* ── Ride HUD responsive: phones ── */
        @media (max-width: 640px) {
            .top-bar { top:10px; left:12px; right:12px; gap:8px; flex-wrap:wrap; }
            .top-left { gap:8px; }
            .brand { font-size:0.55rem; letter-spacing:0.2em; }
            .route-name-pill { padding:4px 10px; font-size:0.62rem; gap:6px; }
            .top-actions { gap:6px; }
            .action-btn { padding:8px 14px; font-size:0.68rem; min-height:44px; border-radius:10px; }
            .center-hud { top:auto; bottom:190px; gap:4px; width:calc(100% - 24px); left:12px; transform:none; }
            .timer-pill { padding:4px 16px; }
            .timer-value { font-size:1.6rem; }
            .main-metrics { padding:4px 6px; width:100%; justify-content:center; }
            .metric-block { padding:3px 10px; }
            .metric-block .val { font-size:1.8rem; }
            .metric-block .icon { font-size:0.72rem; }
            .metric-divider { height:24px; }
            .sub-metrics { gap:12px; padding:4px 12px; justify-content:center; flex-wrap:wrap; }
            .sub-item { font-size:0.72rem; }
            .zone-bar { justify-content:center; }
            .zone-segment { width:24px; height:4px; }
            .right-hud { top:auto; right:auto; left:12px; bottom:270px; flex-direction:row; align-items:center; gap:6px; }
            .gradient-pill { padding:6px 12px; }
            .gradient-value { font-size:1.4rem; }
            .gradient-label { font-size:0.48rem; }
            .bottom-controls { flex-direction:column-reverse; align-items:stretch; gap:8px; padding:0 12px 8px; }
            .bottom-left { flex-wrap:wrap; gap:6px; justify-content:center; }
            .stat-mini { padding:6px 10px; }
            .stat-mini .mini-val { font-size:1.1rem; }
            .stat-mini .mini-label { font-size:0.42rem; }
            .gear-block { padding:8px 14px; gap:12px; justify-content:center; }
            .gear-number { font-size:2.4rem; }
            .gear-arrow { width:48px; height:48px; border-radius:12px; font-size:1.2rem; }
            .elev-strip { height:80px; }
            .modal { padding:20px; }
            .modal-title { font-size:1rem; }
            .modal-option { padding:12px 14px; gap:10px; min-height:48px; }
            .opt-label { font-size:0.78rem; }
            .opt-desc { font-size:0.62rem; }
            .settings-grid { grid-template-columns:1fr; }
            .device-row-live { align-items:flex-start; flex-direction:column; }
            .device-actions { width:100%; justify-content:stretch; }
            .mini-btn { flex:1; min-height:38px; }
        }

        /* ── Ride HUD responsive: very small phones ── */
        @media (max-width: 480px) {
            .brand { display:none; }
            .action-btn { padding:6px 12px; font-size:0.62rem; }
            .center-hud { bottom:170px; }
            .timer-value { font-size:1.3rem; }
            .metric-block .val { font-size:1.5rem; }
            .sub-item { font-size:0.65rem; }
            .right-hud { bottom:240px; }
            .gear-number { font-size:2rem; }
            .elev-strip { height:65px; }
        }

        /* ── Ride HUD responsive: landscape ── */
        @media (max-height: 500px) and (orientation: landscape) {
            .top-bar { top:8px; left:12px; right:12px; }
            .brand { font-size:0.5rem; }
            .action-btn { padding:6px 12px; font-size:0.62rem; min-height:36px; }
            .center-hud { top:8px; bottom:auto; width:auto; left:50%; transform:translateX(-50%); }
            .timer-pill { padding:3px 14px; }
            .timer-value { font-size:1.2rem; }
            .main-metrics { padding:2px 6px; }
            .metric-block .val { font-size:1.5rem; }
            .metric-block { padding:2px 8px; }
            .sub-metrics { gap:10px; padding:2px 10px; }
            .sub-item { font-size:0.65rem; }
            .zone-bar { padding:2px 6px; }
            .zone-segment { width:20px; height:3px; }
            .right-hud { top:60px; right:12px; bottom:auto; left:auto; flex-direction:column; align-items:flex-end; }
            .gradient-value { font-size:1.3rem; }
            .bottom-controls { padding:0 12px 4px; }
            .bottom-left { gap:4px; }
            .stat-mini { padding:4px 8px; }
            .stat-mini .mini-val { font-size:0.95rem; }
            .gear-block { padding:6px 12px; gap:8px; }
            .gear-number { font-size:1.8rem; }
            .gear-arrow { width:36px; height:36px; }
            .elev-strip { height:60px; }
        }

        /* ── Touch-specific ride adjustments ── */
        @media (hover: none) and (pointer: coarse) {
            .action-btn { min-height:44px; }
            .gear-arrow { min-width:48px; min-height:48px; }
            .modal-option { min-height:48px; }
        }
    </style>
    <div id="rideRoot">
        <canvas id="sceneCanvas"></canvas>
        <div class="hud">
            <div class="top-bar">
                <div class="top-left">
                    <span class="brand">UNCHAINED PROJECT</span>
                    <div class="route-name-pill pill-sm"><span class="live-dot" id="liveDot"></span><span id="routeNameLabel">${route.name}</span></div>
                </div>
                <div class="top-actions">
                    <button class="action-btn utility" id="rideSettingsBtn">Settings</button>
                    <button class="action-btn utility" id="rideDevicesBtn">Devices</button>
                    <button class="action-btn pause" id="pauseBtn">⏸ Pause</button>
                    <button class="action-btn stop" id="stopBtn">■ Stop</button>
                </div>
            </div>
            <div class="center-hud">
                <div class="timer-pill pill"><div class="timer-value" id="elapsed">0:00</div></div>
                <div class="main-metrics pill">
                    <div class="metric-block"><span class="icon">⚡</span><span class="val power-val" id="power">0</span></div>
                    <div class="metric-divider"></div>
                    <div class="metric-block"><span class="icon">⟳</span><span class="val cadence-val" id="cadence">0</span></div>
                    <div class="metric-divider"></div>
                    <div class="metric-block"><span class="icon">♥</span><span class="val hr-val" id="heartRate">--</span></div>
                </div>
                <div class="sub-metrics pill-sm">
                    <div class="sub-item"><span class="sub-val" id="speed">0.0</span><span class="sub-unit">km/h</span></div>
                    <div class="sub-item"><span class="sub-val" id="wkg">0.0</span><span class="sub-unit">W/kg</span></div>
                    <div class="sub-item"><span class="sub-val" id="distanceKm">0.00</span><span class="sub-unit">km</span></div>
                </div>
                <div class="zone-bar" id="zoneBar">
                    <div class="zone-segment" data-zone="z1">Z1</div><div class="zone-segment" data-zone="z2">Z2</div><div class="zone-segment" data-zone="z3">Z3</div>
                    <div class="zone-segment" data-zone="z4">Z4</div><div class="zone-segment" data-zone="z5">Z5</div><div class="zone-segment" data-zone="z6">Z6</div>
                </div>
            </div>
            <div class="right-hud">
                <div class="gradient-pill pill"><div class="gradient-value gradient-flat" id="gradient">0.0%</div><div class="gradient-label">Grade</div></div>
                <div class="stat-mini pill-sm"><div class="mini-val elevation-val" id="elevation">0</div><div class="mini-label">Elev m</div></div>
            </div>
            <div class="bottom-bar">
                <div class="bottom-controls">
                    <div class="bottom-left">
                        <div class="stat-mini pill-sm"><div class="mini-val" id="totalDist" style="color:var(--color-speed)">0.00</div><div class="mini-label">km</div></div>
                        <div class="stat-mini pill-sm"><div class="mini-val calories-val" id="calories">0</div><div class="mini-label">kcal</div></div>
                        <div class="stat-mini pill-sm"><div class="mini-val climb-val" id="elevGain">0</div><div class="mini-label">↑ gain</div></div>
                        <div class="stat-mini pill-sm"><div class="mini-val" id="avgPower" style="color:rgba(245,158,11,0.7);">0</div><div class="mini-label">avg W</div></div>
                    </div>
                    <div class="gear-block pill">
                        <div><div class="gear-number" id="gear">0</div><div class="gear-label">Gear</div></div>
                        <div class="gear-arrows"><button class="gear-arrow" id="gearDownBtn">◀</button><button class="gear-arrow" id="gearUpBtn">▶</button></div>
                    </div>
                </div>
                <div class="progress-strip"><div class="progress-fill" id="progBar"></div></div>
                <div class="elev-strip"><canvas id="elevCanvas"></canvas></div>
            </div>
        </div>

        <div class="modal-backdrop" id="settingsModal">
            <div class="modal pill">
                <div class="modal-header"><span class="modal-header-icon">⚙</span><span class="modal-title">Trainer Settings</span></div>
                <div class="panel-copy">Changes apply immediately to the active ride.</div>
                <div class="ride-panel-body">
                    <div class="settings-grid">
                        <div class="form-row full">
                            <label for="rideGearCount">Virtual gears</label>
                            <input class="ride-input" type="number" id="rideGearCount" min="2" max="40" step="1">
                        </div>
                        <div class="form-row">
                            <label for="rideRollerMin">Roller min</label>
                            <input class="ride-input" type="number" id="rideRollerMin" min="1" max="40" step="1">
                        </div>
                        <div class="form-row">
                            <label for="rideRollerMax">Roller max</label>
                            <input class="ride-input" type="number" id="rideRollerMax" min="1" max="40" step="1">
                        </div>
                    </div>
                    <div class="modal-options">
                        <button class="modal-option local" id="saveRideSettings"><span class="opt-icon">✓</span><span class="opt-text"><span class="opt-label">Apply</span><span class="opt-desc">Update resistance mapping now</span></span></button>
                        <button class="modal-option cancel" id="closeSettings"><span class="opt-icon">←</span><span class="opt-text"><span class="opt-label">Cancel</span><span class="opt-desc">Return to ride</span></span></button>
                    </div>
                </div>
            </div>
        </div>

        <div class="modal-backdrop" id="devicesModal">
            <div class="modal pill">
                <div class="modal-header"><span class="modal-header-icon">⌁</span><span class="modal-title">Bluetooth Devices</span></div>
                <div class="panel-copy" id="bleAvailabilityText">Reconnect devices without leaving the ride.</div>
                <div class="ride-panel-body">
                    <div class="device-panel-grid" id="rideDeviceList"></div>
                    <div class="modal-options">
                        <button class="modal-option cancel" id="closeDevices"><span class="opt-icon">←</span><span class="opt-text"><span class="opt-label">Close</span><span class="opt-desc">Return to ride</span></span></button>
                    </div>
                </div>
            </div>
        </div>

        <div class="modal-backdrop" id="stopModal">
            <div class="modal pill">
                <div class="modal-header"><span class="modal-header-icon" id="stopModalIcon">🏁</span><span class="modal-title" id="stopModalTitle">End Ride</span></div>
                <div class="modal-text" id="stopModalText">What would you like to do with this activity?</div>
                <div class="modal-options" id="stopModalOptions">
                    <button class="modal-option local" id="finishLocal"><span class="opt-icon">💾</span><span class="opt-text"><span class="opt-label">Save locally</span><span class="opt-desc">Save ride to browser storage</span></span></button>
                    <button class="modal-option strava" id="finishStrava"><span class="opt-icon">🔶</span><span class="opt-text"><span class="opt-label">Save & upload to Strava</span><span class="opt-desc">Save locally and sync to your Strava account</span></span></button>
                    <button class="modal-option discard" id="finishDiscard"><span class="opt-icon">🗑</span><span class="opt-text"><span class="opt-label">Do not save</span><span class="opt-desc">Discard this ride completely</span></span></button>
                    <button class="modal-option cancel" id="finishCancel"><span class="opt-icon">←</span><span class="opt-text"><span class="opt-label">Cancel</span><span class="opt-desc">Return to ride</span></span></button>
                </div>
            </div>
        </div>
    </div>`;

    const $ = (sel) => container.querySelector(sel);

    // ── Start ride engine ──
    startRide(route);
    const profile = loadProfile();
    const riderWeight = profile.weight_kg || 75;

    // ── Wire controllers ──
    setControllerCallbacks({ gearUp: () => gearUp(), gearDown: () => gearDown(), pause: () => doTogglePause() });

    // ── Route / Canvas data ──
    let routePoints = route.points || [];
    let totalDistance = 0, mapReady = false;
    const elevBounds = { minEle: 0, maxEle: 0, maxDist: 1 };
    const powerHistory = [], TREND_WINDOW = 10;
    let sessionPowerSum = 0, sessionPowerCount = 0;
    let targetDistance = 0, renderDistance = 0;

    if (routePoints.length > 1) {
        totalDistance = routePoints[routePoints.length - 1].distance_from_start || 0;
        routePoints = routePoints.map(p => ({ ele: p.elevation, dist: p.distance_from_start }));
        const eles = routePoints.map(p => p.ele);
        elevBounds.minEle = Math.min(...eles) - 10;
        elevBounds.maxEle = Math.max(...eles) + 10;
        elevBounds.maxDist = Math.max(totalDistance || routePoints[routePoints.length-1].dist || 1, 1);
        mapReady = true;
    }

    function setupCanvas(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, w: rect.width, h: rect.height };
    }
    function clamp(v,min,max) { return Math.max(min,Math.min(max,v)); }
    function lerp(a,b,t) { return a+(b-a)*t; }

    function getElevAtDist(dist) {
        if (!routePoints.length) return 200;
        if (routePoints.length === 1) return routePoints[0].ele;
        const d = clamp(dist, 0, elevBounds.maxDist);
        for (let i = 1; i < routePoints.length; i++) {
            if (routePoints[i].dist >= d) {
                const a = routePoints[i-1], b = routePoints[i];
                const seg = Math.max(1e-6, b.dist - a.dist);
                const t = clamp((d - a.dist) / seg, 0, 1);
                return a.ele + (b.ele - a.ele) * t;
            }
        }
        return routePoints[routePoints.length-1].ele;
    }

    function getSlopeAtDist(dist) {
        const d0 = Math.max(0, dist - 5), d1 = Math.min(elevBounds.maxDist, dist + 5);
        const e0 = getElevAtDist(d0), e1 = getElevAtDist(d1);
        const dx = d1 - d0; return dx > 0 ? (e1 - e0) / dx : 0;
    }

    // ── Procedural world elements (generated once) ──
    const stars = Array.from({length:120}, () => ({x:Math.random(),y:Math.random()*0.45,r:Math.random()*1.2+0.3,b:Math.random()*0.5+0.5}));
    const scenerySpan = 1400;
    const scenery = Array.from({ length: 72 }, (_, i) => {
        const lane = i % 2 === 0 ? -1 : 1;
        const roll = pseudoNoise(i * 9.1, 22);
        const type = roll > 0.78 ? 'sign' : roll > 0.58 ? 'rock' : 'tree';
        return {
            dist: 60 + i * (scenerySpan / 72) + pseudoNoise(i, 5) * 18,
            side: lane,
            type,
            offset: 20 + pseudoNoise(i, 11) * 70,
            height: 0.85 + pseudoNoise(i, 17) * 0.6,
            lean: (pseudoNoise(i, 31) - 0.5) * 0.18,
        };
    });

    // ── Seeded noise for mountains ──
    function pseudoNoise(x, seed) {
        const s = Math.sin(x * 127.1 + seed * 311.7) * 43758.5453;
        return s - Math.floor(s);
    }
    function mountainProfile(x, seed, octaves) {
        let v = 0, amp = 1, freq = 1, total = 0;
        for (let i = 0; i < octaves; i++) {
            v += pseudoNoise(x * freq, seed + i * 13.37) * amp;
            total += amp; amp *= 0.5; freq *= 2.1;
        }
        return v / total;
    }

    function mixColor(a, b, t) {
        const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
        const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
        const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp(t, 0, 1)));
        return `rgb(${m[0]},${m[1]},${m[2]})`;
    }

    function drawRoadsideScenery(ctx, w, h, currentDist, vanishX, vanishY, roadBottom, day) {
        const lookAhead = 820;
        const ordered = scenery
            .map(item => ({ ...item, rel: (item.dist - (currentDist % scenerySpan) + scenerySpan) % scenerySpan }))
            .filter(item => item.rel < lookAhead)
            .sort((a, b) => b.rel - a.rel);

        for (const item of ordered) {
            const depth = 1 - item.rel / lookAhead;
            const y = vanishY + Math.pow(depth, 1.55) * (roadBottom - vanishY);
            const roadHalfW = lerp(2, w * 0.18, Math.pow(depth, 1.2));
            const sway = Math.sin((currentDist + item.rel) * 0.003 + depth * 3) * roadHalfW * 0.12 * (1 - depth * 0.35);
            const x = vanishX + sway + item.side * (roadHalfW + item.offset * (0.55 + depth));
            const scale = (0.18 + depth * 1.35) * item.height;
            const alpha = clamp(depth * 1.35, 0, 1);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(x, y);
            ctx.scale(item.side, 1);
            if (item.type === 'tree') drawTree(ctx, scale, item.lean, day);
            else if (item.type === 'rock') drawRock(ctx, scale, day);
            else drawSign(ctx, scale, item.side);
            ctx.restore();
        }
    }

    function drawTree(ctx, scale, lean, day) {
        const trunkH = 42 * scale;
        ctx.save();
        ctx.rotate(lean);
        ctx.fillStyle = day > 0.5 ? '#5A3E2B' : '#30261F';
        ctx.fillRect(-3 * scale, -trunkH, 6 * scale, trunkH);
        const leafBase = day > 0.5 ? '#1F7A42' : '#12341F';
        ctx.fillStyle = leafBase;
        for (let i = 0; i < 3; i++) {
            const r = (17 - i * 2) * scale;
            const cy = -trunkH - i * 13 * scale;
            ctx.beginPath();
            ctx.moveTo(0, cy - r * 1.3);
            ctx.lineTo(-r, cy + r * 0.8);
            ctx.lineTo(r, cy + r * 0.8);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    function drawRock(ctx, scale, day) {
        ctx.fillStyle = day > 0.5 ? '#6B7280' : '#2D3441';
        ctx.beginPath();
        ctx.moveTo(-18 * scale, 0);
        ctx.lineTo(-8 * scale, -12 * scale);
        ctx.lineTo(10 * scale, -14 * scale);
        ctx.lineTo(22 * scale, -2 * scale);
        ctx.lineTo(16 * scale, 6 * scale);
        ctx.lineTo(-14 * scale, 7 * scale);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.stroke();
    }

    function drawSign(ctx, scale) {
        ctx.fillStyle = '#5A3E2B';
        ctx.fillRect(-2 * scale, -34 * scale, 4 * scale, 34 * scale);
        ctx.fillStyle = '#F59E0B';
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5 * scale;
        ctx.beginPath();
        ctx.rect(-17 * scale, -52 * scale, 34 * scale, 18 * scale);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(-8 * scale, -43 * scale);
        ctx.lineTo(7 * scale, -43 * scale);
        ctx.stroke();
    }

    // ── 3D Scene Renderer ──
    function drawScene(currentDist) {
        const canvas = $('#sceneCanvas'); const { ctx, w, h } = setupCanvas(canvas);
        ctx.clearRect(0, 0, w, h);
        const horizonY = h * 0.42;
        const curElev = getElevAtDist(currentDist);
        const curSlope = getSlopeAtDist(currentDist);
        const progress = elevBounds.maxDist > 0 ? currentDist / elevBounds.maxDist : 0;

        const dayPhase = clamp(progress * 1.25, 0, 1);
        const dawn = clamp((dayPhase - 0.18) / 0.34, 0, 1);
        const day = clamp((dayPhase - 0.42) / 0.34, 0, 1);

        // ── Sky gradient with route-driven night → day transition ──
        const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
        skyGrad.addColorStop(0, mixColor('#050a18', '#76B7E8', day));
        skyGrad.addColorStop(0.35, mixColor('#0a1428', '#F8B16D', dawn * (1 - day * 0.45)));
        skyGrad.addColorStop(0.68, mixColor('#0f1f3a', '#9DD7F4', day));
        skyGrad.addColorStop(1, mixColor('#1a3358', '#D9F2FF', day));
        ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, w, horizonY + 2);

        // ── Stars ──
        for (const s of stars) {
            const flicker = 0.6 + 0.4 * Math.sin(performance.now() * 0.001 * s.b + s.x * 100);
            ctx.globalAlpha = s.b * flicker * 0.7 * (1 - dawn);
            ctx.fillStyle = '#fff'; ctx.beginPath();
            ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // ── Moon to daylight transition ──
        const moonX = w * (0.78 - dayPhase * 0.46), moonY = h * (0.12 + dayPhase * 0.18);
        ctx.globalAlpha = Math.max(0, 1 - dayPhase * 1.35);
        const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 80);
        moonGlow.addColorStop(0, 'rgba(200,220,255,0.15)'); moonGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = moonGlow; ctx.fillRect(moonX - 80, moonY - 80, 160, 160);
        ctx.fillStyle = 'rgba(220,230,255,0.8)'; ctx.beginPath();
        ctx.arc(moonX, moonY, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = day;
        const sunX = w * (0.16 + day * 0.1), sunY = h * (0.25 - day * 0.12);
        const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 95);
        sunGlow.addColorStop(0, 'rgba(255,219,145,0.42)'); sunGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = sunGlow; ctx.fillRect(sunX - 95, sunY - 95, 190, 190);
        ctx.fillStyle = 'rgba(255,232,165,0.9)'; ctx.beginPath(); ctx.arc(sunX, sunY, 13, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // ── Mountain layers (parallax driven by distance) ──
        const scroll = currentDist * 0.0002;
        const mtnLayers = [
            { seed: 7, scale: 0.5, height: 0.38, baseY: horizonY, color: 'rgba(15,25,50,0.7)', speed: 0.15, octaves: 4 },
            { seed: 23, scale: 0.8, height: 0.28, baseY: horizonY, color: 'rgba(18,32,55,0.75)', speed: 0.3, octaves: 3 },
            { seed: 42, scale: 1.2, height: 0.20, baseY: horizonY, color: 'rgba(12,22,38,0.85)', speed: 0.5, octaves: 3 },
        ];
        for (const layer of mtnLayers) {
            ctx.beginPath(); ctx.moveTo(0, layer.baseY);
            const step = 4;
            for (let px = 0; px <= w; px += step) {
                const nx = (px / w) * layer.scale + scroll * layer.speed;
                const mh = mountainProfile(nx, layer.seed, layer.octaves);
                const eleInfluence = mapReady ? (getElevAtDist(clamp(currentDist + (px/w - 0.5) * 2000 * layer.speed, 0, elevBounds.maxDist)) - elevBounds.minEle) / Math.max(elevBounds.maxEle - elevBounds.minEle, 1) : 0.5;
                const peakH = layer.height * (0.6 + eleInfluence * 0.6);
                ctx.lineTo(px, layer.baseY - mh * peakH * horizonY);
            }
            ctx.lineTo(w, layer.baseY); ctx.closePath(); ctx.fillStyle = layer.color; ctx.fill();
        }

        // ── Horizon atmosphere glow ──
        const hGlow = ctx.createLinearGradient(0, horizonY - 30, 0, horizonY + 20);
        hGlow.addColorStop(0, 'transparent'); hGlow.addColorStop(0.5, 'rgba(14,165,233,0.06)');
        hGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = hGlow; ctx.fillRect(0, horizonY - 30, w, 50);

        // ── Ground plane ──
        const gndGrad = ctx.createLinearGradient(0, horizonY, 0, h);
        const baseGreen = curSlope > 0.03 ? [25, 55, 30] : curSlope < -0.02 ? [20, 45, 35] : [22, 50, 28];
        gndGrad.addColorStop(0, `rgba(${baseGreen[0]},${baseGreen[1]+10},${baseGreen[2]},1)`);
        gndGrad.addColorStop(0.3, `rgba(${baseGreen[0]-4},${baseGreen[1]},${baseGreen[2]-5},1)`);
        gndGrad.addColorStop(1, `rgba(${baseGreen[0]-8},${baseGreen[1]-15},${baseGreen[2]-10},1)`);
        ctx.fillStyle = gndGrad; ctx.fillRect(0, horizonY, w, h - horizonY);

        // ── Ground texture stripes (perspective speed lines) ──
        const stripeCount = 14;
        for (let i = 0; i < stripeCount; i++) {
            const phase = ((currentDist * 0.04 + i * (1 / stripeCount)) % 1);
            const t = phase;
            const y = horizonY + Math.pow(t, 1.8) * (h - horizonY);
            const alpha = t * 0.12;
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // ── Road with perspective ──
        const vanishX = w * 0.5, vanishY = horizonY;
        const roadBottom = h * 0.92;
        const roadSegments = 40;
        const leftEdge = [], rightEdge = [], centerLine = [];
        for (let i = 0; i <= roadSegments; i++) {
            const t = i / roadSegments;
            const y = vanishY + Math.pow(t, 1.5) * (roadBottom - vanishY);
            const roadHalfW = lerp(2, w * 0.18, Math.pow(t, 1.2));
            const sway = Math.sin(currentDist * 0.003 + t * 3) * roadHalfW * 0.15 * (1 - t * 0.5);
            const cx = vanishX + sway;
            leftEdge.push({ x: cx - roadHalfW, y });
            rightEdge.push({ x: cx + roadHalfW, y });
            centerLine.push({ x: cx, y });
        }

        // Road surface
        ctx.beginPath(); ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
        for (const p of leftEdge) ctx.lineTo(p.x, p.y);
        for (let i = rightEdge.length - 1; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
        ctx.closePath();
        const roadGrad = ctx.createLinearGradient(0, vanishY, 0, roadBottom);
        roadGrad.addColorStop(0, '#2a2a2a'); roadGrad.addColorStop(0.5, '#333'); roadGrad.addColorStop(1, '#282828');
        ctx.fillStyle = roadGrad; ctx.fill();

        // Road edge lines
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); for (let i = 0; i < leftEdge.length; i++) { if (i === 0) ctx.moveTo(leftEdge[i].x, leftEdge[i].y); else ctx.lineTo(leftEdge[i].x, leftEdge[i].y); } ctx.stroke();
        ctx.beginPath(); for (let i = 0; i < rightEdge.length; i++) { if (i === 0) ctx.moveTo(rightEdge[i].x, rightEdge[i].y); else ctx.lineTo(rightEdge[i].x, rightEdge[i].y); } ctx.stroke();

        // Dashed center line
        ctx.setLineDash([10, 16]); ctx.lineDashOffset = -(currentDist * 0.8) % 26;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); for (let i = 0; i < centerLine.length; i++) { if (i === 0) ctx.moveTo(centerLine[i].x, centerLine[i].y); else ctx.lineTo(centerLine[i].x, centerLine[i].y); } ctx.stroke();
        ctx.setLineDash([]);

        // Orange center glow line
        ctx.strokeStyle = 'rgba(249,115,22,0.2)'; ctx.lineWidth = 3;
        ctx.beginPath(); for (let i = 0; i < centerLine.length; i++) { if (i === 0) ctx.moveTo(centerLine[i].x, centerLine[i].y); else ctx.lineTo(centerLine[i].x, centerLine[i].y); } ctx.stroke();

        drawRoadsideScenery(ctx, w, h, currentDist, vanishX, vanishY, roadBottom, day);

        // ── Rider marker ──
        const riderX = vanishX, riderY = roadBottom - 12;
        ctx.save(); ctx.shadowColor = 'rgba(249,115,22,0.6)'; ctx.shadowBlur = 18;
        ctx.fillStyle = '#F97316'; ctx.beginPath(); ctx.arc(riderX, riderY, 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Bike frame
        ctx.strokeStyle = '#34D399'; ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(riderX, riderY - 14); ctx.lineTo(riderX - 5, riderY + 2);
        ctx.moveTo(riderX, riderY - 14); ctx.lineTo(riderX + 5, riderY + 2);
        ctx.moveTo(riderX - 7, riderY - 7); ctx.lineTo(riderX + 7, riderY - 7);
        ctx.stroke();

        // ── Fog near horizon ──
        const fogGrad = ctx.createLinearGradient(0, horizonY - 10, 0, horizonY + 60);
        fogGrad.addColorStop(0, 'rgba(15,25,45,0.4)'); fogGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = fogGrad; ctx.fillRect(0, horizonY - 10, w, 70);
    }

    // ── Elevation strip ──
    function drawElevation(currentDist) {
        const canvas=$('#elevCanvas'); const{ctx,w,h}=setupCanvas(canvas); ctx.clearRect(0,0,w,h);
        if(!mapReady||routePoints.length<2)return;
        const padX=16,padTop=14,padBot=10,dW=w-padX*2,dH=h-padTop-padBot;
        const{minEle,maxEle,maxDist}=elevBounds; const eleRange=Math.max(maxEle-minEle,1);
        function toX(d){return padX+(clamp(d,0,maxDist)/maxDist)*dW;}
        function toY(e){return padTop+(1-(e-minEle)/eleRange)*dH;}
        const grad=ctx.createLinearGradient(0,padTop,0,h-padBot);
        grad.addColorStop(0,'rgba(167,139,250,0.35)');grad.addColorStop(0.5,'rgba(14,165,233,0.18)');grad.addColorStop(1,'rgba(249,115,22,0.06)');
        ctx.beginPath();ctx.moveTo(toX(0),h-padBot);
        for(const p of routePoints)ctx.lineTo(toX(p.dist),toY(p.ele));
        ctx.lineTo(toX(routePoints[routePoints.length-1].dist),h-padBot);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
        ctx.beginPath();ctx.strokeStyle='rgba(167,139,250,0.55)';ctx.lineWidth=2;
        for(let i=0;i<routePoints.length;i++){const x=toX(routePoints[i].dist),y=toY(routePoints[i].ele);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
        const cx=toX(currentDist);
        ctx.beginPath();ctx.moveTo(toX(0),h-padBot);
        for(const p of routePoints){if(p.dist>currentDist)break;ctx.lineTo(toX(p.dist),toY(p.ele));}
        const curEle=getElevAtDist(currentDist);ctx.lineTo(cx,toY(curEle));ctx.lineTo(cx,h-padBot);ctx.closePath();ctx.fillStyle='rgba(249,115,22,0.12)';ctx.fill();
        ctx.beginPath();ctx.strokeStyle='rgba(249,115,22,0.5)';ctx.lineWidth=2;
        ctx.moveTo(toX(0),toY(routePoints[0].ele));
        for(const p of routePoints){if(p.dist>currentDist)break;ctx.lineTo(toX(p.dist),toY(p.ele));}
        ctx.lineTo(cx,toY(curEle));ctx.stroke();
        ctx.save();ctx.shadowColor='rgba(249,115,22,0.6)';ctx.shadowBlur=10;
        ctx.beginPath();ctx.arc(cx,toY(curEle),5,0,Math.PI*2);ctx.fillStyle='#F97316';ctx.fill();ctx.restore();
        ctx.beginPath();ctx.arc(cx,toY(curEle),9,0,Math.PI*2);ctx.strokeStyle='rgba(249,115,22,0.25)';ctx.lineWidth=1.5;ctx.stroke();
        ctx.fillStyle='rgba(255,255,255,0.4)';ctx.font='600 10px Inter,sans-serif';
        ctx.fillText('START',toX(0),h-padBot+10);
        const endLabel='END';ctx.fillText(endLabel,toX(maxDist)-ctx.measureText(endLabel).width,h-padBot+10);
    }

    // ── Animation loop ──
    function frame() {
        renderDistance += (targetDistance - renderDistance) * 0.15;
        if (Math.abs(targetDistance - renderDistance) < 0.02) renderDistance = targetDistance;
        drawScene(renderDistance);
        drawElevation(renderDistance);
        animFrameId = requestAnimationFrame(frame);
    }
    animFrameId = requestAnimationFrame(frame);

    // ── Helpers ──
    function getPowerZone(w){if(w<120)return'z1';if(w<170)return'z2';if(w<230)return'z3';if(w<300)return'z4';if(w<380)return'z5';return'z6';}
    function estimateMaxHeartRate(){const age=Number(profile.age)||30;return Math.max(120,Math.min(220,208-0.7*age));}
    function getHeartRateZone(hr){if(!hr||hr<=0)return null;const pct=hr/estimateMaxHeartRate();if(pct<0.60)return'z1';if(pct<0.70)return'z2';if(pct<0.80)return'z3';if(pct<0.90)return'z4';if(pct<0.95)return'z5';return'z6';}
    function getTrainingZone(power, heartRate){return getHeartRateZone(heartRate)||getPowerZone(power);}
    function updateZoneBar(zone) {
        const zones=['z1','z2','z3','z4','z5','z6'];
        container.querySelectorAll('.zone-segment').forEach((seg,i)=>{seg.className='zone-segment';if(zones.indexOf(zone)>=i)seg.classList.add(zones[i]);if(zones[i]===zone)seg.classList.add('active');});
    }
    function getPowerTrend(){if(powerHistory.length<TREND_WINDOW)return'flat';const r=powerHistory.slice(-TREND_WINDOW);const mid=Math.floor(TREND_WINDOW/2);const f=r.slice(0,mid).reduce((a,b)=>a+b,0)/mid;const s=r.slice(mid).reduce((a,b)=>a+b,0)/(TREND_WINDOW-mid);const d=s-f;if(d>10)return'up';if(d<-10)return'down';return'flat';}
    function getGradientClass(s){const a=Math.abs(s);if(a<3)return'gradient-flat';if(a<6)return'gradient-mild';if(a<10)return'gradient-steep';return'gradient-brutal';}
    function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);if(h>0)return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;return `${m}:${String(sec).padStart(2,'0')}`;}

    // ── State updates ──
    stateListener = (e) => {
        const d = { ...state.snapshot(), ...e.detail };
        const pw = d.power || 0;
        powerHistory.push(pw); if (powerHistory.length > 60) powerHistory.shift();
        sessionPowerSum += pw; sessionPowerCount += 1;
        const avgPw = sessionPowerCount > 0 ? sessionPowerSum / sessionPowerCount : 0;
        const trend = getPowerTrend(); const zone = getTrainingZone(pw, d.heart_rate || 0);

        $('#power').innerHTML = pw + '<span class="power-trend ' + trend + '">' + (trend==='up'?'▲':trend==='down'?'▼':'') + '</span>';
        updateZoneBar(zone);
        targetDistance = d.distance || 0;
        $('#speed').textContent = (d.speed || 0).toFixed(1);
        $('#cadence').textContent = d.cadence || 0;
        $('#heartRate').textContent = d.heart_rate ? Math.round(d.heart_rate) : '--';
        $('#elapsed').textContent = fmt(d.elapsed || 0);
        $('#distanceKm').textContent = ((d.distance||0)/1000).toFixed(2);
        $('#totalDist').textContent = ((d.distance||0)/1000).toFixed(2);
        $('#calories').textContent = Math.round(d.calories || 0);
        $('#gear').textContent = d.gear || 0;
        $('#elevation').textContent = Math.round(d.elevation || 0);
        $('#elevGain').textContent = Math.round(d.elevation_gain || 0);
        $('#avgPower').textContent = Math.round(avgPw);
        $('#progBar').style.width = (d.progress || 0).toFixed(1) + '%';
        const wkg = riderWeight > 0 ? (pw / riderWeight).toFixed(1) : '0.0';
        $('#wkg').textContent = wkg;
        const slope = d.slope || 0; const gradEl = $('#gradient');
        gradEl.textContent = (slope >= 0 ? '+' : '') + slope.toFixed(1) + '%';
        gradEl.className = 'gradient-value ' + getGradientClass(slope);
        $('#liveDot').className = 'live-dot' + (d.ride_active && !d.ride_paused ? ' live' : '');
        const pauseBtn = $('#pauseBtn');
        pauseBtn.textContent = d.ride_paused ? '▶ Resume' : '⏸ Pause';
        pauseBtn.className = 'action-btn pause' + (d.ride_paused ? ' paused' : '');
        if (d.finished && !$('#stopModal').classList.contains('show')) {
            $('#stopModalIcon').textContent = '🏁'; $('#stopModalTitle').textContent = 'Route Complete!';
            $('#stopModalText').textContent = 'Great ride! What would you like to do with this activity?';
            $('#stopModal').classList.add('show');
        }
    };
    state.addEventListener('batch', stateListener);

    // ── Controls ──
    function doTogglePause() {
        const paused = togglePause();
        const btn = $('#pauseBtn');
        btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
        btn.className = 'action-btn pause' + (paused ? ' paused' : '');
    }

    $('#pauseBtn').onclick = doTogglePause;
    $('#stopBtn').onclick = () => $('#stopModal').classList.add('show');
    $('#rideSettingsBtn').onclick = () => { hydrateRideSettings(); $('#settingsModal').classList.add('show'); };
    $('#rideDevicesBtn').onclick = () => { renderRideDevices(); $('#devicesModal').classList.add('show'); };
    $('#closeSettings').onclick = () => $('#settingsModal').classList.remove('show');
    $('#closeDevices').onclick = () => $('#devicesModal').classList.remove('show');
    $('#finishCancel').onclick = () => $('#stopModal').classList.remove('show');
    $('#gearUpBtn').onclick = () => gearUp();
    $('#gearDownBtn').onclick = () => gearDown();

    function hydrateRideSettings() {
        const config = loadConfig();
        $('#rideGearCount').value = config.gear.virtual_gear_count ?? 22;
        $('#rideRollerMin').value = config.gear.roller_min_grade ?? 1;
        $('#rideRollerMax').value = config.gear.roller_max_grade ?? 22;
    }

    $('#saveRideSettings').onclick = () => {
        const gearCount = Math.round(Number($('#rideGearCount').value));
        const minGrade = Number($('#rideRollerMin').value);
        const maxGrade = Number($('#rideRollerMax').value);

        if (!Number.isFinite(gearCount) || gearCount < 2 || gearCount > 40) {
            alert('Use a virtual gear count between 2 and 40.');
            return;
        }
        if (!Number.isFinite(minGrade) || !Number.isFinite(maxGrade) || minGrade < 1 || maxGrade > 40 || minGrade >= maxGrade) {
            alert('Use a roller range between 1 and 40, with min lower than max.');
            return;
        }

        updateGearRange(minGrade, maxGrade, gearCount);
        updateRideGearSettings({
            virtual_gear_count: gearCount,
            roller_min_grade: minGrade,
            roller_max_grade: maxGrade,
        });
        $('#settingsModal').classList.remove('show');
    };

    function deviceStatusText(status, fallback) {
        if (status === 'connected' || status === 'ready') return 'Connected';
        if (status === 'connecting' || status === 'scanning' || status === 'verifying') return 'Connecting';
        if (status === 'degraded') return 'Connected, input not verified';
        return fallback;
    }

    function renderRideDevices() {
        const hasBle = isWebBluetoothAvailable();
        $('#bleAvailabilityText').textContent = hasBle
            ? 'Reconnect devices without leaving the ride.'
            : 'Web Bluetooth is not available in this browser.';

        const trainerStatus = state.get('trainer_status');
        const hrStatus = state.get('heart_rate_status');
        const rows = [];

        rows.push(renderDeviceRow({
            id: 'trainer',
            name: state.get('trainer_name') || 'Smart Trainer',
            status: deviceStatusText(trainerStatus, 'Not connected'),
            dot: trainerStatus === 'connected' ? 'connected' : trainerStatus === 'connecting' ? 'connecting' : '',
            actions: `<button class="mini-btn" data-action="trainer-connect">${trainerStatus === 'connected' ? 'Reconnect' : 'Connect'}</button>${trainerStatus === 'connected' ? '<button class="mini-btn danger" data-action="trainer-disconnect">Disconnect</button>' : ''}`,
        }));

        rows.push(renderDeviceRow({
            id: 'hr',
            name: state.get('heart_rate_name') || 'Heart Rate Monitor',
            status: `${deviceStatusText(hrStatus, 'Not connected')}${state.get('heart_rate') ? ` • ${Math.round(state.get('heart_rate'))} bpm` : ''}`,
            dot: hrStatus === 'connected' ? 'connected' : (hrStatus === 'connecting' || hrStatus === 'scanning') ? 'connecting' : '',
            actions: `<button class="mini-btn" data-action="hr-connect">${hrStatus === 'connected' ? 'Reconnect' : 'Connect'}</button>${hrStatus === 'connected' ? '<button class="mini-btn danger" data-action="hr-disconnect">Disconnect</button>' : ''}`,
        }));

        for (let slot = 0; slot < 2; slot++) {
            const info = getControllerInfo(slot);
            rows.push(renderDeviceRow({
                id: `controller-${slot}`,
                name: info.name || `Controller ${slot + 1}`,
                status: `${deviceStatusText(info.status, 'Not connected')}${info.inputReady ? ' • Input ready' : ''}`,
                dot: info.connected ? 'connected' : (info.status === 'connecting' || info.status === 'scanning' || info.status === 'verifying') ? 'connecting' : '',
                actions: `<button class="mini-btn" data-action="controller-connect">Add</button>${info.status !== 'disconnected' ? `<button class="mini-btn danger" data-action="controller-disconnect" data-slot="${slot}">Disconnect</button>` : ''}`,
            }));
        }

        $('#rideDeviceList').innerHTML = rows.join('');
        $('#rideDeviceList').querySelectorAll('[data-action]').forEach(button => {
            button.onclick = async () => {
                const action = button.dataset.action;
                button.disabled = true;
                if (action === 'trainer-connect') await scanAndConnectTrainer();
                if (action === 'trainer-disconnect') disconnectTrainer();
                if (action === 'hr-connect') await scanAndConnectHeartRate();
                if (action === 'hr-disconnect') disconnectHeartRate();
                if (action === 'controller-connect') await scanAndConnectController();
                if (action === 'controller-disconnect') disconnectController(Number(button.dataset.slot));
                renderRideDevices();
            };
        });
    }

    function renderDeviceRow({ name, status, dot, actions }) {
        return `
            <div class="device-row-live">
                <span class="device-dot-live ${dot}"></span>
                <div class="device-live-main">
                    <div class="device-live-name">${escapeHtml(name)}</div>
                    <div class="device-live-status">${escapeHtml(status)}</div>
                </div>
                <div class="device-actions">${actions}</div>
            </div>`;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function finishRide(mode) {
        const options = $('#stopModalOptions'); const text = $('#stopModalText');
        options.querySelectorAll('.modal-option').forEach(b => b.disabled = true);
        const labels = { local_only: '💾 Saving ride locally…', strava: '🔶 Saving and uploading to Strava…', discard: '🗑 Discarding ride…' };
        text.textContent = labels[mode] || 'Processing…';
        try {
            const result = await finalizeRide(mode);
            let icon = '✓', msg = '';
            if (mode === 'discard') { icon = '🗑'; msg = 'Ride discarded.'; }
            else {
                msg = result.message || 'Ride saved successfully.';
                const strava = result.strava || {};
                if (strava.status === 'success' || strava.status === 'processing') { icon = '🔶'; msg += ' Strava ✓'; }
                else if (strava.status === 'error') msg += ' Strava: ' + strava.message;
            }
            options.innerHTML = '<div class="modal-status"><span class="status-icon">' + icon + '</span>' + msg + '</div>';
            text.textContent = 'Done';
            setTimeout(() => navigateTo('history'), 2500);
        } catch (err) {
            text.textContent = 'Something went wrong. Please try again.';
            options.querySelectorAll('.modal-option').forEach(b => b.disabled = false);
        }
    }

    $('#finishLocal').onclick = () => finishRide('local_only');
    $('#finishStrava').onclick = () => finishRide('strava');
    $('#finishDiscard').onclick = () => finishRide('discard');
    $('#stopModal').onclick = (e) => { if (e.target.id === 'stopModal') $('#stopModal').classList.remove('show'); };
    $('#settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('#settingsModal').classList.remove('show'); };
    $('#devicesModal').onclick = (e) => { if (e.target.id === 'devicesModal') $('#devicesModal').classList.remove('show'); };

    deviceStateListener = () => {
        if ($('#devicesModal').classList.contains('show')) renderRideDevices();
    };
    state.addEventListener('change', deviceStateListener);
    state.addEventListener('batch', deviceStateListener);

    keyListener = (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); gearUp(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); gearDown(); }
    };
    document.addEventListener('keydown', keyListener);

    resizeListener = () => { drawScene(renderDistance); drawElevation(renderDistance); };
    window.addEventListener('resize', resizeListener);
}

export function unmount() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    if (stateListener) { state.removeEventListener('batch', stateListener); stateListener = null; }
    if (deviceStateListener) {
        state.removeEventListener('change', deviceStateListener);
        state.removeEventListener('batch', deviceStateListener);
        deviceStateListener = null;
    }
    if (keyListener) { document.removeEventListener('keydown', keyListener); keyListener = null; }
    if (resizeListener) { window.removeEventListener('resize', resizeListener); resizeListener = null; }
    setControllerCallbacks({ gearUp: null, gearDown: null, pause: null });
    try { stopRide(); } catch (_) {}
}
