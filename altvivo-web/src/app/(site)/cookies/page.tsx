import type { Metadata } from "next";
import { CookieSettingsButton } from "@/components/cookie-settings-button";
import { LegalDoc } from "@/components/legal";
import { legalInfo, POLICY_EFFECTIVE, POLICY_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "The cookies and browser storage AltVivo uses for single sign-on, security and payments, and how to choose optional cookies.",
};
export const dynamic = "force-dynamic";

const TOC = [
  { id: "what", label: "What cookies are" },
  { id: "choices", label: "Your choices" },
  { id: "necessary", label: "Strictly necessary" },
  { id: "payments", label: "Payment processors" },
  { id: "optional", label: "Optional cookies" },
  { id: "storage", label: "Browser storage" },
  { id: "browser", label: "Browser controls" },
  { id: "contact", label: "Contact" },
];

type Row = [name: string, set: string, purpose: string, duration: string];

const NECESSARY: Row[] = [
  ["altvivo_at", "api.altvivo.bio, for the whole .altvivo.bio domain", "Signed access token (RS256) that tells each AltVivo application who you are and which licences you hold. HttpOnly, Secure, SameSite=Lax.", "15 minutes"],
  ["altvivo_rt", "api.altvivo.bio, sent only to /v1/auth/refresh", "Rotating refresh token that keeps you signed in and issues new access tokens. Each use replaces it; reuse of an old one signs the session out. HttpOnly, Secure, SameSite=Strict.", "7 days"],
  ["altvivo_csrf", "api.altvivo.bio, for .altvivo.bio", "Signed anti-forgery token, sent back in a header with every form submission so other sites cannot act on your behalf. Secure, SameSite=Lax.", "30 days"],
  ["altvivo_oauth", "api.altvivo.bio, sign-in paths only", "Binds a Google or ORCID sign-in to your browser to prevent login forgery. Deleted when sign-in completes.", "10 minutes"],
  ["altvivo_consent", "altvivo.bio, for .altvivo.bio", "Records your cookie choices so every AltVivo application can honour them, with a random identifier linking to our consent record.", "12 months"],
  ["sessionid, csrftoken", "xprism.altvivo.bio", "XPRISM's own session and form-protection cookies, created after AltVivo has signed you in.", "10 hours (sessionid), 1 year (csrftoken)"],
  ["__cf_bm, cf_clearance", "Cloudflare, on AltVivo hosts", "Bot protection for our network and the human check (Turnstile) on sign-in, sign-up and waitlist forms.", "30 minutes – 1 year"],
];

