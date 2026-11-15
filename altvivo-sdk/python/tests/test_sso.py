import json
import tempfile
import time
import uuid
from pathlib import Path

import fakeredis
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from altvivo_sso import conf, revocation, tokens
from altvivo_sso.models import AltVivoIdentity, altvivo_full_access

ISS = "https://api.altvivo.bio"


def _keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    return key, jwk


KEY, JWK = _keypair()
KID = "test-kid-1"
TMP = Path(tempfile.mkdtemp())
JWKS_FILE = TMP / "jwks.json"


def write_jwks(*entries):
    JWKS_FILE.write_text(json.dumps({"keys": [{**jwk, "kid": kid, "alg": "RS256", "use": "sig"} for kid, jwk in entries]}))


write_jwks((KID, JWK))
SSO = {
    "APP_ID": "xprism",
    "JWKS_URL": JWKS_FILE.as_uri(),
    "PUBLIC_ORIGIN": "https://xprism.altvivo.bio",
    "REDIS_URL": "redis://fake",
}


def make_token(key=KEY, kid=KID, **over):
    now = int(time.time())
    claims = {
        "sub": over.pop("sub", str(uuid.uuid4())),
        "sid": over.pop("sid", str(uuid.uuid4())),
        "email": "researcher@institute.edu.in",
        "name": "Dr. Researcher",
        "org_id": None,
        "role": "PI",
        "tier": "INSTITUTIONAL_PRO",
        "entitlements": {"xprism": "full", "amaze": "pro", "pharmadme": "waitlist"},
        "credits_remaining": 1250,
        "email_verified": True,
        "mfa": False,
        "iat": now,
        "exp": now + 900,
        "iss": ISS,
        "jti": str(uuid.uuid4()),
    }
    claims.update(over)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": kid}), claims


