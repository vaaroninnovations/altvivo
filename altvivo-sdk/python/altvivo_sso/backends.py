from django.contrib.auth import get_user_model
from django.contrib.auth.backends import BaseBackend

BACKEND_PATH = "altvivo_sso.backends.AltVivoBackend"


class AltVivoBackend(BaseBackend):
    """Session backend for users signed in through AltVivo SSO.

    It never authenticates credentials (``authenticate`` always returns None);
    the middleware verifies the JWT and calls ``login()`` with this backend so
    Django can reload the user from the session on later requests.
    """

    def authenticate(self, request, **credentials):
        return None

    def get_user(self, user_id):
        User = get_user_model()
        try:
            user = User._default_manager.get(pk=user_id)
        except User.DoesNotExist:
            return None
        return user if getattr(user, "is_active", True) else None
