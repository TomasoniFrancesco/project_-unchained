"""Physics engine — slope smoothing, rate-limiting, and basic force model."""

from __future__ import annotations

import math


class PhysicsEngine:
    """Smooth and rate-limit slope changes, optionally compute physics-based speed."""

    def __init__(self, rider_mass=80.0, crr=0.005, cda=0.4,
                 slope_smoothing=0.25, max_slope_rate=2.0):
        self.rider_mass = rider_mass
        self.crr = crr
        self.cda = cda
        self.ema_alpha = slope_smoothing
        self.max_slope_change_per_sec = max_slope_rate
        self.air_density = 1.225  # kg/m³
        self.g = 9.81

        self._smoothed_slope = 0.0
        self._output_slope = 0.0
        self._speed_ms = 0.0

    def reset(self):
        """Reset state for a new ride."""
        self._smoothed_slope = 0.0
        self._output_slope = 0.0
        self._speed_ms = 0.0

    def update(self, raw_slope_pct: float, dt: float) -> float:
        """Process a raw slope reading and return the smoothed, rate-limited slope."""
        if dt <= 0:
            return self._output_slope

        self._smoothed_slope += self.ema_alpha * (raw_slope_pct - self._smoothed_slope)

        max_delta = self.max_slope_change_per_sec * dt
        delta = self._smoothed_slope - self._output_slope
        if abs(delta) > max_delta:
            delta = max_delta if delta > 0 else -max_delta
        self._output_slope += delta

        return self._output_slope

    def compute_speed(self, power_w: float, dt: float) -> float:
        """Compute inertia-based speed from current power and slope."""
        if dt <= 0:
            return self._speed_ms

        v = max(self._speed_ms, 0.5)

        slope_rad = math.atan(self._output_slope / 100.0)
        f_gravity = self.rider_mass * self.g * math.sin(slope_rad)
        f_rolling = self.crr * self.rider_mass * self.g * math.cos(slope_rad)
        f_drag = 0.5 * self.cda * self.air_density * v * v
        f_drive = power_w / v if v > 0.5 else power_w / 0.5

        f_net = f_drive - f_gravity - f_rolling - f_drag
        accel = f_net / self.rider_mass

        self._speed_ms += accel * dt
        self._speed_ms = max(0.0, min(self._speed_ms, 30.0))

        return self._speed_ms

    @property
    def current_slope(self) -> float:
        return self._output_slope

    @property
    def speed_kmh(self) -> float:
        return self._speed_ms * 3.6
