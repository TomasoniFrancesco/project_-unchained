"""Virtual gear system — maintains gear state and computes resistance offset."""

from __future__ import annotations

import time


class GearSystem:
    """Virtual gear system with smooth resistance transitions."""

    def __init__(self, count=21, neutral=5, step_grade=0.5,
                 debounce_ms=200, smoothing=0.3):
        self.gear_min = 0
        self.gear_max = count - 1
        self.gear_neutral = neutral
        self.step_grade = step_grade
        self.debounce_ms = debounce_ms
        self.smoothing_factor = smoothing

        self.current_gear = self.gear_neutral
        self._last_shift_time = 0.0
        self._target_offset = 0.0
        self._smooth_offset = 0.0

    def shift_up(self):
        """Shift to a harder gear (more resistance)."""
        now = time.time()
        if (now - self._last_shift_time) < (self.debounce_ms / 1000.0):
            print(f"  [GEAR] Shift UP blocked (debounce {self.debounce_ms}ms)")
            return
        if self.current_gear < self.gear_max:
            old = self.current_gear
            self.current_gear += 1
            self._target_offset = (self.current_gear - self.gear_neutral) * self.step_grade
            self._last_shift_time = now
            print(f"  [GEAR] {old} → {self.current_gear} (UP) | offset: {self._target_offset:+.1f}%")
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
            self._target_offset = (self.current_gear - self.gear_neutral) * self.step_grade
            self._last_shift_time = now
            print(f"  [GEAR] {old} → {self.current_gear} (DOWN) | offset: {self._target_offset:+.1f}%")
        else:
            print(f"  [GEAR] Already at min gear ({self.gear_min})")

    def get_resistance_offset(self):
        """Return the current smoothed gear offset in % grade."""
        self._smooth_offset += self.smoothing_factor * (self._target_offset - self._smooth_offset)
        return self._smooth_offset

    def get_gear(self):
        return self.current_gear

    def get_display_gear(self):
        return self.current_gear

    def get_target_offset(self):
        return self._target_offset
