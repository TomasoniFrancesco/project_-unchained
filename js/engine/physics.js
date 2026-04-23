/**
 * Cycling Physics Simulator — Zwift-like real-time resistance model.
 *
 * Computes rider speed from power output using a full force decomposition:
 *   F_gravity  = m * g * sin(θ)            — climbing/descending force
 *   F_rolling  = Crr * m * g * cos(θ)      — tire rolling resistance
 *   F_aero     = 0.5 * ρ * CdA * v²        — aerodynamic drag
 *
 * Speed is integrated via Newton's second law:
 *   F_net = P/v − (F_gravity + F_rolling + F_aero)
 *   a     = F_net / m_total
 *   v    += a * dt
 *
 * The trainer receives an "effective grade" that combines:
 *   - The route's raw slope
 *   - A configurable trainer difficulty scaling (0–1, like Zwift's slider)
 *   - The virtual gear system's slope multiplier
 *
 * This module is purely computational — it has no BLE or DOM dependencies.
 */

/**
 * Physical constants and sensible defaults.
 */
const DEFAULTS = {
    riderMass:         75,     // kg — rider body weight
    bikeMass:          9,      // kg — bicycle + kit
    crr:               0.005,  // coefficient of rolling resistance (clincher on asphalt)
    cda:               0.32,   // m² — drag area (hoods position)
    airDensity:        1.225,  // kg/m³ — sea-level ISA
    g:                 9.8067, // m/s² — gravitational acceleration
    trainerDifficulty: 0.50,   // 0–1 scaling of grade sent to trainer (Zwift default)
    slopeSmoothing:    0.25,   // EMA alpha for raw slope filtering
    maxSlopeRate:      2.0,    // max %/s slope change rate
    maxSpeedKmh:       120,    // hard cap km/h
    minSpeedMs:        0.5,    // floor m/s to avoid division-by-zero
};

export class CyclingSimulator {
    /**
     * @param {Object} params — overrides for DEFAULTS
     */
    constructor(params = {}) {
        const cfg = { ...DEFAULTS, ...params };

        // ── Mass model ──
        this.riderMass  = cfg.riderMass;
        this.bikeMass   = cfg.bikeMass;
        this.totalMass  = this.riderMass + this.bikeMass;

        // ── Resistance coefficients ──
        this.crr        = cfg.crr;
        this.cda        = cfg.cda;
        this.airDensity = cfg.airDensity;
        this.g          = cfg.g;

        // ── Trainer difficulty ──
        this.trainerDifficulty = Math.max(0, Math.min(1, cfg.trainerDifficulty));

        // ── Slope processing ──
        this.emaAlpha            = cfg.slopeSmoothing;
        this.maxSlopeChangePerSec = cfg.maxSlopeRate;

        // ── Speed limits ──
        this.maxSpeedMs = cfg.maxSpeedKmh / 3.6;
        this.minSpeedMs = cfg.minSpeedMs;

        // ── Internal state ──
        this._smoothedSlope = 0;   // after EMA
        this._outputSlope   = 0;   // after rate-limit (% grade)
        this._speedMs       = 0;   // current simulated speed (m/s)
        this._lastForces    = { gravity: 0, rolling: 0, aero: 0, drive: 0, net: 0 };
    }

    // ──────────────────────────────────────────────────────────────────
    //  PUBLIC API
    // ──────────────────────────────────────────────────────────────────

    /**
     * Reset all dynamic state. Call when starting a new ride.
     */
    reset() {
        this._smoothedSlope = 0;
        this._outputSlope   = 0;
        this._speedMs       = 0;
        this._lastForces    = { gravity: 0, rolling: 0, aero: 0, drive: 0, net: 0 };
    }

    /**
     * Process a raw slope reading (in %) and return the smoothed,
     * rate-limited slope value.
     *
     * @param {number} rawSlopePct — raw gradient from route data (%)
     * @param {number} dt — time step (seconds)
     * @returns {number} — smoothed slope (%)
     */
    updateSlope(rawSlopePct, dt) {
        if (dt <= 0) return this._outputSlope;

        // 1. Exponential moving average
        this._smoothedSlope += this.emaAlpha * (rawSlopePct - this._smoothedSlope);

        // 2. Rate limiter — prevents sudden jumps
        const maxDelta = this.maxSlopeChangePerSec * dt;
        let delta = this._smoothedSlope - this._outputSlope;
        if (Math.abs(delta) > maxDelta) {
            delta = delta > 0 ? maxDelta : -maxDelta;
        }
        this._outputSlope += delta;

        return this._outputSlope;
    }

