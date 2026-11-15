"""{% load altvivo %} {% altvivo_topbar %}

Renders the shared AltVivo top bar (waffle app switcher, credits, account
menu) for users signed in through AltVivo. Renders nothing for local-only
sessions unless ``always=True``.
"""
from django import template
from django.utils.html import format_html

from .. import conf

register = template.Library()


@register.simple_tag(takes_context=True)
def altvivo_topbar(context, always=False):
    request = context.get("request")
    if request is None:
        return ""
    if not always and getattr(request, "altvivo", None) is None:
        return ""
    s = conf.get()
    nonce = getattr(request, "csp_nonce", "")
    return format_html(
        '<script src="{}" defer crossorigin="anonymous"{}></script>'
        '<altvivo-topbar app="{}" api="{}" home="{}"></altvivo-topbar>',
        s.EMBED_URL,
        format_html(' nonce="{}"', nonce) if nonce else "",
        s.APP_ID,
        s.API_URL,
        s.HOME_URL,
    )


@register.simple_tag(takes_context=True)
def altvivo_logout_url(context):
    """POST target that ends both the local and the central session."""
    from django.urls import reverse

    return reverse("altvivo_sso:logout")
