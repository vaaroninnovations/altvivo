from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.template import Context, Template
from django.urls import include, path


@login_required(login_url="/sso/login/")
def private(request):
    return HttpResponse(f"hello {request.user.get_username()}")


def whoami(request):
    claims = getattr(request, "altvivo", None)
    return JsonResponse({
        "user": request.user.get_username() if request.user.is_authenticated else None,
        "sso": claims.sub if claims else None,
    })


def local_logout(request):
    logout(request)
    return HttpResponseRedirect("/")


def topbar(request):
    return HttpResponse(Template("{% load altvivo %}{% altvivo_topbar %}").render(Context({"request": request})))


def healthz(request):
    return HttpResponse("ok")


urlpatterns = [
    path("private/", private),
    path("api/whoami", whoami),
    path("whoami/", whoami),
    path("accounts/logout/", local_logout, name="logout"),
    path("topbar/", topbar),
    path("healthz", healthz),
    path("sso/", include("altvivo_sso.urls")),
]