    /**
     * Compute the effective grade to send to the trainer.
     * Applies trainer difficulty scaling and gear multiplier.
     *
     * @param {number} gearScale — multiplier from the GearSystem (typically 0.15–3.0)
     * @returns {number} — grade in % to send via FTMS, clamped ±40%
     */
    computeTrainerGrade(gearScale = 1.0) {
        const scaledSlope = this._outputSlope * this.trainerDifficulty * gearScale;
        return Math.max(-40, Math.min(40, Math.round(scaledSlope * 100) / 100));
    }

    /**
     * Compute rider speed from power using full Newtonian force model.
     *
     * The simulation uses the TRUE route slope for speed calculation
     * (not the trainer-difficulty-scaled grade). This means the rider's
     * virtual speed always reflects real-world physics, while the trainer
     * feel is independently controlled via trainerDifficulty.
     *
     * @param {number} powerW — instantaneous rider power (watts)
     * @param {number} dt — time step (seconds)
     * @returns {number} — new speed in m/s
     */
    computeSpeed(powerW, dt) {
        if (dt <= 0) return this._speedMs;

        const v = Math.max(this._speedMs, this.minSpeedMs);
        const slopeFraction = this._outputSlope / 100;
        const theta = Math.atan(slopeFraction);
        const m = this.totalMass;

        // ── Force decomposition ──

        // Gravity: positive = resisting (climbing), negative = assisting (descending)
        const fGravity = m * this.g * Math.sin(theta);

        // Rolling resistance: always resists motion
        const fRolling = this.crr * m * this.g * Math.cos(theta);

        // Aerodynamic drag: always resists motion (proportional to v²)
        const fAero = 0.5 * this.airDensity * this.cda * v * v;

        // Driving force from rider power
        const fDrive = powerW / v;

        // Net force
        const fNet = fDrive - fGravity - fRolling - fAero;

        // ── Integration ──
        const accel = fNet / m;

        // Semi-implicit Euler integration with clamping
        let newSpeed = this._speedMs + accel * dt;

        // Floor: prevent going backwards or stalling completely
        // On steep climbs with low power, speed drops to minimum crawl
        newSpeed = Math.max(this.minSpeedMs * 0.1, newSpeed);

        // Ceiling: hard speed cap for safety
        newSpeed = Math.min(this.maxSpeedMs, newSpeed);

        // On very steep downhills with zero power, cap descent speed
        if (powerW <= 0 && this._outputSlope < -2) {
            const descentCap = 25; // m/s ≈ 90 km/h freewheeling cap
            newSpeed = Math.min(newSpeed, descentCap);
        }

        this._speedMs = newSpeed;

        // Store force breakdown for telemetry / debugging
        this._lastForces = {
            gravity: Math.round(fGravity * 100) / 100,
            rolling: Math.round(fRolling * 100) / 100,
            aero:    Math.round(fAero * 100) / 100,
            drive:   Math.round(fDrive * 100) / 100,
            net:     Math.round(fNet * 100) / 100,
        };

        return this._speedMs;
    }

    // ──────────────────────────────────────────────────────────────────
    //  ACCESSORS
    // ──────────────────────────────────────────────────────────────────

    /** Current smoothed slope in percent. */
    get currentSlope() { return this._outputSlope; }

    /** Current simulated speed in km/h. */
    get speedKmh() { return this._speedMs * 3.6; }

    /** Current simulated speed in m/s. */
    get speedMs() { return this._speedMs; }

    /** Last computed force breakdown (for debug HUD). */
    get forces() { return { ...this._lastForces }; }

    /** Total system mass (rider + bike) in kg. */
    get mass() { return this.totalMass; }

    /**
     * Update rider mass on the fly (e.g. if profile changes mid-session).
     * @param {number} riderKg
     */
    setRiderMass(riderKg) {
        this.riderMass = riderKg;
        this.totalMass = this.riderMass + this.bikeMass;
    }

    /**
     * Update trainer difficulty on the fly.
     * @param {number} difficulty — 0.0 (flat feel) to 1.0 (full grade)
     */
    setTrainerDifficulty(difficulty) {
        this.trainerDifficulty = Math.max(0, Math.min(1, difficulty));
    }
}
