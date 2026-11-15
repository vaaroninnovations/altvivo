"""Settings: ``settings.ALTVIVO_SSO = {...}`` overrides, else environment, else defaults.

Environment variables match altvivo-infra/docker-compose.yml (x-spoke-sso-env).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class SSOSettings:
    APP_ID: str
    JWKS_URL: str
    ISSUER: str = "https://api.altvivo.bio"
    ACCESS_COOKIE: str = "altvivo_at"
    LOGIN_URL: str = "https://altvivo.bio/login"
    LOGOUT_URL: str = "https://altvivo.bio/logout"
    REFRESH_BOUNCE_URL: str = "https://api.altvivo.bio/v1/auth/refresh/bounce"
    PRICING_URL: str = "https://altvivo.bio/pricing"
    PORTAL_URL: str = "https://altvivo.bio/workspace"
    HOME_URL: str = "https://altvivo.bio"
    EMBED_URL: str = "https://embed.altvivo.bio/bar.js"
    API_URL: str = "https://api.altvivo.bio"
    # Absolute origin of this spoke (https://xprism.altvivo.bio); used to build
    # return URLs so a spoofed Host header can never become a redirect target.
    PUBLIC_ORIGIN: str = ""
    CORE_INTERNAL_URL: str = "http://altvivo-core:4000"
    SERVICE_TOKEN: str = ""
    REDIS_URL: str = ""
    REDIS_KEY_PREFIX: str = "core:"
    # Redis down: True = keep serving (tokens still expire in <= 15 min).
    REVOCATION_FAIL_OPEN: bool = True
    JWKS_CACHE_SECONDS: int = 300
    LEEWAY_SECONDS: int = 5
    # Lowest entitlement for this app that may sign in through SSO.
    MIN_ACCESS_LEVEL: str = "trial"
    # "hybrid": local accounts keep working beside SSO. "required": unauthenticated
    # visitors to protected pages are sent to AltVivo instead of the local login.
    MODE: str = "hybrid"
    USER_MAPPER: str = "altvivo_sso.mapping.DefaultUserMapper"
    # Path prefixes the middleware never touches (health checks, static files).
    EXEMPT_PATHS: tuple[str, ...] = ("/healthz", "/static/", "/assets/", "/favicon", "/robots.txt")
    # URL names whose response must also end the central AltVivo session.
    LOGOUT_URL_NAMES: tuple[str, ...] = ("logout",)
    extra: dict = field(default_factory=dict)


_KEYS = {f for f in SSOSettings.__dataclass_fields__ if f != "extra"}

_ENV = {
    "APP_ID": "ALTVIVO_APP_ID",
    "JWKS_URL": "ALTVIVO_JWKS_URL",
    "ISSUER": "ALTVIVO_JWT_ISSUER",
    "ACCESS_COOKIE": "ALTVIVO_ACCESS_COOKIE",
    "LOGIN_URL": "ALTVIVO_LOGIN_URL",
    "LOGOUT_URL": "ALTVIVO_LOGOUT_URL",
    "REFRESH_BOUNCE_URL": "ALTVIVO_REFRESH_BOUNCE_URL",
    "PRICING_URL": "ALTVIVO_PRICING_URL",
    "PORTAL_URL": "ALTVIVO_PORTAL_URL",
    "HOME_URL": "ALTVIVO_HOME_URL",
    "EMBED_URL": "ALTVIVO_EMBED_URL",
    "API_URL": "ALTVIVO_API_URL",
    "PUBLIC_ORIGIN": "ALTVIVO_PUBLIC_ORIGIN",
    "CORE_INTERNAL_URL": "ALTVIVO_CORE_INTERNAL_URL",
    "SERVICE_TOKEN": "ALTVIVO_SERVICE_TOKEN",
    "REDIS_URL": "ALTVIVO_REDIS_URL",
    "REDIS_KEY_PREFIX": "ALTVIVO_REDIS_KEY_PREFIX",
    "JWKS_CACHE_SECONDS": "ALTVIVO_JWKS_CACHE_SECONDS",
    "MIN_ACCESS_LEVEL": "ALTVIVO_MIN_ACCESS_LEVEL",
    "MODE": "ALTVIVO_SSO_MODE",
}


@lru_cache(maxsize=1)
def get() -> SSOSettings:
    values: dict = {}
    for key, env_name in _ENV.items():
        v = os.environ.get(env_name)
        if v not in (None, ""):
            values[key] = v
    if "REVOCATION_FAIL_OPEN" not in values:
        values["REVOCATION_FAIL_OPEN"] = _env_bool("ALTVIVO_REVOCATION_FAIL_OPEN", True)
    overrides = getattr(settings, "ALTVIVO_SSO", {}) or {}
    unknown = set(overrides) - _KEYS
    if unknown:
        raise ImproperlyConfigured(f"Unknown ALTVIVO_SSO keys: {sorted(unknown)}")
    values.update(overrides)
    for int_key in ("JWKS_CACHE_SECONDS", "LEEWAY_SECONDS"):
        if int_key in values:
            values[int_key] = int(values[int_key])
    for tuple_key in ("EXEMPT_PATHS", "LOGOUT_URL_NAMES"):
        if isinstance(values.get(tuple_key), str):
            values[tuple_key] = tuple(p.strip() for p in values[tuple_key].split(",") if p.strip())
        elif tuple_key in values:
            values[tuple_key] = tuple(values[tuple_key])
    if not values.get("APP_ID"):
        raise ImproperlyConfigured("ALTVIVO_SSO APP_ID (or env ALTVIVO_APP_ID) is required")
    if not values.get("JWKS_URL"):
        raise ImproperlyConfigured("ALTVIVO_SSO JWKS_URL (or env ALTVIVO_JWKS_URL) is required")
    if values.get("MODE", "hybrid") not in ("hybrid", "required"):
        raise ImproperlyConfigured("ALTVIVO_SSO MODE must be 'hybrid' or 'required'")
    return SSOSettings(**values)


def reset() -> None:
    """For tests: forget cached settings."""
    get.cache_clear()
