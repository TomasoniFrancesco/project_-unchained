"""Virtual gear system — scales trainer gradient feel instead of adding a tiny fixed offset."""

from __future__ import annotations

import time


class GearSystem:
    """Virtual gear system with smooth resistance transitions."""

    def __init__(
        self,
        count=22,
        neutral=11,
        step_grade=0.5,
        max_difficulty_scale=None,
        debounce_ms=200,
        smoothing=0.3,
        min_difficulty_scale=0.15,
        downhill_scale=0.5,
        roller_min_grade=1.0,
        roller_max_grade=22.0,
    ):
        self.gear_min = 0
        self.gear_count = max(2, min(40, int(count)))
        self.gear_max = self.gear_count - 1
        self.gear_neutral = max(self.gear_min, min(neutral, self.gear_max))
        self.step_grade = step_grade
        self.debounce_ms = debounce_ms
        self.smoothing_factor = smoothing
        self.min_difficulty_scale = max(0.0, min(float(min_difficulty_scale), 1.0))
        if max_difficulty_scale is None:
            self.max_difficulty_scale = max(1.0, 1.0 + max(0.0, float(step_grade)))
        else:
            self.max_difficulty_scale = max(1.0, float(max_difficulty_scale))
        self.downhill_scale = max(0.0, min(float(downhill_scale), 1.0))
        self.roller_min_grade = max(1.0, min(40.0, float(roller_min_grade)))
        self.roller_max_grade = max(1.0, min(40.0, float(roller_max_grade)))
        if self.roller_min_grade > self.roller_max_grade:
            self.roller_min_grade, self.roller_max_grade = self.roller_max_grade, self.roller_min_grade

        self.current_gear = self.gear_min
        self._last_shift_time = 0.0
        self._target_offset = self._compute_offset_for_gear(self.current_gear)
        self._smooth_offset = self._target_offset

    def _compute_scale_for_gear(self, gear):
        if gear <= self.gear_neutral:
            lower_span = max(1, self.gear_neutral - self.gear_min)
            ratio = (gear - self.gear_min) / lower_span
            return self.min_difficulty_scale + ((1.0 - self.min_difficulty_scale) * ratio)

        upper_span = max(1, self.gear_max - self.gear_neutral)
        ratio = (gear - self.gear_neutral) / upper_span
        return 1.0 + ((self.max_difficulty_scale - 1.0) * ratio)

    def _compute_offset_for_gear(self, gear):
        if self.gear_max <= self.gear_min:
            return self.roller_min_grade
        ratio = (gear - self.gear_min) / (self.gear_max - self.gear_min)
        return self.roller_min_grade + ((self.roller_max_grade - self.roller_min_grade) * ratio)

    def _update_smooth_offset(self):
        self._smooth_offset += self.smoothing_factor * (self._target_offset - self._smooth_offset)
        if abs(self._target_offset - self._smooth_offset) < 0.01:
            self._smooth_offset = self._target_offset
        return self._smooth_offset

    def shift_up(self):
        """Shift to a harder gear (more resistance)."""
        now = time.time()
        if (now - self._last_shift_time) < (self.debounce_ms / 1000.0):
            print(f"  [GEAR] Shift UP blocked (debounce {self.debounce_ms}ms)")
            return
        if self.current_gear < self.gear_max:
            old = self.current_gear
            self.current_gear += 1
            self._target_offset = self._compute_offset_for_gear(self.current_gear)
            self._last_shift_time = now
            print(f"  [GEAR] {old} → {self.current_gear} (UP) | roller: {self._target_offset:.2f}")
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
            self._target_offset = self._compute_offset_for_gear(self.current_gear)
            self._last_shift_time = now
            print(f"  [GEAR] {old} → {self.current_gear} (DOWN) | roller: {self._target_offset:.2f}")
        else:
            print(f"  [GEAR] Already at min gear ({self.gear_min})")

    def get_resistance_offset(self, base_slope=0.0):
        """Return the difference between route slope and trainer slope for the current gear."""
        return self._update_smooth_offset()

    def get_gear(self):
        return self.current_gear

    def get_display_gear(self):
        return self.current_gear + 1

    def get_target_offset(self, base_slope=0.0):
        return self._target_offset
