/**
 * Ride view — full-screen cycling ride with canvas, HUD, and controller support.
 * Most complex view — handles canvas lifecycle, animation frames, modals.
 */
import { state } from '../state.js';
import { startRide, stopRide, togglePause, gearUp, gearDown, finalizeRide, getRoutePoints, getRideTotalDistance } from '../engine/ride.js';
import { loadProfile } from '../storage/profile.js';
import { setControllerCallbacks, getControllerInfo, isControllerConnected } from '../ble/manager.js';
import { navigateTo } from '../router.js';

let animFrameId = null;
let stateListener = null;
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
        #rideRoot { position:fixed; inset:0; z-index:50; background:var(--bg); }
        #roadCanvas { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0; }
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
        .center-hud { position:absolute; top:16px; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:6px; }
        .timer-pill { padding:8px 28px; text-align:center; }
        .timer-value { font-size:2.2rem; font-weight:800; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; text-shadow:0 2px 20px rgba(0,0,0,0.5); }
        .main-metrics { display:flex; align-items:center; gap:2px; padding:6px 8px; }
        .metric-block { display:flex; align-items:baseline; gap:5px; padding:4px 16px; }
        .metric-block .icon { font-size:0.85rem; opacity:0.6; }
        .metric-block .val { font-size:2.6rem; font-weight:900; letter-spacing:-0.03em; font-variant-numeric:tabular-nums; line-height:1; text-shadow:0 2px 16px rgba(0,0,0,0.4); }
        .metric-divider { width:1px; height:32px; background:rgba(255,255,255,0.12); }
        .power-val { color:var(--color-power); } .cadence-val { color:var(--color-cadence); }
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
        .bottom-left { display:flex; gap:8px; align-items:flex-end; }
        .stat-mini { padding:8px 14px; text-align:center; }
        .stat-mini .mini-val { font-size:1.1rem; font-weight:800; font-variant-numeric:tabular-nums; }
        .stat-mini .mini-label { font-size:0.5rem; font-weight:600; text-transform:uppercase; letter-spacing:0.1em; color:rgba(255,255,255,0.4); margin-top:2px; }
        .calories-val{color:var(--color-calories)} .elevation-val{color:var(--color-elevation)} .climb-val{color:var(--color-elevation)}
        .gear-block { padding:12px 20px; display:flex; align-items:center; gap:16px; }
        .gear-number { font-size:3.2rem; font-weight:900; line-height:1; font-variant-numeric:tabular-nums; color:#fff; text-shadow:0 2px 16px rgba(0,0,0,0.4); }
        .gear-label { font-size:0.6rem; font-weight:600; text-transform:uppercase; letter-spacing:0.12em; color:rgba(255,255,255,0.4); }
        .gear-arrows { display:flex; gap:6px; }
        .gear-arrow { width:36px; height:36px; border-radius:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.6); font-size:1.1rem; display:flex; align-items:center; justify-content:center; cursor:pointer; font-family:inherit; transition:all 0.15s; }
        .gear-arrow:hover { background:rgba(255,255,255,0.15); color:#fff; }
        .elev-strip { height:60px; background:rgba(11,18,32,0.65); backdrop-filter:blur(10px); border-top:1px solid var(--glass-border); position:relative; }
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
    </style>
    <div id="rideRoot">
        <canvas id="roadCanvas"></canvas>
        <div class="hud">
            <div class="top-bar">
                <div class="top-left">
                    <span class="brand">FUCK ZWIFT</span>
                    <div class="route-name-pill pill-sm"><span class="live-dot" id="liveDot"></span><span id="routeNameLabel">${route.name}</span></div>
                </div>
                <div class="top-actions">
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
    let routeMeters = [], totalDistance = 0, mapReady = false;
    const elevBounds = { minEle: 0, maxEle: 0, maxDist: 1 };
    const powerHistory = [], TREND_WINDOW = 10;
    let sessionPowerSum = 0, sessionPowerCount = 0;
    let targetDistance = 0, renderDistance = 0;

    if (routePoints.length > 1) {
        totalDistance = routePoints[routePoints.length - 1].distance_from_start || 0;
        routePoints = routePoints.map(p => ({ lat: p.lat, lon: p.lon, ele: p.elevation, dist: p.distance_from_start }));
        computeRouteMeta(); mapReady = true;
    }

    function computeRouteMeta() {
        const eles = routePoints.map(p => p.ele);
        elevBounds.minEle = Math.min(...eles) - 10; elevBounds.maxEle = Math.max(...eles) + 10;
        elevBounds.maxDist = Math.max(totalDistance || routePoints[routePoints.length-1].dist || 1, 1);
        routeMeters = routePoints.map(p => {
            const latRad = p.lat * Math.PI / 180;
            return { x: p.lon * 111320 * Math.cos(latRad), y: p.lat * 111320, ele: p.ele, dist: p.dist };
        });
    }

    function setupCanvas(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, w: rect.width, h: rect.height };
    }
    function lerp(a,b,t) { return a+(b-a)*t; }
    function clamp(v,min,max) { return Math.max(min,Math.min(max,v)); }

    function getSegmentIndex(dist) {
        if (!routePoints.length) return 0;
        for (let i=1;i<routePoints.length;i++) { if (routePoints[i].dist>=dist) return i-1; }
        return routePoints.length-2;
    }
    function interpolateSample(dist) {
        if (!routePoints.length) return {x:0,y:0,ele:0,dist:0};
        if (routePoints.length===1) return routeMeters[0];
        const d=clamp(dist,0,elevBounds.maxDist); const idx=getSegmentIndex(d);
        const a=routeMeters[idx], b=routeMeters[Math.min(idx+1,routeMeters.length-1)];
        const seg=Math.max(1e-6,b.dist-a.dist); const t=clamp((d-a.dist)/seg,0,1);
        return {x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),ele:lerp(a.ele,b.ele,t),dist:d};
    }
    function headingAt(dist) {
        const a=interpolateSample(dist), b=interpolateSample(Math.min(dist+8,elevBounds.maxDist));
        let dx=b.x-a.x, dy=b.y-a.y; const len=Math.hypot(dx,dy)||1;
        return {dx:dx/len,dy:dy/len};
    }

    function drawMountains(ctx,w,skyH) {
        ctx.beginPath();ctx.moveTo(0,skyH);
        const fp=[0.08,0.15,0.22,0.30,0.38,0.45,0.52,0.60,0.68,0.75,0.82,0.90,1.0];
        const fh=[0.65,0.45,0.55,0.35,0.60,0.42,0.58,0.38,0.52,0.40,0.55,0.48,0.60];
        for(let i=0;i<fp.length;i++)ctx.lineTo(w*fp[i],skyH-skyH*fh[i]*0.35);
        ctx.lineTo(w,skyH);ctx.closePath();ctx.fillStyle='rgba(20,35,60,0.30)';ctx.fill();
        ctx.beginPath();ctx.moveTo(0,skyH);
        const mp=[0.05,0.12,0.20,0.28,0.36,0.44,0.52,0.62,0.72,0.80,0.88,0.95,1.0];
        const mh=[0.30,0.50,0.35,0.55,0.32,0.48,0.40,0.52,0.35,0.45,0.38,0.50,0.35];
        for(let i=0;i<mp.length;i++)ctx.lineTo(w*mp[i],skyH-skyH*mh[i]*0.25);
        ctx.lineTo(w,skyH);ctx.closePath();ctx.fillStyle='rgba(15,25,45,0.40)';ctx.fill();
        ctx.beginPath();ctx.moveTo(0,skyH);
        const np=[0.06,0.14,0.24,0.34,0.44,0.56,0.66,0.76,0.86,0.94,1.0];
        const nh=[0.12,0.22,0.15,0.25,0.18,0.20,0.14,0.22,0.16,0.20,0.14];
        for(let i=0;i<np.length;i++)ctx.lineTo(w*np[i],skyH-skyH*nh[i]*0.30);
        ctx.lineTo(w,skyH);ctx.closePath();ctx.fillStyle='rgba(12,20,35,0.50)';ctx.fill();
    }

    function drawRoad(currentDist) {
        const canvas=$('#roadCanvas'); const{ctx,w,h}=setupCanvas(canvas);
        ctx.clearRect(0,0,w,h);
        const skyH=h*0.38;
        const skyGrad=ctx.createLinearGradient(0,0,0,skyH);
        skyGrad.addColorStop(0,'#0B1220');skyGrad.addColorStop(0.3,'#0f1a2e');skyGrad.addColorStop(0.6,'#162a44');skyGrad.addColorStop(1,'#1e3a5a');
        ctx.fillStyle=skyGrad;ctx.fillRect(0,0,w,skyH);
        drawMountains(ctx,w,skyH);
        const groundGrad=ctx.createLinearGradient(0,skyH,0,h);
        groundGrad.addColorStop(0,'#1a3020');groundGrad.addColorStop(0.15,'#152818');groundGrad.addColorStop(1,'#0d1a10');
        ctx.fillStyle=groundGrad;ctx.fillRect(0,skyH,w,h-skyH);
        if(!mapReady||routePoints.length<2)return;
        const horizonY=skyH,riderY=h*0.82,centerX=w*0.5;
        const rider=interpolateSample(currentDist),heading=headingAt(currentDist);
        const cos=heading.dy,sin=heading.dx;
        const behind=20,ahead=300,step=3,projected=[];
        for(let d=-behind;d<=ahead;d+=step){
            const sample=interpolateSample(currentDist+d);
            const relX=sample.x-rider.x,relY=sample.y-rider.y;
            const lateral=relX*cos-relY*sin,forward=relX*sin+relY*cos;
            if(forward<-behind||forward>ahead+step)continue;
            const t=clamp((forward+behind)/(ahead+behind),0,1);
            const y=riderY-Math.pow(t,0.82)*(riderY-horizonY);
            const xScale=lerp(1.6,0.2,t);
            projected.push({x:centerX+lateral*xScale*1.8,y,t});
        }
        if(projected.length<2)return;
        const leftEdge=[],rightEdge=[];
        for(const p of projected){const half=lerp(100,10,p.t);leftEdge.push({x:p.x-half,y:p.y});rightEdge.push({x:p.x+half,y:p.y});}
        ctx.beginPath();ctx.moveTo(leftEdge[0].x,leftEdge[0].y);
        for(const p of leftEdge)ctx.lineTo(p.x,p.y);
        for(let i=rightEdge.length-1;i>=0;i--)ctx.lineTo(rightEdge[i].x,rightEdge[i].y);
        ctx.closePath();
        const roadGrad=ctx.createLinearGradient(0,horizonY,0,riderY);
        roadGrad.addColorStop(0,'#3a3a3a');roadGrad.addColorStop(0.4,'#2e2e2e');roadGrad.addColorStop(1,'#222222');
        ctx.fillStyle=roadGrad;ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=2;
        ctx.beginPath();for(let i=0;i<leftEdge.length;i++){if(i===0)ctx.moveTo(leftEdge[i].x,leftEdge[i].y);else ctx.lineTo(leftEdge[i].x,leftEdge[i].y);}ctx.stroke();
        ctx.beginPath();for(let i=0;i<rightEdge.length;i++){if(i===0)ctx.moveTo(rightEdge[i].x,rightEdge[i].y);else ctx.lineTo(rightEdge[i].x,rightEdge[i].y);}ctx.stroke();
        ctx.setLineDash([12,18]);ctx.strokeStyle='rgba(255,255,255,0.20)';ctx.lineWidth=2;
        ctx.beginPath();for(let i=0;i<projected.length;i++){if(i===0)ctx.moveTo(projected[i].x,projected[i].y);else ctx.lineTo(projected[i].x,projected[i].y);}ctx.stroke();ctx.setLineDash([]);
        ctx.strokeStyle='rgba(249,115,22,0.30)';ctx.lineWidth=3;
        ctx.beginPath();for(let i=0;i<projected.length;i++){if(i===0)ctx.moveTo(projected[i].x,projected[i].y);else ctx.lineTo(projected[i].x,projected[i].y);}ctx.stroke();
        ctx.save();ctx.shadowColor='rgba(249,115,22,0.50)';ctx.shadowBlur=15;
        ctx.fillStyle='#F97316';ctx.beginPath();ctx.arc(centerX,riderY-6,5,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#34D399';ctx.lineWidth=2.5;ctx.beginPath();
        ctx.moveTo(centerX,riderY-11);ctx.lineTo(centerX-4,riderY+2);ctx.moveTo(centerX,riderY-11);ctx.lineTo(centerX+4,riderY+2);
        ctx.moveTo(centerX-6,riderY-6);ctx.lineTo(centerX+6,riderY-6);ctx.stroke();ctx.restore();
    }

    function drawElevation(currentDist) {
        const canvas=$('#elevCanvas'); const{ctx,w,h}=setupCanvas(canvas); ctx.clearRect(0,0,w,h);
        if(!mapReady||routePoints.length<2)return;
        const padX=10,padTop=6,padBot=4,dW=w-padX*2,dH=h-padTop-padBot;
        const{minEle,maxEle,maxDist}=elevBounds; const eleRange=Math.max(maxEle-minEle,1);
        function toX(d){return padX+(clamp(d,0,maxDist)/maxDist)*dW;}
        function toY(e){return padTop+(1-(e-minEle)/eleRange)*dH;}
        const grad=ctx.createLinearGradient(0,padTop,0,h-padBot);
        grad.addColorStop(0,'rgba(167,139,250,0.30)');grad.addColorStop(0.5,'rgba(14,165,233,0.15)');grad.addColorStop(1,'rgba(249,115,22,0.05)');
        ctx.beginPath();ctx.moveTo(toX(0),h-padBot);
        for(const p of routePoints)ctx.lineTo(toX(p.dist),toY(p.ele));
        ctx.lineTo(toX(routePoints[routePoints.length-1].dist),h-padBot);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
        ctx.beginPath();ctx.strokeStyle='rgba(167,139,250,0.6)';ctx.lineWidth=1.5;
        for(let i=0;i<routePoints.length;i++){const x=toX(routePoints[i].dist),y=toY(routePoints[i].ele);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
        const cx=toX(currentDist);
        ctx.beginPath();ctx.moveTo(toX(0),h-padBot);
        for(const p of routePoints){if(p.dist>currentDist)break;ctx.lineTo(toX(p.dist),toY(p.ele));}
        const curS=interpolateSample(currentDist);ctx.lineTo(cx,toY(curS.ele));ctx.lineTo(cx,h-padBot);ctx.closePath();ctx.fillStyle='rgba(249,115,22,0.10)';ctx.fill();
        ctx.beginPath();ctx.arc(cx,toY(curS.ele),4,0,Math.PI*2);ctx.fillStyle='#F97316';ctx.fill();
        ctx.beginPath();ctx.arc(cx,toY(curS.ele),7,0,Math.PI*2);ctx.strokeStyle='rgba(249,115,22,0.30)';ctx.lineWidth=1.5;ctx.stroke();
    }

    // ── Animation loop ──
    function frame() {
        renderDistance += (targetDistance - renderDistance) * 0.15;
        if (Math.abs(targetDistance - renderDistance) < 0.02) renderDistance = targetDistance;
        drawRoad(renderDistance); drawElevation(renderDistance);
        animFrameId = requestAnimationFrame(frame);
    }
    animFrameId = requestAnimationFrame(frame);

    // ── Helpers ──
    function getPowerZone(w){if(w<120)return'z1';if(w<170)return'z2';if(w<230)return'z3';if(w<300)return'z4';if(w<380)return'z5';return'z6';}
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
        const trend = getPowerTrend(); const zone = getPowerZone(pw);

        $('#power').innerHTML = pw + '<span class="power-trend ' + trend + '">' + (trend==='up'?'▲':trend==='down'?'▼':'') + '</span>';
        updateZoneBar(zone);
        targetDistance = d.distance || 0;
        $('#speed').textContent = (d.speed || 0).toFixed(1);
        $('#cadence').textContent = d.cadence || 0;
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
    $('#finishCancel').onclick = () => $('#stopModal').classList.remove('show');
    $('#gearUpBtn').onclick = () => gearUp();
    $('#gearDownBtn').onclick = () => gearDown();

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

    keyListener = (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); gearUp(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); gearDown(); }
    };
    document.addEventListener('keydown', keyListener);

    resizeListener = () => { drawRoad(renderDistance); drawElevation(renderDistance); };
    window.addEventListener('resize', resizeListener);
}

export function unmount() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    if (stateListener) { state.removeEventListener('batch', stateListener); stateListener = null; }
    if (keyListener) { document.removeEventListener('keydown', keyListener); keyListener = null; }
    if (resizeListener) { window.removeEventListener('resize', resizeListener); resizeListener = null; }
    setControllerCallbacks({ gearUp: null, gearDown: null, pause: null });
    try { stopRide(); } catch (_) {}
}