@override_settings(ALTVIVO_SSO=SSO)
class SSOTests(TestCase):
    def setUp(self):
        conf.reset()
        tokens.reset_cache()
        write_jwks((KID, JWK))
        self.redis = fakeredis.FakeRedis(decode_responses=True)
        revocation.set_client(self.redis)
        self.c = Client(HTTP_HOST="xprism.altvivo.bio")

    def browse(self, path, token=None, json_api=False, **extra):
        if token is not None:
            self.c.cookies["altvivo_at"] = token
        headers = {"HTTP_ACCEPT": "application/json"} if json_api else {"HTTP_ACCEPT": "text/html", "HTTP_SEC_FETCH_MODE": "navigate"}
        headers.update(extra)
        return self.c.get(path, secure=True, **headers)

    # ------------------------------------------------------------------ --
    def test_valid_token_creates_and_signs_in_user(self):
        token, claims = make_token()
        r = self.browse("/whoami/", token)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"user": "researcher@institute.edu.in", "sso": claims["sub"]})
        ident = AltVivoIdentity.objects.get(sub=claims["sub"])
        self.assertEqual((ident.access_level, ident.tier, ident.credits_remaining), ("full", "INSTITUTIONAL_PRO", 1250))
        self.assertFalse(ident.user.has_usable_password())
        self.assertTrue(altvivo_full_access(ident.user))
        key1 = self.c.session.session_key
        self.assertEqual(self.browse("/private/").content, b"hello researcher@institute.edu.in")
        self.assertEqual(self.c.session.session_key, key1, "no re-login on subsequent requests")

    def test_links_existing_user_by_verified_email_only(self):
        User = get_user_model()
        existing = User.objects.create_user("faculty1", email="Researcher@Institute.edu.in", password="x" * 12)
        # A paid but unverified AltVivo email may sign in, but never claims the local account.
        token, claims = make_token(email_verified=False, entitlements={"xprism": "full"})
        r = self.browse("/api/whoami", token, json_api=True)
        self.assertNotEqual(r.json()["user"], "faculty1")
        self.assertNotEqual(AltVivoIdentity.objects.get(sub=claims["sub"]).user_id, existing.pk)
        self.c = Client(HTTP_HOST="xprism.altvivo.bio")
        token, claims = make_token()
        self.assertEqual(self.browse("/whoami/", token).json()["user"], "faculty1")
        self.assertEqual(AltVivoIdentity.objects.get(sub=claims["sub"]).user_id, existing.pk)

    def test_expired_token_bounces_page_loads_and_401s_api(self):
        token, _ = make_token()
        self.browse("/whoami/", token)
        expired, _ = make_token(iat=int(time.time()) - 2000, exp=int(time.time()) - 100)
        api = self.browse("/api/whoami", expired, json_api=True)
        self.assertEqual(api.status_code, 401)
        self.assertEqual(api.json()["error"], "session_expired")
        page = self.browse("/private/?x=1", expired)
        self.assertEqual(page.status_code, 302)
        self.assertEqual(
            page["Location"],
            "https://api.altvivo.bio/v1/auth/refresh/bounce?next=https%3A%2F%2Fxprism.altvivo.bio%2Fprivate%2F%3Fx%3D1",
        )
        # Coming straight back with a still-expired token => no loop: sign in again.
        again = self.browse("/private/?x=1", expired)
        self.assertTrue(again["Location"].startswith("https://altvivo.bio/login?next="))
        self.assertNotIn("_auth_user_id", self.c.session)

    def test_central_logout_ends_local_session(self):
        token, _ = make_token()
        self.browse("/whoami/", token)
        del self.c.cookies["altvivo_at"]
        r = self.browse("/private/")
        self.assertEqual(r.status_code, 302)
        self.assertIn("https://altvivo.bio/login", r["Location"])
        self.assertNotIn("_auth_user_id", self.c.session)

    def test_revoked_session_and_user_are_rejected(self):
        token, claims = make_token()
        self.assertIsNotNone(self.browse("/api/whoami", token, json_api=True).json()["sso"])
        self.redis.set(f"core:revoked:sid:{claims['sid']}", "1")
        self.assertIsNone(self.browse("/api/whoami", token, json_api=True).json()["user"])
        token2, claims2 = make_token(sub=claims["sub"])
        self.redis.set(f"core:revoked:user:{claims2['sub']}", str(claims2["iat"] + 1))
        self.assertIsNone(self.browse("/api/whoami", token2, json_api=True).json()["sso"])

    def test_entitlement_gate(self):
        for level in ("none", "waitlist"):
            token, _ = make_token(entitlements={"xprism": level})
            r = self.browse("/whoami/", token)
            self.assertEqual(r.status_code, 403)
            self.assertContains(r, "View plans", status_code=403)
        token, _ = make_token(entitlements={"xprism": "trial"})
        r = self.browse("/api/whoami", token, json_api=True)
        self.assertEqual(r.status_code, 200)
        ident = AltVivoIdentity.objects.get(sub=r.json()["sso"])
        self.assertFalse(ident.grants_full_access)

    def test_rejects_forged_and_foreign_tokens(self):
        other_key, _ = _keypair()
        bad = [
            make_token(key=other_key)[0],             # signed by someone else, same kid
            make_token(kid="unknown-kid")[0],         # unknown key
            make_token(iss="https://evil.example")[0],
            jwt.encode({"sub": "x", "sid": "y", "iss": ISS, "iat": 1, "exp": 9999999999}, "secret", algorithm="HS256", headers={"kid": KID}),
            "not-a-jwt",
        ]
        for t in bad:
            r = self.browse("/api/whoami", t, json_api=True)
            self.assertIsNone(r.json()["user"], t[:20])

    def test_key_rotation_is_picked_up(self):
        new_key, new_jwk = _keypair()
        write_jwks((KID, JWK), ("kid-2", new_jwk))
        token, _ = make_token(key=new_key, kid="kid-2")
        self.assertIsNotNone(self.browse("/api/whoami", token, json_api=True).json()["sso"])

    def test_local_session_is_not_overridden(self):
        User = get_user_model()
        User.objects.create_user("student7", password="pw-student-7")
        self.assertTrue(self.c.login(username="student7", password="pw-student-7"))
        token, _ = make_token()
        r = self.browse("/api/whoami", token, json_api=True)
        self.assertEqual(r.json(), {"user": "student7", "sso": None})

    def test_spoke_logout_redirects_to_central_logout(self):
        token, _ = make_token()
        self.browse("/whoami/", token)
        r = self.c.get("/accounts/logout/", secure=True)
        self.assertEqual(r["Location"], "https://altvivo.bio/logout?next=https%3A%2F%2Fxprism.altvivo.bio%2F")

    def test_sso_login_view_rejects_open_redirects(self):
        r = self.c.get("/sso/login/?next=https://evil.example/x", secure=True)
        self.assertEqual(r["Location"], "https://altvivo.bio/login?next=https%3A%2F%2Fxprism.altvivo.bio%2F")
        r = self.c.get("/sso/login/?next=/lab/7", secure=True)
        self.assertEqual(r["Location"], "https://altvivo.bio/login?next=https%3A%2F%2Fxprism.altvivo.bio%2Flab%2F7")

    def test_exempt_paths_untouched_and_topbar(self):
        token, _ = make_token()
        self.assertEqual(self.browse("/healthz", token).content, b"ok")
        self.assertNotIn("_auth_user_id", self.c.session)
        html = self.browse("/topbar/", token).content.decode()
        self.assertIn('<altvivo-topbar app="xprism" api="https://api.altvivo.bio" home="https://altvivo.bio">', html)
        self.assertIn('src="https://embed.altvivo.bio/bar.js"', html)
        anon = Client(HTTP_HOST="xprism.altvivo.bio")
        self.assertEqual(anon.get("/topbar/", secure=True).content, b"")

    def test_claims_sync_on_newer_token_only(self):
        sub = str(uuid.uuid4())
        now = int(time.time())
        t1, c1 = make_token(sub=sub, iat=now - 120, exp=now + 780)
        self.browse("/api/whoami", t1, json_api=True)
        t2, _ = make_token(sub=sub, sid=c1["sid"], credits_remaining=7, entitlements={"xprism": "trial"})
        self.browse("/api/whoami", t2, json_api=True)
        ident = AltVivoIdentity.objects.get(sub=sub)
        self.assertEqual((ident.credits_remaining, ident.access_level), (7, "trial"))
