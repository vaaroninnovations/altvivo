from django.urls import path

from . import views

app_name = "altvivo_sso"

urlpatterns = [
    path("login/", views.sso_login, name="login"),
    path("logout/", views.sso_logout, name="logout"),
]
