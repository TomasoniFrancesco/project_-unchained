/**
 * Virtual Drivetrain — realistic gear system for indoor cycling.
 *
 * Models a real cassette with chainring and rear cogs.
 * Each gear has a physical ratio (front teeth / rear teeth) that
 * determines how much resistance offset is sent to the trainer.
 *
 * On a real bike, harder gears at the same cadence produce higher
 * wheel speed and therefore more aerodynamic drag. On a smart trainer
 * in SIM mode, we simulate this by adding a grade offset:
 *
 *   effectiveGrade = routeSlope × trainerDifficulty + gearGradeOffset
 *
 * This ensures gear changes affect resistance on flats, climbs, and descents.
 *
 * Power = Torque × AngularVelocity — at constant power:
 *   - Harder gear → more torque, lower cadence
 *   - Easier gear → less torque, higher cadence
 *   - The trainer resistance reflects this via the grade offset
 */

// ── Default cassette: 50T front × 11-speed rear ─────────────────
// Ordered easiest (largest cog) to hardest (smallest cog).
const DEFAULT_REAR_COGS = [32, 28, 25, 22, 20, 18, 16, 14, 13, 12, 11];
const DEFAULT_CHAINRING = 50;
const DEFAULT_WHEEL_CIRC = 2.105; // meters — 700c × 25mm tire

// How much grade offset (%) per unit of ratio difference from neutral.
// Calibrated so that full cassette range ≈ ±3% grade offset, which is
// clearly noticeable on any smart trainer.
const DEFAULT_OFFSET_SCALE = 2.0;

export class GearSystem {
    /**
     * @param {Object} [config]
     * @param {number[]} [config.rearCogs] — tooth counts, easiest→hardest
     * @param {number}   [config.chainring] — front chainring teeth
     * @param {number}   [config.neutralGear] — index of neutral gear (null = middle)
     * @param {number}   [config.offsetScale] — grade offset per ratio unit
     * @param {number}   [config.wheelCircumference] — wheel circ in meters
     * @param {number}   [config.debounceMs] — minimum ms between shifts
     * @param {number}   [config.smoothing] — EMA alpha for smooth transitions (0–1)
     */
    constructor(config = {}) {
        this.rearCogs     = config.rearCogs || [...DEFAULT_REAR_COGS];
        this.chainring    = config.chainring || DEFAULT_CHAINRING;
        this.wheelCirc    = config.wheelCircumference || DEFAULT_WHEEL_CIRC;
        this.offsetScale  = config.offsetScale ?? DEFAULT_OFFSET_SCALE;
        this.debounceMs   = config.debounceMs ?? 200;
        this.smoothing    = config.smoothing ?? 0.3;

        this.gearCount    = this.rearCogs.length;
        this.gearMin      = 0;
        this.gearMax      = this.gearCount - 1;

        // Neutral gear — defaults to middle of cassette
        const defaultNeutral = Math.floor(this.gearCount / 2);
        this.neutralGear  = config.neutralGear ?? defaultNeutral;
        this.neutralGear  = Math.max(this.gearMin, Math.min(this.neutralGear, this.gearMax));

        // Precompute ratios
        this._ratios = this.rearCogs.map(cog => this.chainring / cog);
        this._neutralRatio = this._ratios[this.neutralGear];

        // State
        this.currentGear     = this.neutralGear; // Start at neutral (not min!)
        this._lastShiftTime  = 0;
        this._targetOffset   = 0;  // target grade offset (%)
        this._smoothOffset   = 0;  // smoothed grade offset (%)
    }

    // ──────────────────────────────────────────────────────────────
    //  SHIFTING
    // ──────────────────────────────────────────────────────────────

    /**
     * Shift to a harder gear (higher ratio, smaller rear cog).
     */
    shiftUp() {
        const now = performance.now();
        if ((now - this._lastShiftTime) < this.debounceMs) return;
        if (this.currentGear >= this.gearMax) return;

        const old = this.currentGear;
        this.currentGear += 1;
        this._targetOffset = this._computeOffset(this.currentGear);
        this._lastShiftTime = now;
        console.log(`[GEAR] ${old}→${this.currentGear} (HARDER) | ratio: ${this.getRatio().toFixed(2)} | offset: ${this._targetOffset.toFixed(1)}%`);
    }

    /**
     * Shift to an easier gear (lower ratio, larger rear cog).
     */
    shiftDown() {
        const now = performance.now();
        if ((now - this._lastShiftTime) < this.debounceMs) return;
        if (this.currentGear <= this.gearMin) return;

        const old = this.currentGear;
        this.currentGear -= 1;
        this._targetOffset = this._computeOffset(this.currentGear);
        this._lastShiftTime = now;
        console.log(`[GEAR] ${old}→${this.currentGear} (EASIER) | ratio: ${this.getRatio().toFixed(2)} | offset: ${this._targetOffset.toFixed(1)}%`);
    }

    // ──────────────────────────────────────────────────────────────
    //  GRADE OFFSET COMPUTATION
    // ──────────────────────────────────────────────────────────────

    /**
     * Compute the grade offset for a given gear index.
     * Offset is 0% at neutral gear, negative for easier, positive for harder.
     */
    _computeOffset(gearIndex) {
        const ratio = this._ratios[gearIndex];
        return (ratio - this._neutralRatio) * this.offsetScale;
    }

    /**
     * Must be called each tick to smooth the transition.
     * @param {number} dt — time step in seconds
     */
    update(dt) {
        if (dt <= 0) return;
        // EMA smoothing toward target offset
        this._smoothOffset += this.smoothing * (this._targetOffset - this._smoothOffset);
        // Snap when close enough
        if (Math.abs(this._targetOffset - this._smoothOffset) < 0.01) {
            this._smoothOffset = this._targetOffset;
        }
    }

    // ──────────────────────────────────────────────────────────────
    //  ACCESSORS
    // ──────────────────────────────────────────────────────────────

    /**
     * Get the current smoothed grade offset (%) to add to trainer grade.
     * Positive = harder, negative = easier.
     */
    getGradeOffset() {
        return Math.round(this._smoothOffset * 100) / 100;
    }

    /** Current gear ratio (chainring / rear cog). */
    getRatio() {
        return this._ratios[this.currentGear];
    }

    /** Current gear index (0 = easiest). */
    getGear() { return this.currentGear; }

    /** Display gear number (1-indexed for UI). */
    getDisplayGear() { return this.currentGear + 1; }

    /** Total number of gears. */
    getGearCount() { return this.gearCount; }

    /** Current rear cog tooth count. */
    getRearCog() { return this.rearCogs[this.currentGear]; }

    /** Front chainring tooth count. */
    getChainring() { return this.chainring; }

    /**
     * Compute virtual wheel speed from cadence and gear ratio.
     * @param {number} cadenceRPM
     * @returns {number} speed in m/s
     */
    computeWheelSpeed(cadenceRPM) {
        if (cadenceRPM <= 0) return 0;
        return (cadenceRPM / 60) * this.getRatio() * this.wheelCirc;
    }

    /**
     * Reset to neutral gear.
     */
    reset() {
        this.currentGear = this.neutralGear;
        this._lastShiftTime = 0;
        this._targetOffset = 0;
        this._smoothOffset = 0;
    }
}
