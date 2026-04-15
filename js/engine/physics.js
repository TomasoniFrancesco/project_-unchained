/**
 * Physics engine — slope smoothing, rate-limiting, and force model.
 * Direct port of fuckzwift/ride/physics.py
 */

export class PhysicsEngine {
    constructor(riderMass = 80, crr = 0.005, cda = 0.4, slopeSmoothing = 0.25, maxSlopeRate = 2.0) {
        this.riderMass = riderMass;
        this.crr = crr;
        this.cda = cda;
        this.emaAlpha = slopeSmoothing;
        this.maxSlopeChangePerSec = maxSlopeRate;
        this.airDensity = 1.225;
        this.g = 9.81;

        this._smoothedSlope = 0;
        this._outputSlope = 0;
        this._speedMs = 0;
    }

    reset() {
        this._smoothedSlope = 0;
        this._outputSlope = 0;
        this._speedMs = 0;
    }

    /**
     * Process a raw slope reading and return the smoothed, rate-limited slope.
     */
    update(rawSlopePct, dt) {
        if (dt <= 0) return this._outputSlope;

        this._smoothedSlope += this.emaAlpha * (rawSlopePct - this._smoothedSlope);

        const maxDelta = this.maxSlopeChangePerSec * dt;
        let delta = this._smoothedSlope - this._outputSlope;
        if (Math.abs(delta) > maxDelta) {
            delta = delta > 0 ? maxDelta : -maxDelta;
        }
        this._outputSlope += delta;

        return this._outputSlope;
    }

    /**
     * Compute inertia-based speed from current power and slope.
     */
    computeSpeed(powerW, dt) {
        if (dt <= 0) return this._speedMs;

        const v = Math.max(this._speedMs, 0.5);
        const slopeRad = Math.atan(this._outputSlope / 100);
        const fGravity = this.riderMass * this.g * Math.sin(slopeRad);
        const fRolling = this.crr * this.riderMass * this.g * Math.cos(slopeRad);
        const fDrag = 0.5 * this.cda * this.airDensity * v * v;
        const fDrive = v > 0.5 ? powerW / v : powerW / 0.5;

        const fNet = fDrive - fGravity - fRolling - fDrag;
        const accel = fNet / this.riderMass;

        this._speedMs = Math.max(0, Math.min(this._speedMs + accel * dt, 30));
        return this._speedMs;
    }

    get currentSlope() { return this._outputSlope; }
    get speedKmh() { return this._speedMs * 3.6; }
}
