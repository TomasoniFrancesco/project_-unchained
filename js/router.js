/**
 * Simple hash-based SPA router.
 * Routes are defined as { hash: () => import('module') } pairs.
 * Each view module must export: mount(container) and unmount()
 */

let currentView = null;
let currentHash = null;
let appContainer = null;
let navElement = null;

const ROUTES = {
    'home':    () => import('./views/home.js'),
    'connect': () => import('./views/connect.js'),
    'routes':  () => import('./views/routes.js'),
    'ride':    () => import('./views/ride.js'),
    'history': () => import('./views/history.js'),
    'profile': () => import('./views/profile.js'),
};

function getHash() {
    const h = location.hash.replace('#', '') || 'home';
    return ROUTES[h] ? h : 'home';
}

async function navigate(hash) {
    if (hash === currentHash && currentView) return;

    // Unmount current view
    if (currentView && currentView.unmount) {
        try { currentView.unmount(); } catch (e) { console.warn('[Router] unmount error:', e); }
    }

    currentHash = hash;

    // Clear container
    appContainer.innerHTML = '<div class="page" style="padding-top:4rem;text-align:center;color:var(--text-muted);">Loading…</div>';

    // Special handling for ride view
    const isRide = hash === 'ride';
    document.body.classList.toggle('ride-active', isRide);
    document.body.classList.toggle('with-mountains', !isRide);
    if (navElement) navElement.style.display = isRide ? 'none' : '';

    try {
        const module = await ROUTES[hash]();
        // Only mount if we haven't navigated away during the import
        if (currentHash !== hash) return;
        currentView = module;
        appContainer.innerHTML = '';
        await module.mount(appContainer);
    } catch (err) {
        console.error(`[Router] Failed to load view "${hash}":`, err);
        appContainer.innerHTML = `<div class="page"><div class="brand-header"><h1 class="brand-title">FUCK ZWIFT</h1></div><div class="empty-state"><div class="empty-state-icon">⚠️</div>Failed to load page: ${err.message}</div></div>`;
    }

    // Update nav highlights
    updateNavHighlight(hash);
}

function updateNavHighlight(hash) {
    if (!navElement) return;
    navElement.querySelectorAll('.bottom-nav-item').forEach(a => {
        const href = a.getAttribute('href') || '';
        const navHash = href.replace('#', '');
        a.classList.toggle('active', navHash === hash);
    });
}

/**
 * Navigate programmatically (use from views).
 */
export function navigateTo(hash) {
    location.hash = hash;
}

/**
 * Initialize the router. Call once from app.html.
 */
export function init(container, nav) {
    appContainer = container;
    navElement = nav;

    window.addEventListener('hashchange', () => navigate(getHash()));

    // Initial navigation
    navigate(getHash());
}
