"""Thread-safe JWKS cache.

* keys are refreshed every ``ttl`` seconds;
* an unknown ``kid`` (key rotation) triggers an immediate refetch, at most
  once per 30 s so garbage tokens cannot hammer the IdP;
* if the IdP is unreachable, the last good key set keeps working for up to
  24 h (stale-if-error) - spokes stay up during a core restart.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from typing import Any

import jwt

log = logging.getLogger("altvivo_sso")

UNKNOWN_KID_COOLDOWN = 30.0
STALE_IF_ERROR = 24 * 3600.0


class JWKSUnavailable(Exception):
    pass


class JWKSCache:
    def __init__(self, url: str, ttl: int = 300, timeout: float = 3.0) -> None:
        self.url = url
        self.ttl = ttl
        self.timeout = timeout
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0
        self._last_attempt = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> dict[str, Any]:
        req = urllib.request.Request(self.url, headers={"Accept": "application/json", "User-Agent": "altvivo-sso-python/1.0"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310 - URL comes from settings
            doc = json.loads(resp.read().decode("utf-8"))
        keys: dict[str, Any] = {}
        for jwk in doc.get("keys", []):
            if jwk.get("kty") != "RSA" or jwk.get("use", "sig") != "sig" or not jwk.get("kid"):
                continue
            if jwk.get("alg", "RS256") != "RS256":
                continue
            keys[jwk["kid"]] = jwt.PyJWK(jwk, algorithm="RS256").key
        if not keys:
            raise JWKSUnavailable("JWKS document contains no usable RS256 keys")
        return keys

    def _refresh(self, force: bool) -> None:
        now = time.monotonic()
        with self._lock:
            fresh = self._keys and now - self._fetched_at < self.ttl
            if fresh and not force:
                return
            if force and now - self._last_attempt < UNKNOWN_KID_COOLDOWN and self._keys:
                return
            self._last_attempt = now
            try:
                self._keys = self._fetch()
                self._fetched_at = now
            except Exception as exc:  # network, JSON, key parse
                if self._keys and now - self._fetched_at < STALE_IF_ERROR:
                    log.warning("JWKS refresh failed, serving cached keys: %s", exc)
                    return
                raise JWKSUnavailable(str(exc)) from exc

    def get_key(self, kid: str) -> Any:
        self._refresh(force=False)
        key = self._keys.get(kid)
        if key is None:
            self._refresh(force=True)
            key = self._keys.get(kid)
        if key is None:
            raise KeyError(kid)
        return key
