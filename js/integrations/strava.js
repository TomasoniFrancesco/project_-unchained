/**
 * Strava integration — OAuth + activity upload.
 * Port of fuckzwift/integrations/strava.py for browser.
 *
 * Flow:
 * 1. User enters client_id + client_secret (stored in localStorage config)
 * 2. Redirect to Strava authorize URL
 * 3. Strava redirects back with ?code=...
 * 4. Exchange code for token via fetch
 * 5. Upload GPX via multipart fetch
 */

import { getStrava, updateStrava } from '../storage/config.js';

const TOKENS_KEY = 'fz_strava_tokens';
const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';
const ATHLETE_URL = 'https://www.strava.com/api/v3/athlete';

/**
 * Check if Strava is configured (has client_id and client_secret).
 */
export function isConfigured() {
    const s = getStrava();
    return !!(s.client_id && s.client_secret);
}

/**
 * Get current connection status.
 */
export function getStatus() {
    const s = getStrava();
    const tokens = loadTokens();
    return {
        configured: !!(s.client_id && s.client_secret),
        connected: !!(tokens && tokens.access_token),
        athlete_name: tokens?.athlete_name || null,
    };
}

/**
 * Start OAuth flow — redirects the browser.
 */
export function startOAuth() {
    const s = getStrava();
    if (!s.client_id) {
        console.error('[STRAVA] No client_id configured');
        return;
    }

    const callbackUrl = window.location.origin + '/strava-callback.html';
    const url = `${AUTH_URL}?client_id=${s.client_id}&response_type=code` +
                `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
                `&approval_prompt=auto&scope=activity:write,activity:read_all`;

    window.location.href = url;
}

/**
 * Handle OAuth callback — exchange code for token.
 * Call this from the callback page.
 */
export async function handleOAuthCallback(code) {
    const s = getStrava();
    const body = new URLSearchParams({
        client_id: s.client_id,
        client_secret: s.client_secret,
        code: code,
        grant_type: 'authorization_code',
    });

    const resp = await fetch(TOKEN_URL, {
        method: 'POST',
        body: body,
    });

    if (!resp.ok) {
        throw new Error(`Token exchange failed: ${resp.status}`);
    }

    const data = await resp.json();
    const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        athlete_name: data.athlete ? `${data.athlete.firstname} ${data.athlete.lastname}` : null,
    };

    saveTokens(tokens);
    console.log(`[STRAVA] Connected as ${tokens.athlete_name}`);
    return tokens;
}

/**
 * Refresh access token if expired.
 */
async function refreshIfNeeded() {
    const tokens = loadTokens();
    if (!tokens || !tokens.refresh_token) return null;

    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at && tokens.expires_at > now + 60) {
        return tokens; // Still valid
    }

    const s = getStrava();
    const body = new URLSearchParams({
        client_id: s.client_id,
        client_secret: s.client_secret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
    });

    try {
        const resp = await fetch(TOKEN_URL, { method: 'POST', body });
        if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);
        const data = await resp.json();

        tokens.access_token = data.access_token;
        tokens.refresh_token = data.refresh_token || tokens.refresh_token;
        tokens.expires_at = data.expires_at;
        saveTokens(tokens);
        console.log('[STRAVA] Token refreshed');
        return tokens;
    } catch (err) {
        console.error('[STRAVA] Token refresh failed:', err);
        return null;
    }
}

/**
 * Upload a GPX string to Strava.
 */
export async function uploadToStrava(gpxXml, activityName) {
    const tokens = await refreshIfNeeded();
    if (!tokens) {
        return { status: 'not_connected', message: 'Strava not connected.' };
    }

    const formData = new FormData();
    const blob = new Blob([gpxXml], { type: 'application/gpx+xml' });
    formData.append('file', blob, 'ride.gpx');
    formData.append('data_type', 'gpx');
    formData.append('name', activityName || 'FUCK ZWIFT Ride');
    formData.append('description', `Uploaded from FUCK ZWIFT on ${new Date().toISOString().slice(0, 10)}`);
    formData.append('activity_type', 'VirtualRide');

    const resp = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokens.access_token}` },
        body: formData,
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Upload failed (${resp.status}): ${text}`);
    }

    const data = await resp.json();
    console.log('[STRAVA] Upload response:', data);

    return {
        status: data.status || 'processing',
        message: data.status === 'Your activity is ready.' ? 'Uploaded successfully!' : 'Processing...',
        activity_id: data.activity_id,
    };
}

/**
 * Disconnect — clear tokens.
 */
export function disconnect() {
    localStorage.removeItem(TOKENS_KEY);
    console.log('[STRAVA] Disconnected');
}

// Token persistence
function loadTokens() {
    try {
        const raw = localStorage.getItem(TOKENS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveTokens(tokens) {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}
