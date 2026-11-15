"""AltVivoSSOMiddleware: single sign-on from the `.altvivo.bio` access cookie.

Place it directly after ``django.contrib.auth.middleware.AuthenticationMiddleware``.

Per request:
  1. Exempt paths (health checks, static) pass through untouched.
  2. A session created by the spoke's own login form is left alone (hybrid mode).
  3. Otherwise ``altvivo_at`` is verified locally (RS256 via cached JWKS) and
     checked against the Redis revocation list.
       valid    -> map to a local user, ``login()`` once per AltVivo session,
                   expose the claims as ``request.altvivo``
       expired  -> page loads bounce through api.altvivo.bio to refresh;
                   XHR/API calls get 401 JSON with a refresh URL
       missing / invalid / revoked -> the SSO session is ended locally
  4. When the spoke's own logout view runs for an SSO session, the response
     is redirected to the central AltVivo logout so the shared cookies are
     cleared too (otherwise the next request would sign the user straight back in).
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urlencode, urlsplit

from django.contrib.auth import login, logout
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.utils.http import url_has_allowed_host_and_scheme

from . import conf, revocation, tokens
from .backends import BACKEND_PATH
from .mapping import LinkRefused, get_mapper
from .signals import sso_login

log = logging.getLogger("altvivo_sso")

SESSION_SID = "_altvivo_sid"
SESSION_BOUNCE = "_altvivo_bounce_at"
BOUNCE_LOOP_SECONDS = 20


def public_origin(request) -> str:
    s = conf.get()
    if s.PUBLIC_ORIGIN:
        return s.PUBLIC_ORIGIN.rstrip("/")
    return f"{request.scheme}://{request.get_host()}"


def absolute(request, path: str | None = None) -> str:
    return public_origin(request) + (path if path is not None else request.get_full_path())


def safe_local_path(request, candidate: str | None, default: str = "/") -> str:
    """A same-origin path from ?next=, never an open redirect."""
    if not candidate:
        return default
    host = urlsplit(public_origin(request)).netloc
    if url_has_allowed_host_and_scheme(candidate, allowed_hosts={host}, require_https=request.is_secure()):
        parts = urlsplit(candidate)
        return (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return default


def wants_json(request) -> bool:
    accept = request.headers.get("Accept", "")
    return (
        request.path.startswith("/api/")
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
        or ("application/json" in accept and "text/html" not in accept)
    )


def is_navigation(request) -> bool:
    if request.method not in ("GET", "HEAD") or wants_json(request):
        return False
    mode = request.headers.get("Sec-Fetch-Mode")
    return mode == "navigate" if mode else "text/html" in request.headers.get("Accept", "text/html")


def login_redirect(request, next_path: str | None = None) -> HttpResponseRedirect:
    s = conf.get()
    return HttpResponseRedirect(f"{s.LOGIN_URL}?{urlencode({'next': absolute(request, next_path)})}")


def bounce_redirect(request) -> HttpResponseRedirect:
    s = conf.get()
    return HttpResponseRedirect(f"{s.REFRESH_BOUNCE_URL}?{urlencode({'next': absolute(request)})}")


def central_logout_url(request) -> str:
    s = conf.get()
    return f"{s.LOGOUT_URL}?{urlencode({'next': public_origin(request) + '/'})}"


def denied(request, reason: str, message: str, claims: tokens.Claims | None = None):
    s = conf.get()
    level = claims.access_level(s.APP_ID) if claims else "none"
    pricing = f"{s.PRICING_URL}?{urlencode({'app': s.APP_ID})}"
    if wants_json(request):
        return JsonResponse({"error": reason, "message": message, "accessLevel": level, "pricingUrl": pricing}, status=403)
    return render(
        request,
        "altvivo_sso/no_access.html",
        {"reason": reason, "message": message, "access_level": level, "pricing_url": pricing, "portal_url": s.PORTAL_URL, "claims": claims},
        status=403,
    )


class AltVivoSSOMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        s = conf.get()
        request.altvivo = None
        if request.path.startswith(s.EXEMPT_PATHS):
            return self.get_response(request)
        if not hasattr(request, "user") or not hasattr(request, "session"):
            raise ImproperlyConfigured(
                "AltVivoSSOMiddleware must come after SessionMiddleware and AuthenticationMiddleware"
            )

        early = self._authenticate(request)
        if early is not None:
            return early

        was_sso = bool(request.session.get(SESSION_SID))
        response = self.get_response(request)

        # Spoke-local logout of an SSO session -> end the central session too.
        match = getattr(request, "resolver_match", None)
        if was_sso and match is not None and match.url_name in s.LOGOUT_URL_NAMES and 300 <= response.status_code < 400:
            return HttpResponseRedirect(central_logout_url(request))
        return response

    # ------------------------------------------------------------------ --
    def _authenticate(self, request):
        s = conf.get()
        session_sid = request.session.get(SESSION_SID)
        local_session = request.user.is_authenticated and not session_sid
        if local_session:
            return None  # signed in through the spoke's own form: untouched

        token = request.COOKIES.get(s.ACCESS_COOKIE)
        claims = None
        expired = False
        if token:
            try:
                claims = tokens.verify(token)
            except tokens.TokenExpired:
                expired = True
            except tokens.TokenInvalid as exc:
                log.info("rejected AltVivo token: %s", exc)
        if claims is not None and revocation.is_revoked(claims):
            log.info("AltVivo session %s is revoked", claims.sid)
            claims = None

        if claims is not None:
            return self._sign_in(request, claims, session_sid)

        if session_sid:
            recently = time.time() - float(request.session.get(SESSION_BOUNCE, 0)) < BOUNCE_LOOP_SECONDS
            if expired and not recently:
                if is_navigation(request):
                    request.session[SESSION_BOUNCE] = time.time()
                    return bounce_redirect(request)
                if wants_json(request):
                    return JsonResponse(
                        {"error": "session_expired", "refreshUrl": f"{s.API_URL}/v1/auth/refresh", "loginUrl": s.LOGIN_URL},
                        status=401,
                    )
            # Token gone (central logout), invalid, revoked, or refresh failed.
            logout(request)
            if is_navigation(request):
                return login_redirect(request)
        return None

    def _sign_in(self, request, claims: tokens.Claims, session_sid: str | None):
        s = conf.get()
        if not claims.has_access(s.APP_ID, s.MIN_ACCESS_LEVEL):
            if session_sid:
                logout(request)
            if not claims.email_verified:
                return denied(request, "email_not_verified", "Verify your email address on AltVivo to start using this application.", claims)
            return denied(request, "not_entitled", "Your AltVivo plan does not include this application yet.", claims)
        try:
            user = get_mapper().resolve(claims)
        except LinkRefused as exc:
            if session_sid:
                logout(request)
            return denied(request, "link_refused", str(exc), claims)

        if not request.user.is_authenticated or request.user.pk != user.pk or session_sid != claims.sid:
            # login() rotates the session key (no session fixation) and
            # records the backend so later requests reload this user.
            login(request, user, backend=BACKEND_PATH)
            request.session[SESSION_SID] = claims.sid
            sso_login.send(sender=self.__class__, request=request, user=user, claims=claims)
        elif SESSION_BOUNCE in request.session:
            del request.session[SESSION_BOUNCE]
        request.altvivo = claims
        return None
