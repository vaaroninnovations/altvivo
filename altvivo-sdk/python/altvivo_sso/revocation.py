"""Instant logout: altvivo-core writes revocations to Redis, spokes read them.

  core:revoked:sid:<sid>   -> "1"            one session signed out
  core:revoked:user:<sub>  -> unix seconds    every token issued before that

The spoke's Redis ACL user has read-only access to these keys.
"""
from __future__ import annotations

import logging
import threading

from . import conf
from .tokens import Claims

log = logging.getLogger("altvivo_sso")

_client = None
_lock = threading.Lock()


def _redis():
    global _client
    s = conf.get()
    if not s.REDIS_URL:
        return None
    with _lock:
        if _client is None:
            import redis  # optional dependency: pip install altvivo-sso[redis]

            _client = redis.Redis.from_url(s.REDIS_URL, socket_timeout=0.5, socket_connect_timeout=0.5, decode_responses=True)
        return _client


def set_client(client) -> None:
    """Inject a client (tests, or an app that already owns a Redis pool)."""
    global _client
    with _lock:
        _client = client


def is_revoked(claims: Claims) -> bool:
    client = _redis()
    if client is None:
        return False
    p = conf.get().REDIS_KEY_PREFIX
    try:
        sid_flag, user_before = client.mget(f"{p}revoked:sid:{claims.sid}", f"{p}revoked:user:{claims.sub}")
    except Exception as exc:  # redis.RedisError, socket errors
        if conf.get().REVOCATION_FAIL_OPEN:
            log.warning("revocation check unavailable, failing open: %s", exc)
            return False
        log.error("revocation check unavailable, failing closed: %s", exc)
        return True
    if sid_flag:
        return True
    try:
        return user_before is not None and claims.iat < int(user_before)
    except ValueError:
        return False
