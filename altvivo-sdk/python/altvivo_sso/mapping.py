"""How an AltVivo identity becomes (and stays in sync with) a local user.

Spokes with their own user model subclass ``DefaultUserMapper`` and point
``ALTVIVO_SSO["USER_MAPPER"]`` at it.
"""
from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from . import conf
from .models import AltVivoIdentity
from .tokens import Claims

log = logging.getLogger("altvivo_sso")


class LinkRefused(Exception):
    """The identity cannot be mapped to a local user (shown as a 403 page)."""


class DefaultUserMapper:
    def find_existing_user(self, claims: Claims):
        """Existing local account to link, or None. Only verified emails link."""
        if not claims.email_verified or not claims.email:
            return None
        User = get_user_model()
        field = getattr(User, "EMAIL_FIELD", "email")
        return User._default_manager.filter(**{f"{field}__iexact": claims.email}).first()

    def may_link(self, user, claims: Claims) -> bool:
        """Override to require local proof of the email (e.g. a verified flag)."""
        return True

    def username_for(self, claims: Claims) -> str:
        User = get_user_model()
        base = (claims.email or f"altvivo-{claims.sub}")[:150]
        candidate, n = base, 1
        while User._default_manager.filter(**{User.USERNAME_FIELD: candidate}).exists():
            n += 1
            suffix = f"+av{n}"
            candidate = f"{base[: 150 - len(suffix)]}{suffix}"
        return candidate

    def create_user(self, claims: Claims):
        User = get_user_model()
        first, _, last = claims.name.partition(" ")
        user = User(**{User.USERNAME_FIELD: self.username_for(claims)})
        if hasattr(user, "email"):
            user.email = claims.email
        if hasattr(user, "first_name"):
            user.first_name = first[:150]
        if hasattr(user, "last_name"):
            user.last_name = last[:150]
        user.set_unusable_password()  # sign-in happens at AltVivo only
        user.save()
        return user

    def update_user(self, user, identity: AltVivoIdentity, claims: Claims, created: bool) -> None:
        """Hook to copy claim data onto the local user. Called when claims change."""
        return None

    # --------------------------------------------------------------- core --
    def resolve(self, claims: Claims):
        s = conf.get()
        level = claims.access_level(s.APP_ID)
        identity = AltVivoIdentity.objects.select_related("user").filter(sub=claims.sub).first()
        created = False
        if identity is None:
            with transaction.atomic():
                user = self.find_existing_user(claims)
                if user is not None:
                    if AltVivoIdentity.objects.filter(user=user).exists():
                        raise LinkRefused("This local account is already linked to a different AltVivo account.")
                    if not self.may_link(user, claims):
                        user = None
                if user is None:
                    user = self.create_user(claims)
                    created = True
                try:
                    identity = AltVivoIdentity.objects.create(
                        user=user,
                        sub=claims.sub,
                        email=claims.email,
                        access_level=level,
                        last_iat=0,
                    )
                except IntegrityError:
                    # Concurrent first request for the same identity.
                    identity = AltVivoIdentity.objects.select_related("user").get(sub=claims.sub)
                    created = False
            log.info("altvivo identity %s linked to local user %s (created=%s)", claims.sub, identity.user_id, created)

        if not identity.user.is_active:
            raise LinkRefused("This account has been disabled on this application.")

        # Only write when a newer token carries news (tokens are re-minted at
        # least every 15 minutes, so this is ~1 write per user per refresh).
        if created or claims.iat > identity.last_iat:
            identity.email = claims.email
            identity.role = claims.role
            identity.org_id = claims.org_id or ""
            identity.tier = claims.tier
            identity.access_level = level
            identity.credits_remaining = claims.credits_remaining
            identity.email_verified = claims.email_verified
            identity.last_sid = claims.sid
            identity.last_iat = claims.iat
            identity.save()
            self.update_user(identity.user, identity, claims, created)
        return identity.user


def get_mapper() -> DefaultUserMapper:
    from django.utils.module_loading import import_string

    return import_string(conf.get().USER_MAPPER)()
