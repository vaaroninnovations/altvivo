SECRET_KEY = "test-only"
DEBUG = False
ALLOWED_HOSTS = ["xprism.altvivo.bio", "testserver"]
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "altvivo_sso",
]
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "altvivo_sso.middleware.AltVivoSSOMiddleware",
]
AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend", "altvivo_sso.backends.AltVivoBackend"]
ROOT_URLCONF = "tests.urls"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True, "OPTIONS": {"context_processors": ["django.template.context_processors.request"]}}]
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
ALTVIVO_SSO = {
    "APP_ID": "xprism",
    "JWKS_URL": "file:///placeholder",  # replaced per test run
    "PUBLIC_ORIGIN": "https://xprism.altvivo.bio",
    "REDIS_URL": "redis://fake",
}
