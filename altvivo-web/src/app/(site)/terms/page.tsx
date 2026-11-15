import type { Metadata } from "next";
import { Address, LegalDoc } from "@/components/legal";
import { legalInfo, POLICY_EFFECTIVE, POLICY_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "Licence terms for AltVivo: single-user and institutional licences, acceptable use, fees and GST, refunds and cancellation, and governing law.",
};
export const dynamic = "force-dynamic";

const TOC = [
  { id: "agreement", label: "The agreement" },
  { id: "definitions", label: "Definitions" },
  { id: "accounts", label: "Accounts & security" },
  { id: "licences", label: "Licences & seats" },
  { id: "use", label: "Acceptable use & no sharing" },
  { id: "science", label: "Educational & research use" },
  { id: "content", label: "Your content" },
  { id: "ip", label: "Intellectual property" },
  { id: "fees", label: "Fees, GST & renewals" },
  { id: "refunds", label: "Refunds & cancellation" },
  { id: "service", label: "Availability & support" },
  { id: "termination", label: "Suspension & termination" },
  { id: "liability", label: "Warranties & liability" },
  { id: "indemnity", label: "Indemnity" },
  { id: "law", label: "Governing law & disputes" },
  { id: "general", label: "General" },
];

export default function TermsPage() {
  const L = legalInfo();
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Terms & Conditions"
      effective={POLICY_EFFECTIVE}
      version={POLICY_VERSION}
      toc={TOC}
      intro={<p>These terms govern your access to and use of AltVivo. Please read them before buying a licence; buying or using a licence means you accept them.</p>}
    >
      <h2 id="agreement">1. The agreement</h2>
      <p>
        These Terms &amp; Conditions (&quot;Terms&quot;) are an agreement between <strong>{L.entity}</strong> (&quot;AltVivo&quot;, &quot;we&quot;,
        &quot;us&quot;) and the person or organisation that creates an account or buys a licence (&quot;you&quot;). If you accept them on behalf of an
        institution, you confirm you are authorised to bind it. Our <a href="/privacy">Privacy Policy</a> and <a href="/cookies">Cookie Policy</a> form part of
        these Terms. A signed agreement or accepted purchase order with an institution prevails over these Terms where the two conflict.
      </p>

      <h2 id="definitions">2. Definitions</h2>
      <ul>
        <li>
          <strong>Services</strong>: the portal at altvivo.bio, the AltVivo account and billing service, and the Applications.
        </li>
        <li>
          <strong>Applications</strong>: the software offered on <code>*.altvivo.bio</code> subdomains, currently XPRISM and aMaze, and any application we add.
        </li>
        <li>
          <strong>Licence</strong>: the right to use one or more Applications for a paid period (&quot;Term&quot;), as shown on your invoice.
        </li>
        <li>
          <strong>User</strong>: an individual with an AltVivo account. <strong>Seat</strong>: the right of one named User to use an institutional Licence.
        </li>
        <li>
          <strong>Your Content</strong>: data, files, videos and results you create in or upload to the Services.
        </li>
      </ul>

      <h2 id="accounts">3. Accounts and security</h2>
      <ul>
        <li>Each account belongs to one individual. Give accurate details and keep them current; licences can be bought only from a verified email address.</li>
        <li>Keep your password and authenticator private. Administrators of institutions and of the platform must use two-factor authentication.</li>
        <li>You are responsible for activity under your account. Tell us at once at <a href={`mailto:${L.supportEmail}`}>{L.supportEmail}</a> if you suspect misuse.</li>
        <li>You must be at least 18, or enrolled by your institution with the consent of a parent or lawful guardian.</li>
      </ul>

      <h2 id="licences">4. Licences and seats</h2>
      <h3>4.1 Grant</h3>
      <p>
        For the Term you have paid for, we grant you a non-exclusive, non-transferable, non-sublicensable licence to access and use the Applications included in
        your plan, through the Services, for your own teaching, learning or research. Access is checked on every visit and ends automatically when the Term ends
        or the Licence is cancelled or refunded.
      </p>
      <h3>4.2 Single-app and Dual-Suite licences</h3>
      <p>
        These are personal to one named User. They cover one Application (single-app) or XPRISM and aMaze together (Dual-Suite) and may not be shared, transferred
        or used by anyone else.
      </p>
      <h3>4.3 Institutional site licences</h3>
      <ul>
        <li>A site licence is bought by an institution for a number of Seats. Each Seat is used by one named User at a time.</li>
        <li>
          Members join with an email address on the institution&apos;s whitelisted domains or are added by its administrator, while Seats are available. Disabled
          members free their Seat; the administrator may reassign Seats, but not split one Seat between several people.
        </li>
        <li>The institution must not exceed its Seats; to add Users it can buy more Seats at the prevailing price, pro rata to the end of the Term where agreed.</li>
        <li>The institution is responsible for its administrators&apos; actions and for removing members who leave.</li>
      </ul>
      <h3>4.4 Complimentary access</h3>
      <p>
        We may give complimentary access, for example to members of our Scientific Advisory Board or for evaluation. It is personal, may be withdrawn at any time
        and creates no entitlement to future access.
      </p>

      <h2 id="use">5. Acceptable use and the no-sharing rule</h2>
      <p>You must not, and must not allow others to:</p>
      <ul>
        <li>share login credentials, let more than one person use a single-user Licence or Seat, or use one account from several people&apos;s devices;</li>
        <li>resell, rent, sublicense or provide the Applications to third parties, or use them to build a competing product;</li>
        <li>copy, scrape, frame or systematically download Application content, simulations, images or text, except exports the Application provides;</li>
        <li>reverse engineer, decompile or bypass the licence check, rate limits or other technical protections;</li>
        <li>upload unlawful material, material you have no right to use, malware, or personal data of others without a lawful basis;</li>
        <li>interfere with the Services, probe them for vulnerabilities (except through responsible disclosure to {L.supportEmail}) or overload them.</li>
      </ul>
      <p>
        We may review sign-in activity for signs of credential sharing or abuse, such as many concurrent sessions or sign-ins from distant locations, and may
        then require re-authentication, end sessions or suspend an account under section 12.
      </p>

      <h2 id="science">6. Educational and research use: important limits</h2>
      <ul>
        <li>
          <strong>Simulations are models.</strong> XPRISM experiments simulate pharmacological responses for teaching and planning. They illustrate expected
          behaviour; they are not experimental data and are not a substitute for studies required by regulators, unless a regulator has accepted them for your
          purpose.
        </li>
        <li>
          <strong>Analysis needs your judgement.</strong> aMaze tracking and metrics are produced automatically from your videos. You are responsible for
          checking them, choosing appropriate statistics and validating results before relying on or publishing them.
        </li>
        <li>
          <strong>Animal work.</strong> Using AltVivo does not replace approvals from your Institutional Animal Ethics Committee, CCSEA or other authorities. You
          are responsible for obtaining them for any animal work, including the recording of videos you upload.
        </li>
        <li>
          <strong>Not for clinical use.</strong> The Services are not medical devices and must not be used to diagnose, treat or make decisions about patients.
        </li>
        <li>
          <strong>Regulatory alignment.</strong> Where we describe content as aligned with CCSEA guidance or the PCI curriculum, we mean it was designed with
          them in mind; it is not an approval or certification by those bodies.
        </li>
      </ul>

      <h2 id="content">7. Your content</h2>
      <p>
        You own Your Content. You grant us a limited licence to host, copy, process and display it only as needed to provide and secure the Services for you and
        your institution. We do not sell it, show it to other customers or use it to train machine-learning models. You confirm you have the rights and approvals
        needed for Your Content. You can export it while your account is open and ask us to delete it as described in the Privacy Policy.
      </p>

      <h2 id="ip">8. Intellectual property</h2>
      <p>
        The Services, Applications, simulations, models, text, graphics, software and the AltVivo, XPRISM and aMaze names and logos belong to AltVivo or its
        licensors and are protected by intellectual-property laws. Apart from the Licence, no rights are granted. If you send us suggestions, we may use them
        without obligation to you.
      </p>

      <h2 id="fees">9. Fees, GST and renewals</h2>
      <ul>
        <li>
          Prices are shown on the <a href="/pricing">pricing page</a> and <strong>exclude GST</strong>. Customers in India pay GST at the applicable rate (CGST
          and SGST, or IGST) and receive a GST tax invoice; add your GSTIN before paying for a B2B invoice. Customers outside India are billed in US dollars as a
          zero-rated export of services; any local taxes or bank charges in your country are your responsibility.
        </li>
        <li>
          The billing country of your billing details decides the currency: India is billed in INR through Razorpay, other countries in USD through Stripe. Card,
          UPI and bank details are handled by the payment processor under its own terms.
        </li>
        <li>
          <strong>Prepaid Terms.</strong> Most Licences are prepaid for a month or a year and do not renew automatically. You can renew before the Term ends; the
          new Term then starts when the current one ends. We send a reminder before a prepaid Term ends.
        </li>
        <li>
          <strong>Automatic renewal.</strong> Plans shown as renewing automatically are charged at the start of each period until you cancel renewal in Billing;
          cancellation takes effect at the end of the current period.
        </li>
        <li>
          <strong>Institutions.</strong> A proforma invoice is a quotation, valid for the period printed on it. The Licence starts when we receive payment in
          full and issue the tax invoice. Price changes do not affect a proforma within its validity.
        </li>
        <li>We may change prices for future Terms; the price you paid applies to the current Term.</li>
      </ul>

      <h2 id="refunds">10. Refund and cancellation policy</h2>
      <ol>
        <li>
          <strong>First purchase, 7 days.</strong> If you buy a single-app or Dual-Suite plan for the first time, you may cancel within 7 days of payment for a
          full refund.
        </li>
        <li>
          <strong>Renewals.</strong> Renewal payments and later purchases are not refundable once the Term has started, except where the Services were
          unavailable for a substantial part of the Term because of our fault, in which case we refund the unused part pro rata.
        </li>
        <li>
          <strong>Cancelling renewal.</strong> You can stop an automatic renewal at any time; access continues until the end of the period already paid for.
        </li>
        <li>
          <strong>Site licences.</strong> An institutional Licence may be cancelled for a full refund before any member has used it, and within 7 days of
          activation. After that, refunds follow the purchase order or written agreement; without one, unused Seats are not refundable.
        </li>
        <li>
          <strong>Duplicate or failed payments.</strong> If you are charged twice, or charged for a payment that did not activate a Licence, we refund the extra
          amount in full.
        </li>
        <li>
          <strong>How to ask.</strong> Email <a href={`mailto:${L.supportEmail}`}>{L.supportEmail}</a> from your account email with the invoice number. Approved
          refunds are made to the original payment method within 5–7 working days of approval (your bank or card issuer may take longer to show it). A GST credit
          note is issued for every refund.
        </li>
        <li>
          <strong>Effect.</strong> A full refund ends the Licence immediately. Your account and Your Content remain available.
        </li>
      </ol>
      <p>
        AltVivo provides digital services only; nothing is shipped. Licences are delivered electronically and activate as soon as payment is confirmed.
      </p>

      <h2 id="service">11. Availability and support</h2>
      <p>
        We aim to keep the Services available at all times but do not guarantee uninterrupted operation. We may carry out maintenance, during which an
        Application can be temporarily unavailable; we schedule planned work outside teaching hours where we can and announce it in advance. Support is provided
        by email at <a href={`mailto:${L.supportEmail}`}>{L.supportEmail}</a>. Service levels apply only if agreed in writing.
      </p>

      <h2 id="termination">12. Suspension and termination</h2>
      <ul>
        <li>You may close your account at any time. Closing does not by itself refund a paid Term (see section 10).</li>
        <li>
          We may suspend or end an account, Licence or Seat if you materially breach these Terms (including section 5), do not pay, or if we must do so by law.
          Where reasonable, we will warn you first and give you an opportunity to fix the problem.
        </li>
        <li>
          Termination for your breach does not entitle you to a refund. Sections 6, 7, 8, 13, 14 and 15 survive termination.
        </li>
      </ul>

      <h2 id="liability">13. Warranties and limitation of liability</h2>
      <p>
        We will provide the Services with reasonable skill and care. Otherwise, to the extent the law allows, the Services are provided &quot;as is&quot; and we
        disclaim implied warranties of merchantability, fitness for a particular purpose and non-infringement.
      </p>
      <p>
        To the extent the law allows: (a) neither party is liable for indirect, incidental, special or consequential loss, or for loss of profits, revenue, data
        or goodwill; and (b) our total liability arising from these Terms in any 12-month period is limited to the fees you paid us for the Services in that
        period. Nothing in these Terms limits liability for fraud, for death or personal injury caused by negligence, or any liability that cannot be limited by
        law, and nothing affects your statutory rights as a consumer.
      </p>

      <h2 id="indemnity">14. Indemnity</h2>
      <p>
        You will indemnify AltVivo against third-party claims arising from Your Content or from your use of the Services in breach of these Terms or the law,
        provided we notify you promptly, let you control the defence and cooperate reasonably.
      </p>

      <h2 id="law">15. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of India. Before starting proceedings, the parties will try in good faith for 30 days to resolve a dispute, starting
        with a written notice to <a href={`mailto:${L.supportEmail}`}>{L.supportEmail}</a> or to our Grievance Officer. A dispute that is not resolved will be
        referred to arbitration by a sole arbitrator under the Arbitration and Conciliation Act, 1996, seated in {L.jurisdictionCity}, conducted in English.
        Subject to that, the courts at {L.jurisdictionCity} have exclusive jurisdiction, including for urgent interim relief. This clause does not take away any
        right you have to approach a consumer commission or the Data Protection Board of India.
      </p>

      <h2 id="general">16. General</h2>
      <ul>
        <li>
          <strong>Changes.</strong> We may update these Terms; we will post the new version here and notify you of material changes before they apply to your
          next Term.
        </li>
        <li>
          <strong>Notices.</strong> We send notices to your account email; you can send notices to {L.supportEmail}
          {L.address ? " or to our registered address" : ""}.
        </li>
        <li>
          <strong>Force majeure.</strong> Neither party is liable for delay caused by events beyond its reasonable control.
        </li>
        <li>
          <strong>Assignment.</strong> You may not assign these Terms without our consent; we may assign them to a successor of our business.
        </li>
        <li>
          <strong>Entire agreement and severability.</strong> These Terms are the whole agreement on their subject; if a provision is unenforceable, the rest
          remains in effect.
        </li>
      </ul>
      {L.address && (
        <p>
          {L.entity}
          <Address value={L.address} />
        </p>
      )}
    </LegalDoc>
  );
}
