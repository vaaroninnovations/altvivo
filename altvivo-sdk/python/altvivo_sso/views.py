from django.contrib.auth import logout as django_logout
from django.http import HttpResponseNotAllowed, HttpResponseRedirect
from django.views.decorators.cache import never_cache

from .middleware import SESSION_SID, absolute, central_logout_url, login_redirect, safe_local_path


@never_cache
def sso_login(request):
    """Use as LOGIN_URL in "required" mode: hands off to the AltVivo login page."""
    next_path = safe_local_path(request, request.GET.get("next"), "/")
    if request.user.is_authenticated and request.session.get(SESSION_SID):
        return HttpResponseRedirect(absolute(request, next_path))
    return login_redirect(request, next_path)


@never_cache
def sso_logout(request):
    """Ends the local session and the central AltVivo session (POST, CSRF-protected)."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    django_logout(request)
    return HttpResponseRedirect(central_logout_url(request))
