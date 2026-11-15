"""Server-to-server client for altvivo-core's internal API.

Runs on the Docker network (http://altvivo-core:4000) with the spoke's
service token. Never call these endpoints from a browser.

    from altvivo_sso.client import core
    balance = core().debit_credits(user_sub, 5, "SIMULATION_RUN", f"attempt-{attempt.pk}")
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from functools import lru_cache
from typing import Any

from . import conf


class CoreError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class InsufficientCredits(CoreError):
    pass


class CoreClient:
    def __init__(self, base_url: str, service_token: str, timeout: float = 10.0):
        if not service_token:
            raise ValueError("ALTVIVO_SERVICE_TOKEN is not configured")
        self.base_url = base_url.rstrip("/")
        self.service_token = service_token
        self.timeout = timeout

    def _call(self, method: str, path: str, body: dict | None = None, query: dict | None = None) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            from urllib.parse import urlencode

            url += "?" + urlencode(query)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.service_token}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310 - internal URL from settings
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            try:
                err = json.loads(exc.read() or b"{}").get("error", {})
            except ValueError:
                err = {}
            cls = InsufficientCredits if exc.code == 402 else CoreError
            raise cls(exc.code, err.get("code", "HTTP_ERROR"), err.get("message", exc.reason)) from None

    # ------------------------------------------------------------ identity --
    def entitlements(self, user_id: str) -> dict:
        return self._call("GET", f"/v1/internal/users/{user_id}/entitlements")

    # ------------------------------------------------------------- credits --
    def debit_credits(self, user_id: str, amount: int, action_type: str, reference_id: str) -> int:
        r = self._call("POST", "/v1/internal/credits/debit", {"userId": user_id, "amount": amount, "actionType": action_type, "referenceId": reference_id})
        return int(r["balance"])

    def refund_credits(self, user_id: str, amount: int, reference_id: str) -> int:
        r = self._call("POST", "/v1/internal/credits/refund", {"userId": user_id, "amount": amount, "referenceId": reference_id})
        return int(r["balance"])

    # --------------------------------------------------------------- audit --
    def audit(self, user_id: str | None, event_type: str, resource_id: str | None = None, metadata: dict | None = None,
              actor_ip: str | None = None, user_agent: str | None = None) -> None:
        """Record a GLP-relevant action in the central hash-chained audit trail."""
        self._call("POST", "/v1/internal/audit", {
            "userId": user_id, "eventType": event_type, "resourceId": resource_id,
            "metadata": metadata or {}, "actorIp": actor_ip, "userAgent": user_agent,
        })

    # --------------------------------------------------------------- vault --
    def vault_upload_url(self, user_id: str, file_name: str, file_type: str, size_bytes: int, sha256: str) -> dict:
        return self._call("POST", "/v1/internal/vault/upload-url", {
            "userId": user_id, "fileName": file_name, "fileType": file_type, "sizeBytes": size_bytes, "sha256": sha256,
        })

    def vault_complete(self, object_key: str) -> dict:
        return self._call("POST", "/v1/internal/vault/complete", {"objectKey": object_key})["file"]

    def vault_download_url(self, file_id: str, user_id: str) -> dict:
        return self._call("GET", f"/v1/internal/vault/files/{file_id}/download-url", query={"userId": user_id})


@lru_cache(maxsize=1)
def core() -> CoreClient:
    s = conf.get()
    return CoreClient(s.CORE_INTERNAL_URL, s.SERVICE_TOKEN)
