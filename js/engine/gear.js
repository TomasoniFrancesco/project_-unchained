/**
 * Virtual gear system — maintains gear state and computes resistance offset.
 * Direct port of unchained_project/ride/gear.py
 */

export class GearSystem {
    constructor(count = 21, neutral = 5, stepGrade = 0.5, debounceMs = 200, smoothing = 0.3) {
        this.gearMin = 0;
        this.gearMax = count - 1;
        this.gearNeutral = neutral;
        this.stepGrade = stepGrade;
        this.debounceMs = debounceMs;
        this.smoothingFactor = smoothing;

        this.currentGear = this.gearNeutral;
        this._lastShiftTime = 0;
        this._targetOffset = 0;
        this._smoothOffset = 0;
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
            this._targetOffset = (this.currentGear - this.gearNeutral) * this.stepGrade;
            this._lastShiftTime = now;
            console.log(`[GEAR] ${old} → ${this.currentGear} (UP) | offset: ${this._targetOffset.toFixed(1)}%`);
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
            this._targetOffset = (this.currentGear - this.gearNeutral) * this.stepGrade;
            this._lastShiftTime = now;
            console.log(`[GEAR] ${old} → ${this.currentGear} (DOWN) | offset: ${this._targetOffset.toFixed(1)}%`);
        }
    }

    getResistanceOffset() {
        this._smoothOffset += this.smoothingFactor * (this._targetOffset - this._smoothOffset);
        return this._smoothOffset;
    }

    getGear() { return this.currentGear; }
    getDisplayGear() { return this.currentGear - this.gearNeutral; }
    getTargetOffset() { return this._targetOffset; }

    reset(config = {}) {
        if (config.count) this.gearMax = config.count - 1;
        if (config.neutral) this.gearNeutral = config.neutral;
        if (config.step_grade) this.stepGrade = config.step_grade;
        this.currentGear = this.gearNeutral;
        this._lastShiftTime = 0;
        this._targetOffset = 0;
        this._smoothOffset = 0;
    }
}
