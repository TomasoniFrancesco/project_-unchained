/**
 * Virtual gear system — scales trainer gradient feel instead of adding a tiny fixed offset.
 * Direct port of unchained_project/ride/gear.py
 */

export class GearSystem {
    constructor(
        count = 21,
        neutral = 5,
        stepGrade = 0.5,
        debounceMs = 200,
        smoothing = 0.3,
        minDifficultyScale = 0.15,
        downhillScale = 0.5,
    ) {
        this.gearMin = 0;
        this.gearMax = count - 1;
        this.gearNeutral = Math.max(this.gearMin, Math.min(neutral, this.gearMax));
        this.stepGrade = stepGrade;
        this.debounceMs = debounceMs;
        this.smoothingFactor = smoothing;
        this.minDifficultyScale = Math.max(0, Math.min(minDifficultyScale, 1));
        this.maxDifficultyScale = Math.max(1, 1 + Math.max(0, stepGrade));
        this.downhillScale = Math.max(0, Math.min(downhillScale, 1));

        this.currentGear = this.gearMin;
        this._lastShiftTime = 0;
        this._targetScale = this._computeScaleForGear(this.currentGear);
        this._smoothScale = this._targetScale;
    }

    _computeScaleForGear(gear) {
        if (gear <= this.gearNeutral) {
            const lowerSpan = Math.max(1, this.gearNeutral - this.gearMin);
            const ratio = (gear - this.gearMin) / lowerSpan;
            return this.minDifficultyScale + ((1 - this.minDifficultyScale) * ratio);
        }

        const upperSpan = Math.max(1, this.gearMax - this.gearNeutral);
        const ratio = (gear - this.gearNeutral) / upperSpan;
        return 1 + ((this.maxDifficultyScale - 1) * ratio);
    }

    _updateSmoothScale() {
        this._smoothScale += this.smoothingFactor * (this._targetScale - this._smoothScale);
        return this._smoothScale;
    }

    _transformSlope(baseSlope, scale) {
        const slopeForTrainer = baseSlope < 0 ? baseSlope * this.downhillScale : baseSlope;
        return slopeForTrainer * scale;
    }

    shiftUp() {
        const now = performance.now();
        if ((now - this._lastShiftTime) < this.debounceMs) {
            console.log(`[GEAR] Shift UP blocked (debounce ${this.debounceMs}ms)`);
            return;
        }
        if (this.currentGear < this.gearMax) {
            const old = this.currentGear;
            this.currentGear += 1;
            this._targetScale = this._computeScaleForGear(this.currentGear);
            this._lastShiftTime = now;
            console.log(`[GEAR] ${old} → ${this.currentGear} (UP) | trainer scale: ${this._targetScale.toFixed(2)}x`);
        }
    }

    shiftDown() {
        const now = performance.now();
        if ((now - this._lastShiftTime) < this.debounceMs) {
            console.log(`[GEAR] Shift DOWN blocked (debounce ${this.debounceMs}ms)`);
            return;
        }
        if (this.currentGear > this.gearMin) {
            const old = this.currentGear;
            this.currentGear -= 1;
            this._targetScale = this._computeScaleForGear(this.currentGear);
            this._lastShiftTime = now;
            console.log(`[GEAR] ${old} → ${this.currentGear} (DOWN) | trainer scale: ${this._targetScale.toFixed(2)}x`);
        }
    }

    getResistanceOffset(baseSlope = 0) {
        const currentScale = this._updateSmoothScale();
        return this._transformSlope(baseSlope, currentScale) - baseSlope;
    }

    getGear() { return this.currentGear; }
    getDisplayGear() { return this.currentGear; }
    getTargetOffset(baseSlope = 0) {
        return this._transformSlope(baseSlope, this._targetScale) - baseSlope;
    }
    getCurrentScale() { return this._smoothScale; }

    reset(config = {}) {
        if (config.count !== undefined) this.gearMax = config.count - 1;
        if (config.neutral !== undefined) this.gearNeutral = Math.max(this.gearMin, Math.min(config.neutral, this.gearMax));
        if (config.step_grade !== undefined) this.stepGrade = config.step_grade;
        if (config.min_difficulty_scale !== undefined) {
            this.minDifficultyScale = Math.max(0, Math.min(config.min_difficulty_scale, 1));
        }
        if (config.downhill_scale !== undefined) {
            this.downhillScale = Math.max(0, Math.min(config.downhill_scale, 1));
        }
        this.maxDifficultyScale = Math.max(1, 1 + Math.max(0, this.stepGrade));
        this.currentGear = this.gearMin;
        this._lastShiftTime = 0;
        this._targetScale = this._computeScaleForGear(this.currentGear);
        this._smoothScale = this._targetScale;
    }
}
