from django.conf import settings
from django.db import models

from . import level_rank

FULL_ACCESS_LEVELS = ("basic", "pro", "full")


class AltVivoIdentity(models.Model):
    """Links a local user to an AltVivo account and caches its latest claims."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="altvivo_identity")
    sub = models.CharField("AltVivo user id", max_length=64, unique=True)
    email = models.EmailField(max_length=254)
    role = models.CharField(max_length=32, default="RESEARCHER")
    org_id = models.CharField(max_length=64, blank=True, default="")
    tier = models.CharField(max_length=32, default="FREE")
    access_level = models.CharField("Entitlement for this app", max_length=16, default="none")
    credits_remaining = models.IntegerField(default=0)
    email_verified = models.BooleanField(default=False)
    last_sid = models.CharField(max_length=64, blank=True, default="")
    last_iat = models.BigIntegerField(default=0)
    linked_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "AltVivo identity"
        verbose_name_plural = "AltVivo identities"

    def __str__(self) -> str:
        return f"{self.email} ({self.sub})"

    @property
    def grants_full_access(self) -> bool:
        return self.access_level in FULL_ACCESS_LEVELS

    def at_least(self, level: str) -> bool:
        return level_rank(self.access_level) >= level_rank(level)


def altvivo_full_access(user) -> bool:
    """True when the user's AltVivo plan includes paid access to this app.

    Safe to call on any user object (anonymous, unlinked, or linked).
    """
    if not getattr(user, "is_authenticated", False):
        return False
    try:
        identity = user.altvivo_identity
    except AltVivoIdentity.DoesNotExist:
        return False
    return identity.grants_full_access
