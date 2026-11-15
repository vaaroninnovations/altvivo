"""AltVivo SSO for Django spokes.

Add ``altvivo_sso`` to INSTALLED_APPS and
``altvivo_sso.middleware.AltVivoSSOMiddleware`` right after
``django.contrib.auth.middleware.AuthenticationMiddleware``.
"""

__version__ = "1.0.0"

ACCESS_LEVELS = ("none", "waitlist", "trial", "basic", "pro", "full")


def level_rank(level: str | None) -> int:
    try:
        return ACCESS_LEVELS.index((level or "none").lower())
    except ValueError:
        return 0
