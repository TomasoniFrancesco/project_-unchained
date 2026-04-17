"""Mock trainer for testing without real BLE hardware."""

import random
import time


class MockTrainer:
    """Simulates a smart trainer producing realistic-ish cycling data."""

    def __init__(self):
        self.power = 180.0
        self.cadence = 85.0
        self.speed_kmh = 25.0
        self.current_slope = 0.0
        self._last_time = time.time()

    def get_data(self):
        """Return simulated trainer data with some random walk variation."""
        now = time.time()
        dt = now - self._last_time
        self._last_time = now

        # Random walk for power (rider variability)
        self.power += random.uniform(-5, 5)
        self.power = max(80, min(400, self.power))

        # Cadence follows power loosely
        self.cadence += random.uniform(-2, 2)
        self.cadence = max(60, min(120, self.cadence))

        # Speed: rough model — power vs gravity + rolling resistance
        # On flat: ~35 km/h at 200W. Uphill: slower. Downhill: faster.
        base_speed = (self.power / 200.0) * 30.0  # rough linear model
        slope_effect = self.current_slope * 1.5     # km/h per % grade
        self.speed_kmh = max(3.0, base_speed - slope_effect)

        return {
            "speed_kmh": round(self.speed_kmh, 1),
            "cadence_rpm": round(self.cadence),
            "power_watts": round(self.power),
        }

    def set_slope(self, slope_pct):
        """Accept a slope command (mirrors BLE set_simulation_params)."""
        self.current_slope = slope_pct
        print(f"  [MOCK] Trainer slope set to {slope_pct:.1f}%")
