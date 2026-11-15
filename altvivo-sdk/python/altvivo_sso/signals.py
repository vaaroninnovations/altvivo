from django.dispatch import Signal

# Sent after AltVivoSSOMiddleware signs a user in (once per AltVivo session).
# kwargs: request, user, claims (altvivo_sso.tokens.Claims)
sso_login = Signal()
