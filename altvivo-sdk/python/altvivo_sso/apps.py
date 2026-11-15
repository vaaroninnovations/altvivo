from django.apps import AppConfig
from django.conf import settings
from django.core import checks

MIDDLEWARE_PATH = "altvivo_sso.middleware.AltVivoSSOMiddleware"
AUTH_MIDDLEWARE = "django.contrib.auth.middleware.AuthenticationMiddleware"
BACKEND_PATH = "altvivo_sso.backends.AltVivoBackend"


class AltVivoSSOConfig(AppConfig):
    name = "altvivo_sso"
    verbose_name = "AltVivo SSO"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        checks.register(check_configuration, checks.Tags.security)
        # Import the configured mapper now so any signal receivers it defines
        # (e.g. on altvivo_sso.signals.sso_login) are connected at startup.
        try:
            from django.utils.module_loading import import_string

            from . import conf

            import_string(conf.get().USER_MAPPER)
        except Exception:  # misconfiguration is reported by the system check
            pass


def check_configuration(app_configs, **kwargs):
    from . import conf

    errors = []
    mw = list(getattr(settings, "MIDDLEWARE", []))
    if MIDDLEWARE_PATH not in mw:
        errors.append(checks.Error("AltVivoSSOMiddleware is not in MIDDLEWARE", id="altvivo_sso.E001"))
    elif AUTH_MIDDLEWARE not in mw or mw.index(MIDDLEWARE_PATH) < mw.index(AUTH_MIDDLEWARE):
        errors.append(checks.Error("AltVivoSSOMiddleware must come after AuthenticationMiddleware", id="altvivo_sso.E002"))
    if BACKEND_PATH not in getattr(settings, "AUTHENTICATION_BACKENDS", []):
        errors.append(checks.Error(f"Add {BACKEND_PATH} to AUTHENTICATION_BACKENDS", id="altvivo_sso.E003"))
    try:
        s = conf.get()
    except Exception as exc:  # ImproperlyConfigured
        errors.append(checks.Error(str(exc), id="altvivo_sso.E004"))
        return errors
    if not s.PUBLIC_ORIGIN and not settings.DEBUG:
        errors.append(checks.Warning(
            "ALTVIVO_PUBLIC_ORIGIN is not set; return URLs will be built from the Host header",
            id="altvivo_sso.W001",
        ))
    if not s.REDIS_URL and not settings.DEBUG:
        errors.append(checks.Warning(
            "ALTVIVO_REDIS_URL is not set: central logout takes effect only when the access token expires (<= 15 min)",
            id="altvivo_sso.W002",
        ))
    return errors
