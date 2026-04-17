/**
 * Profile view — cyclist profile form and Strava settings.
 */
import { loadProfile, saveProfile } from '../storage/profile.js';
import { getStrava, updateStrava } from '../storage/config.js';
import { getStatus, startOAuth, disconnect } from '../integrations/strava.js';

export function mount(container) {
    const profile = loadProfile();
    const strava = getStrava();

    container.innerHTML = `
    <div class="page">
        <div class="brand-header">
            <h1 class="brand-title">FUCK ZWIFT</h1>
            <p class="brand-subtitle">Cyclist Profile</p>
        </div>

        <div style="width:100%;max-width:520px;">
            <a class="back-link" href="#home" style="margin-bottom:1rem;display:inline-block;">← Back to home</a>

            <div class="section">
                <div class="section-title">Profile</div>
                <div class="card" style="padding:1.5rem;">
                    <div class="form-group"><label class="form-label">Name</label><input class="form-input" type="text" id="pName" value="${profile.name || ''}"></div>
                    <div class="form-group"><label class="form-label">Age</label><input class="form-input" type="number" id="pAge" min="10" max="99" value="${profile.age || ''}"></div>
                    <div class="form-group"><label class="form-label">Gender</label>
                        <select class="form-select" id="pGender"><option value="male" ${profile.gender === 'male' ? 'selected' : ''}>Male</option><option value="female" ${profile.gender === 'female' ? 'selected' : ''}>Female</option></select>
                    </div>
                    <div class="form-group"><label class="form-label">Weight (kg)</label><input class="form-input" type="number" id="pWeight" step="0.1" min="30" max="200" value="${profile.weight_kg || ''}"></div>
                    <div class="form-group"><label class="form-label">Height (cm) — optional</label><input class="form-input" type="number" id="pHeight" min="100" max="250" value="${profile.height_cm || ''}"></div>
                    <button class="btn btn-primary btn-full" id="saveProfileBtn">Save Profile</button>
                    <div class="status-msg" id="profileMsg"></div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Strava</div>
                <div class="card" style="padding:1.5rem;">
                    <div id="stravaStatus"></div>
                    <div class="form-group"><label class="form-label">Client ID</label><input class="form-input" type="text" id="stravaId" value="${strava.client_id || ''}"></div>
                    <div class="form-group"><label class="form-label">Client Secret</label><input class="form-input" type="password" id="stravaSecret" value="${strava.client_secret || ''}"></div>
                    <div style="display:flex;gap:0.5rem;">
                        <button class="btn btn-secondary" style="flex:1" id="saveStravaBtn">Save Credentials</button>
                        <button class="btn btn-strava" style="flex:1" id="connectStravaBtn">Connect Strava</button>
                    </div>
                    <div style="margin-top:0.6rem;">
                        <button class="btn btn-ghost btn-danger" id="disconnectStravaBtn" style="font-size:0.65rem;">Disconnect Strava</button>
                    </div>
                    <div class="status-msg" id="stravaMsg"></div>
                </div>
            </div>
        </div>
    </div>`;

    function updateStravaStatus() {
        const status = getStatus();
        const el = container.querySelector('#stravaStatus');
        if (status.connected) {
            el.innerHTML = `<div class="status-pill connected" style="margin-bottom:1rem;"><span class="status-dot"></span> Connected${status.athlete_name ? ': ' + status.athlete_name : ''}</div>`;
        } else if (status.configured) {
            el.innerHTML = `<div class="status-pill disconnected" style="margin-bottom:1rem;"><span class="status-dot"></span> Configured but not connected</div>`;
        } else {
            el.innerHTML = `<div class="status-pill disconnected" style="margin-bottom:1rem;"><span class="status-dot"></span> Not configured</div>`;
        }
    }

    function showMsg(id, text, isError) {
        const el = container.querySelector('#' + id);
        el.textContent = text;
        el.style.color = isError ? '#EF4444' : 'var(--primary)';
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }

    container.querySelector('#saveProfileBtn').onclick = () => {
        saveProfile({
            name: container.querySelector('#pName').value,
            age: container.querySelector('#pAge').value,
            gender: container.querySelector('#pGender').value,
            weight_kg: container.querySelector('#pWeight').value,
            height_cm: container.querySelector('#pHeight').value,
        });
        showMsg('profileMsg', '✓ Profile saved');
    };

    container.querySelector('#saveStravaBtn').onclick = () => {
        const id = container.querySelector('#stravaId').value.trim();
        const secret = container.querySelector('#stravaSecret').value.trim();
        if (!id || !secret) { showMsg('stravaMsg', '⚠ Both fields required', true); return; }
        updateStrava(id, secret);
        showMsg('stravaMsg', '✓ Strava credentials saved');
        updateStravaStatus();
    };

    container.querySelector('#connectStravaBtn').onclick = () => {
        container.querySelector('#saveStravaBtn').click();
        startOAuth();
    };

    container.querySelector('#disconnectStravaBtn').onclick = () => {
        disconnect();
        showMsg('stravaMsg', '✓ Strava disconnected');
        updateStravaStatus();
    };

    updateStravaStatus();
}

export function unmount() {}