export default function CookiesPage() {
  const L = legalInfo();
  const table = (rows: Row[]) => (
    <table>
      <thead>
        <tr>
          <th>Cookie</th>
          <th>Set by / scope</th>
          <th>Purpose</th>
          <th>Lifetime</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, set, purpose, duration]) => (
          <tr key={name}>
            <td>
              <code>{name}</code>
            </td>
            <td>{set}</td>
            <td>{purpose}</td>
            <td>{duration}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Cookie Policy"
      effective={POLICY_EFFECTIVE}
      version={POLICY_VERSION}
      toc={TOC}
      intro={
        <p>
          AltVivo uses a small number of cookies, almost all of them strictly necessary to sign you in once and keep you secure across altvivo.bio and its
          applications. We do not use advertising cookies.
        </p>
      }
    >
      <h2 id="what">1. What cookies are</h2>
      <p>
        Cookies are small text files a website stores in your browser. Cookies set for the parent domain <code>.altvivo.bio</code> are sent to every AltVivo
        subdomain, which is how one sign-in works for XPRISM, aMaze and future applications. Similar technologies such as browser local storage are covered
        here too.
      </p>

      <h2 id="choices">2. Your choices</h2>
      <p>
        When you first visit, a banner lets you accept all cookies, reject the non-essential ones, or choose by category. Strictly necessary cookies cannot be
        switched off, because the Services cannot work without them. You can change your mind at any time; we record each choice, with the policy version, as
        evidence of consent.
      </p>
      <p>
        <CookieSettingsButton />
      </p>

      <h2 id="necessary">3. Strictly necessary cookies</h2>
      <p>These are essential for sign-in, licence checks, security and fraud prevention, and need no consent.</p>
      {table(NECESSARY)}

      <h2 id="payments">4. Payment processors</h2>
      <p>
        When you pay, the payment window is provided by <strong>Razorpay</strong>. It sets its own
        strictly necessary cookies on their domains (for example <code>razorpay.com</code>, <code>checkout.stripe.com</code>) for fraud prevention and to
        complete the payment securely. These are governed by Razorpay&apos;s privacy and cookie policy; AltVivo cannot read them.
      </p>

      <h2 id="optional">5. Optional cookies</h2>
      <ul>
        <li>
          <strong>Preferences:</strong> remembers choices such as light or dark mode. Without consent, the choice is kept only for the current browser tab.
        </li>
        <li>
          <strong>Analytics:</strong> if you allow it, the public pages of altvivo.bio load Google Analytics, which sets <code>_ga</code> and{" "}
          <code>_ga_&lt;ID&gt;</code> (up to 2 years) to count visits and pages. Nothing is loaded until you accept; withdrawing consent stops it and removes
          those cookies. Signed-in pages (workspace, admin) are never measured and advertising features are switched off. XPRISM shows its own choice before
          loading Google Analytics on its public pages.
        </li>
        <li>
          <strong>Marketing:</strong> AltVivo does not use advertising or remarketing cookies.
        </li>
      </ul>
      <p>If we ever add optional cookies, we will list them here first and use them only after you consent.</p>

      <h2 id="storage">6. Browser storage</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Where</th>
            <th>Purpose</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>altvivo-theme</code>
            </td>
            <td>altvivo.bio</td>
            <td>Light, dark or system colour theme.</td>
            <td>Preferences (local storage only with consent; otherwise tab storage)</td>
          </tr>
          <tr>
            <td>
              <code>xprism-cookies</code>
            </td>
            <td>xprism.altvivo.bio</td>
            <td>Remembers your answer to XPRISM&apos;s analytics question.</td>
            <td>Strictly necessary</td>
          </tr>
          <tr>
            <td>
              <code>theme</code>
            </td>
            <td>amaze.altvivo.bio</td>
            <td>aMaze colour theme.</td>
            <td>Preferences</td>
          </tr>
          <tr>
            <td>
              <code>amaze:projects</code>, <code>amaze:project_*</code>, <code>amaze:settings</code>, <code>amaze:active_trial_setup</code>,{" "}
              <code>amaze:last_saved_trial</code>
            </td>
            <td>amaze.altvivo.bio</td>
            <td>Your aMaze projects, trial set-ups, tracking results and settings, kept in your own browser so you can continue work on this device.</td>
            <td>Strictly necessary (the feature you use)</td>
          </tr>
          <tr>
            <td>
              <code>amaze:user_profile</code>, <code>amaze:is_authenticated</code>, <code>amaze.anonymous-session</code>
            </td>
            <td>amaze.altvivo.bio</td>
            <td>Caches your name and email from your AltVivo session for display, and a random identifier for the current browser session; cleared or replaced at sign-out.</td>
            <td>Strictly necessary</td>
          </tr>
        </tbody>
      </table>

      <h2 id="browser">7. Browser controls</h2>
      <p>
        You can delete or block cookies in your browser settings. Blocking strictly necessary cookies will stop you from signing in or using the Applications.
        Deleting <code>altvivo_consent</code> makes the banner appear again.
      </p>

      <h2 id="contact">8. Contact</h2>
      <p>
        Questions about cookies: <a href={`mailto:${L.privacyEmail}`}>{L.privacyEmail}</a>. See also our <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalDoc>
  );
}
