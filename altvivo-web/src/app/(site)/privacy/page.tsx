import type { Metadata } from "next";
import { Address, LegalDoc } from "@/components/legal";
import { legalInfo, POLICY_EFFECTIVE, POLICY_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How AltVivo collects, uses, protects and shares personal data, under India's DPDP Act 2023 and the EU GDPR.",
};
export const dynamic = "force-dynamic";

const TOC = [
  { id: "who", label: "Who we are" },
  { id: "summary", label: "Summary" },
  { id: "data", label: "Data we collect" },
  { id: "research", label: "Research data" },
  { id: "purposes", label: "Purposes & legal bases" },
  { id: "cookies", label: "Cookies & single sign-on" },
  { id: "sharing", label: "Who we share with" },
  { id: "transfers", label: "International transfers" },
  { id: "security", label: "Security" },
  { id: "retention", label: "Retention" },
  { id: "rights", label: "Your rights" },
  { id: "children", label: "Children" },
  { id: "grievance", label: "Grievance Officer" },
  { id: "changes", label: "Changes" },
];

export default function PrivacyPage() {
  const L = legalInfo();
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Privacy Policy"
      effective={POLICY_EFFECTIVE}
      version={POLICY_VERSION}
      toc={TOC}
      intro={
        <p>
          This policy explains how {L.entity} handles personal data when you use altvivo.bio and the AltVivo applications on its subdomains. It is written to meet
          India&apos;s Digital Personal Data Protection Act, 2023 (DPDPA) and, for people in the European Economic Area and the United Kingdom, the General Data
          Protection Regulation (GDPR).
        </p>
      }
    >
      <h2 id="who">1. Who we are</h2>
      <p>
        <strong>{L.entity}</strong> (&quot;AltVivo&quot;, &quot;we&quot;, &quot;us&quot;) is the <strong>Data Fiduciary</strong> under the DPDPA and the{" "}
        <strong>controller</strong> under the GDPR for the personal data described here.
        {L.cin && <> Corporate Identity Number: {L.cin}.</>}
        {L.gstin && <> GSTIN: {L.gstin}.</>}
      </p>
      {L.address && (
        <p>
          Registered address: <Address value={L.address} />
        </p>
      )}
      <p>
        This policy covers the portal at <code>altvivo.bio</code>, the identity and billing service at <code>api.altvivo.bio</code>, and every application on an{" "}
        <code>*.altvivo.bio</code> subdomain, currently <strong>XPRISM</strong> (<code>xprism.altvivo.bio</code>) and <strong>aMaze</strong> (
        <code>amaze.altvivo.bio</code>). Where an institution buys a site licence for its members, the institution decides who receives a seat; we remain the
        Data Fiduciary for the account and service data described below.
      </p>
      <p>
        Questions about privacy: <a href={`mailto:${L.privacyEmail}`}>{L.privacyEmail}</a>.
      </p>

      <h2 id="summary">2. Summary</h2>
      <ul>
        <li>We collect what we need to run your account, the applications you license, billing and security. Nothing for advertising.</li>
        <li>Your research data (experiment work, uploaded videos, results, files) belongs to you and is used only to provide the service to you.</li>
        <li>We do not sell personal data and do not use your research data to train machine-learning models.</li>
        <li>One sign-in works across AltVivo subdomains through strictly necessary cookies; optional cookies are used only with your consent.</li>
        <li>Card, UPI and bank details are handled by Razorpay; we never see or store them.</li>
        <li>You can access, correct and erase your data, withdraw consent and raise a grievance at any time.</li>
      </ul>

      <h2 id="data">3. Personal data we collect</h2>
      <h3>3.1 Account and profile</h3>
      <p>
        Name, email address, institutional affiliation, role (for example student, researcher or principal investigator), optional ORCID iD, and your
        institution membership. Your password is never stored; we keep only an Argon2id hash of it.
      </p>
      <h3>3.2 Sign-in and security</h3>
      <p>
        Session records (time created and last used, IP address, browser user agent), whether two-factor authentication (TOTP) is enabled, an encrypted copy of
        your TOTP secret, hashed recovery codes, failed sign-in counts and temporary lockouts, and security events such as password changes. If you choose
        &quot;Sign in with Google&quot; or &quot;Sign in with ORCID&quot;, we receive your name, email address (Google) or ORCID iD, and whether the provider
        has verified your email.
      </p>
      <h3>3.3 Licences, billing and payments</h3>
      <p>
        Your licences and their periods; the billing details you enter for GST invoices (name, address, state, postal code, country, optional phone and GSTIN);
        invoices, proforma invoices and credit notes; and payment records (amount, currency, method such as &quot;upi&quot; or &quot;card&quot;, status and
        the processor&apos;s reference). Card numbers, UPI handles and bank-account details are collected directly by Razorpay under its own privacy
        policies.
      </p>
      <h3>3.4 Use of the applications</h3>
      <p>
        In XPRISM: the experiments you open, your attempts, answers, scores and assignments. In aMaze: videos are analysed in your own browser, and your
        projects, arena and zone settings and tracking results are kept in your browser&apos;s storage on that device; when server-side tracking is enabled for
        a video, that video is sent to AltVivo&apos;s tracking service for processing. Across apps: files you save to the AltVivo vault (name, type, size,
        checksum) and, where an app uses them, compute-credit transactions.
      </p>
      <h3>3.5 Communications and consent</h3>
      <p>
        Messages you send us through contact forms or email, requests for one month of free access (your name, email address, institution, role, the
        applications you asked for and how you plan to use them, kept as the record of who received a free month), and records of your cookie
        choices (a random identifier stored in your browser, the choices, the policy version, the time, your browser user agent and a one-way hash of your IP
        address).
      </p>

      <h2 id="research">4. Research data and isolation</h2>
      <p>
        &quot;Research data&quot; means the scientific content you create or upload: experiment work, recorded animal-behaviour videos, tracking outputs,
        reports and vault files. You keep all rights in it. We process it only to provide the application to you, for example to run tracking or render a
        report.
      </p>
      <ul>
        <li>
          <strong>Isolation.</strong> Research data is stored per account. Vault files can be read only by their owner; an institution&apos;s administrator sees
          which members hold seats, not the contents of members&apos; files.
        </li>
        <li>
          <strong>Course features.</strong> Where an application is designed for teaching, the staff of your institution can see the results that feature is
          meant to share, for example XPRISM assignments and marks within their own batches.
        </li>
        <li>
          <strong>No secondary use.</strong> We do not sell research data, share it with other customers, publish it, or use it to train machine-learning models.
        </li>
        <li>
          <strong>Animal data.</strong> Videos of laboratory animals are not personal data, but they may show people; please avoid recording identifiable
          individuals, and ensure you have the approvals your animal-ethics committee requires.
        </li>
      </ul>

      <h2 id="purposes">5. Why we use personal data, and on what basis</h2>
      <table>
        <thead>
          <tr>
            <th>Purpose</th>
            <th>DPDPA basis</th>
            <th>GDPR basis</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Create and run your account, single sign-on and the licensed applications</td>
            <td>Consent given when you register, for this specified purpose</td>
            <td>Performance of a contract (Art. 6(1)(b))</td>
          </tr>
          <tr>
            <td>Check licences on every visit, administer institutional seats</td>
            <td>Consent; for institution-assigned seats, the use for which you were provided the seat (s.7(a))</td>
            <td>Contract; legitimate interests of the institution and of AltVivo (Art. 6(1)(f))</td>
          </tr>
          <tr>
            <td>Billing, GST invoices, accounting and tax records</td>
            <td>Compliance with law (s.7(c)–(d))</td>
            <td>Legal obligation (Art. 6(1)(c))</td>
          </tr>
          <tr>
            <td>Security: preventing fraud, abuse and credential sharing; audit trail; incident response</td>
            <td>Legitimate uses including security and compliance (s.7)</td>
            <td>Legitimate interests (Art. 6(1)(f)); legal obligation</td>
          </tr>
          <tr>
            <td>Service emails (verification, receipts, security alerts, licence renewal reminders)</td>
            <td>Consent for the account; necessary for the service</td>
            <td>Contract</td>
          </tr>
          <tr>
            <td>Optional preference, analytics or marketing cookies</td>
            <td>Your consent through the cookie banner</td>
            <td>Consent</td>
          </tr>
        </tbody>
      </table>
      <p>
        You may withdraw consent at any time (see <a href="#rights">section 11</a>). Withdrawal does not affect processing already carried out, and we may still
        keep records the law requires, such as invoices.
      </p>

      <h2 id="cookies">6. Cookies and single sign-on across subdomains</h2>
      <p>
        Signing in at altvivo.bio sets strictly necessary cookies for the parent domain <code>.altvivo.bio</code> so that every AltVivo application recognises you
        without another sign-in: <code>altvivo_at</code> (a 15-minute signed access token) and <code>altvivo_csrf</code> (form protection), plus{" "}
        <code>altvivo_rt</code> (a rotating 7-day refresh token readable only by <code>api.altvivo.bio</code>). Each application receives your identity and
        licence status only; it never receives your password or refresh token. Optional cookies are used only with consent. Full details are in the{" "}
        <a href="/cookies">Cookie Policy</a>.
      </p>

      <h2 id="sharing">7. Who we share personal data with</h2>
      <p>We share only what each recipient needs, under contracts that require them to protect it:</p>
      <ul>
        <li>
          <strong>Payment processor:</strong> Razorpay, to take payments and handle refunds.
        </li>
        <li>
          <strong>Cloudflare:</strong> network delivery and protection, DNS, bot verification on sign-in and sign-up forms (Turnstile), and encrypted object
          storage for files and invoice PDFs.
        </li>
        <li>
          <strong>Our hosting provider</strong>, which operates the servers that run AltVivo, and <strong>our email delivery provider</strong>, which sends
          service emails.
        </li>
        <li>
          <strong>Google or ORCID</strong>, only if you choose to sign in with them.
        </li>
        <li>
          <strong>Your institution</strong>, if you hold a seat on its site licence: your name, email, role and seat status.
        </li>
        <li>
          <strong>Authorities and advisers</strong>, where the law requires it or to establish, exercise or defend legal claims, and professional advisers bound
          by confidentiality.
        </li>
        <li>
          <strong>A successor</strong>, if AltVivo is merged or sold, with notice to you and subject to this policy.
        </li>
      </ul>
      <p>We do not sell personal data and we do not share it for advertising.</p>

      <h2 id="transfers">8. International transfers</h2>
      <p>
        Some of our service providers process data outside India or outside your country. Under the DPDPA we do not transfer personal data to any country the
        Central Government has restricted. For data of people in the EEA or UK, transfers rely on an adequacy decision or on the European Commission&apos;s
        Standard Contractual Clauses (with the UK addendum), together with the safeguards described below.
      </p>

      <h2 id="security">9. How we protect personal data</h2>
      <ul>
        <li>TLS 1.3 encryption for all traffic to altvivo.bio and its subdomains.</li>
        <li>Passwords hashed with Argon2id; TOTP secrets encrypted with AES-256-GCM; refresh tokens and one-time codes stored only as keyed hashes.</li>
        <li>Two-factor authentication is mandatory for institution and platform administrators; sensitive administrative changes need a fresh code and a reason.</li>
        <li>Least-privilege database roles, and a tamper-evident, SHA-256 hash-chained audit log of security, licence and billing events.</li>
        <li>Uploads go directly to encrypted object storage with signed size, type and checksum, and are checked again after upload.</li>
        <li>Encrypted backups, stored apart from the production servers.</li>
      </ul>
      <p>
        If a personal data breach occurs, we will inform the Data Protection Board of India and the affected users as the DPDPA and its rules require, and, where
        the GDPR applies, the competent supervisory authority within 72 hours of becoming aware of it.
      </p>

      <h2 id="retention">10. How long we keep data</h2>
      <ul>
        <li>
          <strong>Account and research data:</strong> while your account is open. When you close it or ask us to erase it, we delete it within 30 days, except
          what the law requires us to keep.
        </li>
        <li>
          <strong>Invoices, payments and tax records:</strong> for the period Indian tax law requires (the CGST Act requires records to be kept for 72 months
          from the due date of the annual return for the year concerned).
        </li>
        <li>
          <strong>Security and audit records:</strong> the audit trail is append-only so that it can prove nothing was altered; entries keep your account
          identifier for as long as needed for security, compliance and legal claims, and no longer than eight years.
        </li>
        <li>
          <strong>Sessions:</strong> sign-in sessions end after at most 30 days; expired refresh tokens and one-time links are deleted within 7 days of expiry.
        </li>
        <li>
          <strong>Contact messages:</strong> until the request is resolved, and then for up to 24 months.
        </li>
        <li>
          <strong>Consent records:</strong> for as long as the choice applies and 24 months after you change it, as evidence of the consent given.
        </li>
      </ul>

      <h2 id="rights">11. Your rights</h2>
      <p>Under the DPDPA you have the right to:</p>
      <ul>
        <li>obtain a summary of the personal data we process about you and the processing activities, and the identities of those we have shared it with;</li>
        <li>correct, complete or update it, and have it erased when it is no longer needed for the purpose or you withdraw consent;</li>
        <li>withdraw consent as easily as you gave it;</li>
        <li>have a grievance addressed by our Grievance Officer, and then by the Data Protection Board of India;</li>
        <li>nominate another person to exercise these rights if you die or become incapable.</li>
      </ul>
      <p>
        If the GDPR applies to you, you also have the rights of access, rectification, erasure, restriction, data portability and objection, the right not to be
        subject to solely automated decisions with legal effects (we make none), and the right to complain to your data protection authority.
      </p>
      <p>
        To exercise a right, write to <a href={`mailto:${L.privacyEmail}`}>{L.privacyEmail}</a> from the email address on your account, or use the account
        and security pages of your workspace. We may ask you to confirm your identity. We respond within 30 days.
      </p>

      <h2 id="children">12. Children</h2>
      <p>
        AltVivo is intended for adults in higher education and research. We do not knowingly create accounts for people under 18 without the verifiable consent
        of a parent or lawful guardian, which an institution must obtain and confirm before enrolling such a student. We do not track, profile or target
        advertising at children.
      </p>

      <h2 id="grievance">13. Grievance Officer</h2>
      <p>For complaints or concerns about how we handle your personal data, contact our Grievance Officer:</p>
      <p>
        <strong>{L.grievanceName}</strong>, {L.entity}
        <br />
        Email: <a href={`mailto:${L.grievanceEmail}`}>{L.grievanceEmail}</a>
        {L.grievancePhone && (
          <>
            <br />
            Phone: {L.grievancePhone}
          </>
        )}
        {L.address && <Address value={L.address} />}
      </p>
      <p>
        We acknowledge grievances within two working days and aim to resolve them within 30 days. If you are not satisfied with our response, you may complain to
        the Data Protection Board of India.
      </p>

      <h2 id="changes">14. Changes to this policy</h2>
      <p>
        We will post any change here with a new version and date. If a change materially affects how we use your data, we will tell you by email or in the
        workspace before it takes effect and, where the law requires, ask for your consent again.
      </p>
    </LegalDoc>
  );
}
