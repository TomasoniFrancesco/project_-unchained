"""Virtual gear system — scales trainer gradient feel instead of adding a tiny fixed offset."""

from __future__ import annotations

import time


class GearSystem:
    """Virtual gear system with smooth resistance transitions."""

    def __init__(
        self,
        count=21,
        neutral=5,
        step_grade=0.5,
        debounce_ms=200,
        smoothing=0.3,
        min_difficulty_scale=0.15,
        downhill_scale=0.5,
    ):
        self.gear_min = 0
        self.gear_max = count - 1
        self.gear_neutral = max(self.gear_min, min(neutral, self.gear_max))
        self.step_grade = step_grade
        self.debounce_ms = debounce_ms
        self.smoothing_factor = smoothing
        self.min_difficulty_scale = max(0.0, min(float(min_difficulty_scale), 1.0))
        self.max_difficulty_scale = max(1.0, 1.0 + max(0.0, float(step_grade)))
        self.downhill_scale = max(0.0, min(float(downhill_scale), 1.0))

        self.current_gear = self.gear_min
        self._last_shift_time = 0.0
        self._target_scale = self._compute_scale_for_gear(self.current_gear)
        self._smooth_scale = self._target_scale

    def _compute_scale_for_gear(self, gear):
        if gear <= self.gear_neutral:
            lower_span = max(1, self.gear_neutral - self.gear_min)
            ratio = (gear - self.gear_min) / lower_span
            return self.min_difficulty_scale + ((1.0 - self.min_difficulty_scale) * ratio)

        upper_span = max(1, self.gear_max - self.gear_neutral)
        ratio = (gear - self.gear_neutral) / upper_span
        return 1.0 + ((self.max_difficulty_scale - 1.0) * ratio)

    def _update_smooth_scale(self):
        self._smooth_scale += self.smoothing_factor * (self._target_scale - self._smooth_scale)
        return self._smooth_scale

    def _transform_slope(self, base_slope, scale):
        slope_for_trainer = base_slope * self.downhill_scale if base_slope < 0 else base_slope
        return slope_for_trainer * scale

    def shift_up(self):
        """Shift to a harder gear (more resistance)."""
        now = time.time()
        if (now - self._last_shift_time) < (self.debounce_ms / 1000.0):
            print(f"  [GEAR] Shift UP blocked (debounce {self.debounce_ms}ms)")
            return
        if self.current_gear < self.gear_max:
            old = self.current_gear
            self.current_gear += 1
            self._target_scale = self._compute_scale_for_gear(self.current_gear)
            self._last_shift_time = now
            print(f"  [GEAR] {old} → {self.current_gear} (UP) | trainer scale: {self._target_scale:.2f}x")
        else:
            print(f"  [GEAR] Already at max gear ({self.gear_max})")

    def shift_down(self):
        """Shift to an easier gear (less resistance)."""
        now = time.time()
        if (now - self._last_shift_time) < (self.debounce_ms / 1000.0):
            print(f"  [GEAR] Shift DOWN blocked (debounce {self.debounce_ms}ms)")
            return
        if self.current_gear > self.gear_min:
            old = self.current_gear
            self.current_gear -= 1
            self._target_scale = self._compute_scale_for_gear(self.current_gear)
            self._last_shift_time = now
            print(f"  [GEAR] {old} → {self.current_gear} (DOWN) | trainer scale: {self._target_scale:.2f}x")
        else:
            print(f"  [GEAR] Already at min gear ({self.gear_min})")

    def get_resistance_offset(self, base_slope=0.0):
        """Return the difference between route slope and trainer slope for the current gear."""
        current_scale = self._update_smooth_scale()
        return self._transform_slope(base_slope, current_scale) - base_slope

    def get_gear(self):
        return self.current_gear

    def get_display_gear(self):
        return self.current_gear

    def get_target_offset(self, base_slope=0.0):
        return self._transform_slope(base_slope, self._target_scale) - base_slope
