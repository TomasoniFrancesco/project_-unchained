"""Centralized configuration — loads from CLI args, env vars, and config.toml."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

# Project root: directory containing run.py / config.toml
PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class BLEConfig:
    scan_timeout: int = 8
    bypass_connection: bool = True
    trainer_keywords: list[str] = field(default_factory=lambda: [
        "trainer", "bike", "ftms", "tacx", "wahoo", "elite",
        "van rysel", "kickr", "neo", "flux", "direto",
    ])
    controller_keywords: list[str] = field(default_factory=lambda: [
        "zwift", "click", "play",
    ])


@dataclass
class StravaConfig:
    client_id: str = ""
    client_secret: str = ""


@dataclass
class GearConfig:
    count: int = 21
    neutral: int = 5
    step_grade: float = 0.5
    debounce_ms: int = 200
    smoothing: float = 0.3


@dataclass
class PhysicsConfig:
    rider_mass: float = 80.0
    crr: float = 0.005
    cda: float = 0.4
    slope_smoothing: float = 0.25
    max_slope_rate: float = 2.0


@dataclass
class AppConfig:
    """Root configuration object."""

    # Server
    host: str = "0.0.0.0"
    port: int = 5050
    debug: bool = False

    # Paths
    data_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "data")

    # Sub-configs
    ble: BLEConfig = field(default_factory=BLEConfig)
    strava: StravaConfig = field(default_factory=StravaConfig)
    gear: GearConfig = field(default_factory=GearConfig)
    physics: PhysicsConfig = field(default_factory=PhysicsConfig)

    # Derived paths
    @property
    def routes_dir(self) -> Path:
        return self.data_dir / "routes"

    @property
    def activities_dir(self) -> Path:
        return self.data_dir / "activities"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def profile_path(self) -> Path:
        return self.data_dir / "profile.json"

    @property
    def strava_tokens_path(self) -> Path:
        return self.data_dir / "strava_tokens.json"

    def ensure_dirs(self):
        """Create all data directories if they don't exist."""
        for d in (self.routes_dir, self.activities_dir, self.exports_dir):
            d.mkdir(parents=True, exist_ok=True)


def load_config(cli_args=None) -> AppConfig:
    """Load configuration with priority: CLI args > env vars > config.toml > defaults."""
    cfg = AppConfig()

    # 1. Load config.toml if it exists
    toml_path = PROJECT_ROOT / "config.toml"
    if toml_path.exists():
        try:
            with open(toml_path, "rb") as f:
                toml_data = tomllib.load(f)
            _apply_toml(cfg, toml_data)
            print(f"  [CONFIG] Loaded config.toml")
        except Exception as exc:
            print(f"  [CONFIG] Error reading config.toml: {exc}")

    # 2. Environment variables override TOML
    _apply_env(cfg)

    # 3. CLI args override everything
    if cli_args:
        if hasattr(cli_args, "port") and cli_args.port is not None:
            cfg.port = cli_args.port
        if hasattr(cli_args, "host") and cli_args.host is not None:
            cfg.host = cli_args.host
        if hasattr(cli_args, "debug") and cli_args.debug:
            cfg.debug = True

    # Resolve relative data_dir
    if not cfg.data_dir.is_absolute():
        cfg.data_dir = PROJECT_ROOT / cfg.data_dir

    cfg.ensure_dirs()
    return cfg


def _apply_toml(cfg: AppConfig, data: dict):
    """Apply TOML data to config object."""
    server = data.get("server", {})
    if "host" in server:
        cfg.host = server["host"]
    if "port" in server:
        cfg.port = int(server["port"])
    if "debug" in server:
        cfg.debug = bool(server["debug"])

    paths = data.get("paths", {})
    if "data_dir" in paths:
        cfg.data_dir = Path(paths["data_dir"])

    ble = data.get("ble", {})
    if "scan_timeout" in ble:
        cfg.ble.scan_timeout = int(ble["scan_timeout"])
    if "bypass_connection" in ble:
        cfg.ble.bypass_connection = bool(ble["bypass_connection"])
    if "trainer_keywords" in ble:
        cfg.ble.trainer_keywords = list(ble["trainer_keywords"])
    if "controller_keywords" in ble:
        cfg.ble.controller_keywords = list(ble["controller_keywords"])

    strava = data.get("strava", {})
    if "client_id" in strava:
        cfg.strava.client_id = str(strava["client_id"]).strip()
    if "client_secret" in strava:
        cfg.strava.client_secret = str(strava["client_secret"]).strip()

    gear = data.get("gear", {})
    for key in ("count", "neutral", "debounce_ms"):
        if key in gear:
            setattr(cfg.gear, key, int(gear[key]))
    for key in ("step_grade", "smoothing"):
        if key in gear:
            setattr(cfg.gear, key, float(gear[key]))

    physics = data.get("physics", {})
    for key in ("rider_mass", "crr", "cda", "slope_smoothing", "max_slope_rate"):
        if key in physics:
            setattr(cfg.physics, key, float(physics[key]))


def _apply_env(cfg: AppConfig):
    """Apply environment variables to config."""
    if v := os.getenv("FUCKZWIFT_PORT"):
        cfg.port = int(v)
    if v := os.getenv("FUCKZWIFT_HOST"):
        cfg.host = v
    if v := os.getenv("FUCKZWIFT_DEBUG"):
        cfg.debug = v.lower() in ("1", "true", "yes")
    if v := os.getenv("FUCKZWIFT_DATA_DIR"):
        cfg.data_dir = Path(v)
    if v := os.getenv("STRAVA_CLIENT_ID"):
        cfg.strava.client_id = v.strip()
    if v := os.getenv("STRAVA_CLIENT_SECRET"):
        cfg.strava.client_secret = v.strip()
