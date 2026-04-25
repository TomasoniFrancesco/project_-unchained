/**
 * History view — past rides list.
 */
import { listActivities } from '../storage/activities.js';

export async function mount(container) {
    container.innerHTML = `
    <style>
        .activity-list { width:100%; max-width:680px; display:flex; flex-direction:column; gap:0.55rem; }
        .s-duration .stat-val { color: var(--text); }
        .s-distance .stat-val { color: var(--color-distance); }
        .s-power .stat-val    { color: var(--color-power); }
        .s-cadence .stat-val  { color: var(--color-cadence); }
        .s-hr .stat-val       { color: var(--color-hr); }
        .s-speed .stat-val    { color: var(--color-speed); }
        .s-elev .stat-val     { color: var(--color-elevation); }

        /* ── History responsive: phones ── */
        @media (max-width: 640px) {
            .activity-list { max-width: 100%; }
        }
    </style>
    <div class="page">
        <div class="brand-header">
            <h1 class="brand-title">UNCHAINED PROJECT</h1>
            <p class="brand-subtitle">Activity History</p>
        </div>
        <div style="width:100%;max-width:680px;margin-bottom:1rem;">
            <a class="back-link" href="#home">← Back to home</a>
        </div>
        <div class="activity-list" id="activityList"></div>
    </div>`;

    const activities = await listActivities();
    const list = container.querySelector('#activityList');

    if (!activities.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🚴</div>No rides yet. Complete a ride to see it here.</div>';
    } else {
        list.innerHTML = activities.map((act, i) => {
            const mins = Math.floor(act.duration_s / 60);
            const secs = Math.floor(act.duration_s % 60);
            const dur = `${mins}:${String(secs).padStart(2, '0')}`;
            const dateStr = (act.date || '').slice(0, 16).replace('T', ' ');
            return `
            <div class="card activity-card stagger-${i+1}">
                <div class="activity-header">
                    <span class="activity-route-name">${act.route_name}</span>
                    <span class="activity-date">${dateStr}</span>
                </div>
                <div class="activity-stats">
                    <div class="stat s-duration"><div class="stat-val">${dur}</div><div class="stat-label">Duration</div></div>
                    <div class="stat s-distance"><div class="stat-val">${(act.distance_m / 1000).toFixed(2)}</div><div class="stat-label">km</div></div>
                    <div class="stat s-power"><div class="stat-val">${Math.round(act.avg_power_w)}</div><div class="stat-label">Avg W</div></div>
                    <div class="stat s-cadence"><div class="stat-val">${Math.round(act.avg_cadence)}</div><div class="stat-label">RPM</div></div>
                    <div class="stat s-hr"><div class="stat-val">${act.avg_heart_rate_bpm ? Math.round(act.avg_heart_rate_bpm) : '--'}</div><div class="stat-label">BPM</div></div>
                    <div class="stat s-speed"><div class="stat-val">${act.avg_speed_kmh.toFixed(1)}</div><div class="stat-label">km/h</div></div>
                    <div class="stat s-elev"><div class="stat-val">${Math.round(act.elevation_gain_m)}</div><div class="stat-label">Elev ↑</div></div>
                </div>
            </div>`;
        }).join('');
    }
}

export function unmount() {}
