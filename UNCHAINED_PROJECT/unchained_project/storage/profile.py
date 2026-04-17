"""User profile — persistent storage and calorie estimation."""

from __future__ import annotations

import json
from pathlib import Path

_DEFAULTS = {
    "name": "",
    "age": 30,
    "gender": "male",
    "weight_kg": 75.0,
    "height_cm": 175,
}


class UserProfile:
    """Manages a single rider profile with JSON persistence."""

    def __init__(self, profile_path: Path):
        self._path = profile_path
        self.data = dict(_DEFAULTS)
        self.load()

    def load(self):
        if self._path.exists():
            try:
                with open(self._path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                self.data.update(saved)
                self._normalize()
                print(f"  [PROFILE] Loaded: {self.data['name'] or '(unnamed)'}, "
                      f"{self.data['weight_kg']}kg")
            except Exception as e:
                print(f"  [PROFILE] Load error: {e}")
                self.data = dict(_DEFAULTS)

    def save(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2)
        print(f"  [PROFILE] Saved to {self._path}")

    def update(self, fields: dict):
        for key in _DEFAULTS:
            if key in fields:
                val = fields[key]
                if key == "name":
                    self.data[key] = str(val).strip()
                elif key == "gender":
                    self.data[key] = val if val in ("male", "female") else _DEFAULTS[key]
                elif key == "age":
                    self.data[key] = self._clamp_int(val, 10, 99, _DEFAULTS[key])
                elif key == "weight_kg":
                    self.data[key] = self._clamp_float(val, 30.0, 250.0, _DEFAULTS[key])
                elif key == "height_cm":
                    if val in ("", None):
                        self.data[key] = None
                    else:
                        self.data[key] = self._clamp_int(val, 100, 250, _DEFAULTS[key])
        self._normalize()
        self.save()

    def to_dict(self):
        data = dict(self.data)
        data["profile_complete"] = self.is_complete()
        return data

    def is_complete(self) -> bool:
        return bool(self.data.get("name", "").strip()) and self.data["weight_kg"] > 0

    def _normalize(self):
        self.data["name"] = str(self.data.get("name", "")).strip()
        self.data["gender"] = self.data.get("gender") if self.data.get("gender") in ("male", "female") else _DEFAULTS["gender"]
        self.data["age"] = self._clamp_int(self.data.get("age"), 10, 99, _DEFAULTS["age"])
        self.data["weight_kg"] = self._clamp_float(self.data.get("weight_kg"), 30.0, 250.0, _DEFAULTS["weight_kg"])
        height = self.data.get("height_cm")
        if height in ("", None):
            self.data["height_cm"] = None
        else:
            self.data["height_cm"] = self._clamp_int(height, 100, 250, _DEFAULTS["height_cm"])

    @staticmethod
    def _clamp_int(value, minimum, maximum, default):
        try:
            value = int(float(value))
        except (TypeError, ValueError):
            return default
        return max(minimum, min(maximum, value))

    @staticmethod
    def _clamp_float(value, minimum, maximum, default):
        try:
            value = float(value)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(maximum, value))

    def estimate_calories(self, avg_power_w: float, duration_s: float) -> float:
        """Estimate active calories burned (kcal)."""
        if duration_s <= 0 or avg_power_w <= 0:
            return 0.0

        weight_kg = self.data["weight_kg"]
        age = self.data["age"]
        height_cm = self.data["height_cm"] or _DEFAULTS["height_cm"]
        is_male = self.data["gender"] == "male"

        minutes = duration_s / 60.0

        work_rate_kgm_min = avg_power_w * 6.12
        vo2_ml_kg_min = 7.0 + (10.8 * work_rate_kgm_min / max(weight_kg, 1.0))
        gross_kcal_per_min = (vo2_ml_kg_min * weight_kg / 1000.0) * 5.0

        if is_male:
            bmr_kcal_day = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
        else:
            bmr_kcal_day = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
        resting_kcal_per_min = max(0.7, bmr_kcal_day / 1440.0)

        active_kcal = max(0.0, (gross_kcal_per_min - resting_kcal_per_min) * minutes)
        return round(active_kcal, 1)
