/**
 * Reactive application state — replaces SSE + Python state dict.
 * Uses EventTarget so any module can subscribe to changes.
 */

class AppState extends EventTarget {
    #data = {
        // Trainer
        trainer_status: 'disconnected',  // disconnected | connecting | connected
        trainer_name: '',
        trainer_address: '',
        scanning: false,
        scan_results: [],

        // Heart rate monitor
        heart_rate_status: 'disconnected',
        heart_rate_name: '',
        heart_rate: 0,

        // Controllers (2 slots)
        controller_1_status: 'disconnected',
        controller_1_name: '',
        controller_1_input_ready: false,
        controller_1_issue: '',
        controller_2_status: 'disconnected',
        controller_2_name: '',
        controller_2_input_ready: false,
        controller_2_issue: '',

        // Ride
        ride_active: false,
        ride_paused: false,
        finished: false,
        selected_route: null,
        selected_route_name: '',

        // Live metrics (from trainer)
        power: 0,
        cadence: 0,
        speed: 0,

        // Computed
        distance: 0,
        total_distance: 0,
        progress: 0,
        elapsed: 0,
        slope: 0,
        effective_slope: 0,
        elevation: 0,
        elevation_gain: 0,
        calories: 0,
        active_calories: 0,
        gear: 0,
        gear_offset: 0,
    };

    get(key) {
        return this.#data[key];
    }

    set(key, value) {
        const old = this.#data[key];
        if (old === value) return;
        this.#data[key] = value;
        this.dispatchEvent(new CustomEvent('change', {
            detail: { key, value, old }
        }));
    }

    /**
     * Batch update multiple keys at once (single event).
     */
    update(obj) {
        const changes = {};
        for (const [key, value] of Object.entries(obj)) {
            if (this.#data[key] !== value) {
                this.#data[key] = value;
                changes[key] = value;
            }
        }
        if (Object.keys(changes).length > 0) {
            this.dispatchEvent(new CustomEvent('batch', { detail: changes }));
        }
    }

    /**
     * Get a snapshot of all state.
     */
    snapshot() {
        return { ...this.#data };
    }
}

export const state = new AppState();
