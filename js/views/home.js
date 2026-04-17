/**
 * Home view — Dashboard with nav cards and typewriter effect.
 */
import { isProfileComplete } from '../storage/profile.js';
import { isWebBluetoothAvailable } from '../ble/manager.js';
import { ensureDefaultRoutes } from '../data/default-routes.js';
import { state } from '../state.js';
import { navigateTo } from '../router.js';

let stateListener = null;
let typewriterTimer = null;

export async function mount(container) {
    // Check first-time setup
    if (!isProfileComplete()) {
        window.location.href = 'setup.html';
        return;
    }

    await ensureDefaultRoutes();

    container.innerHTML = `
    <style>
        .hub { width:100%; max-width:520px; display:flex; flex-direction:column; gap:0.6rem; }
        .typewriter-word { color:#EAB308; font-weight:700; }
        .typewriter-cursor { color:#EAB308; font-weight:700; animation:cursorBlink 0.8s step-end infinite; }
        @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
    </style>
    <div class="page">
        <div class="brand-header">
            <h1 class="brand-title">UNCHAINED PROJECT</h1>
            <p class="brand-subtitle">
                <span>Your ride. Your </span><span id="typewriter-text" class="typewriter-word"></span><span id="typewriter-cursor" class="typewriter-cursor">_</span>
            </p>
        </div>

        <div class="section stagger-1" style="max-width:480px;">
            <div id="trainerStatus">
                <div class="status-pill disconnected">
                    <span class="status-dot"></span>
                    <span id="trainerStatusText">No trainer connected</span>
                </div>
            </div>
        </div>

        <div class="section stagger-2" style="max-width:480px;">
            <a class="card card-interactive" href="#connect" id="navConnect">
                <div class="nav-card">
                    <div class="nav-card-icon icon-blue">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>
                        </svg>
                    </div>
                    <div class="nav-card-body">
                        <div class="nav-card-title">Devices</div>
                        <div class="nav-card-desc">Connect your smart trainer via Bluetooth</div>
                    </div>
                    <span class="nav-card-chevron">›</span>
                </div>
            </a>
        </div>

        <div class="section stagger-3" style="max-width:480px;">
            <a class="card card-interactive" href="#routes" id="navRoutes">
                <div class="nav-card">
                    <div class="nav-card-icon icon-green">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>
                        </svg>
                    </div>
                    <div class="nav-card-body">
                        <div class="nav-card-title">Routes</div>
                        <div class="nav-card-desc">Choose a GPX route and start riding</div>
                    </div>
                    <span class="nav-card-chevron">›</span>
                </div>
            </a>
        </div>

        <div class="section stagger-4" style="max-width:480px;">
            <a class="card card-interactive" href="#history" id="navHistory">
                <div class="nav-card">
                    <div class="nav-card-icon icon-amber">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                    </div>
                    <div class="nav-card-body">
                        <div class="nav-card-title">History</div>
                        <div class="nav-card-desc">View past rides and performance</div>
                    </div>
                    <span class="nav-card-chevron">›</span>
                </div>
            </a>
        </div>

        <div class="section stagger-5" style="max-width:480px;">
            <a class="card card-interactive" href="#profile" id="navProfile">
                <div class="nav-card">
                    <div class="nav-card-icon icon-purple">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                    </div>
                    <div class="nav-card-body">
                        <div class="nav-card-title">Profile</div>
                        <div class="nav-card-desc">Cyclist profile & Strava settings</div>
                    </div>
                    <span class="nav-card-chevron">›</span>
                </div>
            </a>
        </div>

        ${!isWebBluetoothAvailable() ? `
        <div style="max-width:480px;width:100%;">
            <div class="intro-box" style="border-color:rgba(239,68,68,0.3);color:#EF4444;">
                ⚠️ <strong>Web Bluetooth non disponibile.</strong><br>
                <span style="color:var(--text-muted);font-size:0.72rem;">Usa Chrome o Edge su desktop/Android. Safari e iOS non sono supportati.</span>
            </div>
        </div>` : ''}
    </div>`;

    // Update trainer status
    function updateTrainerUI(status) {
        const pill = container.querySelector('#trainerStatus .status-pill');
        const text = container.querySelector('#trainerStatusText');
        if (!pill || !text) return;
        pill.className = 'status-pill ' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'checking' : 'disconnected');
        text.textContent = status === 'connected' ? `Connected: ${state.get('trainer_name')}` : status === 'connecting' ? 'Connecting...' : 'No trainer connected';
    }

    updateTrainerUI(state.get('trainer_status'));

    stateListener = (e) => {
        if (e.detail.key === 'trainer_status') updateTrainerUI(e.detail.value);
    };
    state.addEventListener('change', stateListener);

    // Typewriter
    const texts = ["rules.", "way.", "freedom.", "power."];
    const speed = 70, deleteSpeed = 40, waitTime = 1500;
    const el = container.querySelector('#typewriter-text');
    const cursor = container.querySelector('#typewriter-cursor');
    let textIndex = 0, charIndex = 0, isDeleting = false, displayText = '';

    function tick() {
        const currentText = texts[textIndex];
        if (isDeleting) {
            cursor.style.visibility = 'hidden'; cursor.style.animation = 'none';
            if (displayText.length > 0) {
                displayText = displayText.slice(0, -1); el.textContent = displayText;
                typewriterTimer = setTimeout(tick, deleteSpeed);
            } else {
                isDeleting = false; textIndex = (textIndex + 1) % texts.length; charIndex = 0;
                cursor.style.visibility = 'visible'; cursor.style.animation = '';
                typewriterTimer = setTimeout(tick, 300);
            }
        } else {
            cursor.style.visibility = 'hidden'; cursor.style.animation = 'none';
            if (charIndex < currentText.length) {
                displayText += currentText[charIndex]; el.textContent = displayText; charIndex++;
                typewriterTimer = setTimeout(tick, speed);
            } else {
                cursor.style.visibility = 'visible'; cursor.style.animation = '';
                typewriterTimer = setTimeout(() => { isDeleting = true; tick(); }, waitTime);
            }
        }
    }
    typewriterTimer = setTimeout(tick, 600);
}

export function unmount() {
    if (stateListener) { state.removeEventListener('change', stateListener); stateListener = null; }
    if (typewriterTimer) { clearTimeout(typewriterTimer); typewriterTimer = null; }
}
