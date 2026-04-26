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

const DEFAULT_ROLLER_MIN_GRADE = 1;
const DEFAULT_ROLLER_MAX_GRADE = 22;
const DEFAULT_VIRTUAL_GEAR_COUNT = 22;

export class GearSystem {
    /**
     * @param {Object} [config]
     * @param {number[]} [config.rearCogs] — tooth counts, easiest→hardest
     * @param {number}   [config.chainring] — front chainring teeth
     * @param {number}   [config.neutralGear] — index of neutral gear (null = middle)
     * @param {number}   [config.virtualGearCount] — number of virtual gears
     * @param {number}   [config.rollerMinGrade] — lowest gear grade offset (%)
     * @param {number}   [config.rollerMaxGrade] — highest gear grade offset (%)
     * @param {number}   [config.wheelCircumference] — wheel circ in meters
     * @param {number}   [config.debounceMs] — minimum ms between shifts
     * @param {number}   [config.smoothing] — EMA alpha for smooth transitions (0–1)
     */
    constructor(config = {}) {
        this.rearCogs     = config.rearCogs || [...DEFAULT_REAR_COGS];
        this.chainring    = config.chainring || DEFAULT_CHAINRING;
        this.wheelCirc    = config.wheelCircumference || DEFAULT_WHEEL_CIRC;
        this.debounceMs   = config.debounceMs ?? 200;
        this.smoothing    = config.smoothing ?? 0.3;
        this.rollerMinGrade = normalizeGrade(config.rollerMinGrade, DEFAULT_ROLLER_MIN_GRADE);
        this.rollerMaxGrade = normalizeGrade(config.rollerMaxGrade, DEFAULT_ROLLER_MAX_GRADE);
        if (this.rollerMinGrade > this.rollerMaxGrade) {
            [this.rollerMinGrade, this.rollerMaxGrade] = [this.rollerMaxGrade, this.rollerMinGrade];
        }

        this.gearCount    = normalizeGearCount(config.virtualGearCount, DEFAULT_VIRTUAL_GEAR_COUNT);
        this.gearMin      = 0;
        this.gearMax      = this.gearCount - 1;

        // Neutral gear — defaults to middle of cassette
        const defaultNeutral = Math.floor(this.gearCount / 2);
        this.neutralGear  = config.neutralGear ?? defaultNeutral;
        this.neutralGear  = Math.max(this.gearMin, Math.min(this.neutralGear, this.gearMax));

        // Precompute virtual ratios across the physical cassette range. Gear 0
        // maps to rollerMinGrade; the final gear maps to rollerMaxGrade.
        const easiestRatio = this.chainring / this.rearCogs[0];
        const hardestRatio = this.chainring / this.rearCogs[this.rearCogs.length - 1];
        this._ratios = Array.from({ length: this.gearCount }, (_, index) => {
            if (this.gearMax <= this.gearMin) return easiestRatio;
            const t = index / this.gearMax;
            return easiestRatio + ((hardestRatio - easiestRatio) * t);
        });

        // State
        this.currentGear     = this.gearMin;
        this._lastShiftTime  = 0;
        this._targetOffset   = this._computeOffset(this.currentGear);
        this._smoothOffset   = this._targetOffset;
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
        console.log(`[GEAR] ${old}→${this.currentGear} (HARDER) | ratio: ${this.getRatio().toFixed(2)} | roller: ${this._targetOffset.toFixed(1)}`);
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
        console.log(`[GEAR] ${old}→${this.currentGear} (EASIER) | ratio: ${this.getRatio().toFixed(2)} | roller: ${this._targetOffset.toFixed(1)}`);
    }

    // ──────────────────────────────────────────────────────────────
    //  GRADE OFFSET COMPUTATION
    // ──────────────────────────────────────────────────────────────

    /**
     * Compute the grade offset for a given gear index.
     * Offset is linearly mapped across the configured roller range.
     */
    _computeOffset(gearIndex) {
        if (this.gearMax <= this.gearMin) return this.rollerMinGrade;
        const t = (gearIndex - this.gearMin) / (this.gearMax - this.gearMin);
        return this.rollerMinGrade + ((this.rollerMaxGrade - this.rollerMinGrade) * t);
    }

    configure(config = {}) {
        const previousMax = Math.max(this.gearMax, 1);
        const currentPosition = this.currentGear / previousMax;

        if (config.virtualGearCount !== undefined) {
            this.gearCount = normalizeGearCount(config.virtualGearCount, this.gearCount);
            this.gearMax = this.gearCount - 1;
            this.neutralGear = Math.max(this.gearMin, Math.min(Math.floor(this.gearCount / 2), this.gearMax));

            const easiestRatio = this.chainring / this.rearCogs[0];
            const hardestRatio = this.chainring / this.rearCogs[this.rearCogs.length - 1];
            this._ratios = Array.from({ length: this.gearCount }, (_, index) => {
                if (this.gearMax <= this.gearMin) return easiestRatio;
                const t = index / this.gearMax;
                return easiestRatio + ((hardestRatio - easiestRatio) * t);
            });
            this.currentGear = Math.max(this.gearMin, Math.min(Math.round(currentPosition * this.gearMax), this.gearMax));
        }

        if (config.rollerMinGrade !== undefined) this.rollerMinGrade = normalizeGrade(config.rollerMinGrade, this.rollerMinGrade);
        if (config.rollerMaxGrade !== undefined) this.rollerMaxGrade = normalizeGrade(config.rollerMaxGrade, this.rollerMaxGrade);
        if (this.rollerMinGrade > this.rollerMaxGrade) {
            [this.rollerMinGrade, this.rollerMaxGrade] = [this.rollerMaxGrade, this.rollerMinGrade];
        }

        this._targetOffset = this._computeOffset(this.currentGear);
        this._smoothOffset = this._targetOffset;
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

    /** Current equivalent rear cog tooth count. */
    getRearCog() { return Math.round(this.chainring / this.getRatio()); }

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
        this.currentGear = this.gearMin;
        this._lastShiftTime = 0;
        this._targetOffset = this._computeOffset(this.currentGear);
        this._smoothOffset = this._targetOffset;
    }
}

function normalizeGrade(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(40, parsed));
}

function normalizeGearCount(value, fallback) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(2, Math.min(40, parsed));
}
