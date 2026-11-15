"""Verification of the AltVivo access token (RS256, issued by api.altvivo.bio)."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

import jwt

from . import conf, level_rank
from .jwks import JWKSCache, JWKSUnavailable


class TokenInvalid(Exception):
    """Signature, issuer, algorithm or shape is wrong: treat as anonymous."""


class TokenExpired(TokenInvalid):
    """Well-formed and correctly signed, but past exp: refresh it."""


@dataclass(frozen=True)
class Claims:
    sub: str
    sid: str
    email: str
    name: str
    role: str
    org_id: str | None
    tier: str
    entitlements: dict[str, str]
    credits_remaining: int
    email_verified: bool
    mfa: bool
    iat: int
    exp: int
    jti: str
    raw: dict[str, Any] = field(repr=False, compare=False)

    def access_level(self, app_id: str) -> str:
        return (self.entitlements.get(app_id) or "none").lower()

    def has_access(self, app_id: str, minimum: str = "trial") -> bool:
        return level_rank(self.access_level(app_id)) >= level_rank(minimum)

    @classmethod
    def from_payload(cls, p: dict[str, Any]) -> "Claims":
        try:
            ents = p.get("entitlements") or {}
            if not isinstance(ents, dict):
                raise TypeError("entitlements must be an object")
            return cls(
                sub=str(p["sub"]),
                sid=str(p["sid"]),
                email=str(p.get("email") or "").lower(),
                name=str(p.get("name") or ""),
                role=str(p.get("role") or "RESEARCHER"),
                org_id=p.get("org_id"),
                tier=str(p.get("tier") or "FREE"),
                entitlements={str(k): str(v).lower() for k, v in ents.items()},
                credits_remaining=int(p.get("credits_remaining") or 0),
                email_verified=bool(p.get("email_verified")),
                mfa=bool(p.get("mfa")),
                iat=int(p["iat"]),
                exp=int(p["exp"]),
                jti=str(p.get("jti") or ""),
                raw=p,
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise TokenInvalid(f"malformed claims: {exc}") from exc


_cache: JWKSCache | None = None
_cache_lock = threading.Lock()


def _jwks() -> JWKSCache:
    global _cache
    s = conf.get()
    with _cache_lock:
        if _cache is None or _cache.url != s.JWKS_URL:
            _cache = JWKSCache(s.JWKS_URL, ttl=s.JWKS_CACHE_SECONDS)
        return _cache


def reset_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def verify(token: str) -> Claims:
    if not token or len(token) > 8192:
        raise TokenInvalid("empty or oversized token")
    s = conf.get()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise TokenInvalid(str(exc)) from exc
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise TokenInvalid("unexpected token header")
    try:
        key = _jwks().get_key(header["kid"])
    except KeyError as exc:
        raise TokenInvalid("unknown signing key") from exc
    except JWKSUnavailable as exc:
        raise TokenInvalid(f"JWKS unavailable: {exc}") from exc
    try:
        payload = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            issuer=s.ISSUER,
            leeway=s.LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "iss"], "verify_aud": False},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpired("access token expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenInvalid(str(exc)) from exc
    return Claims.from_payload(payload)
