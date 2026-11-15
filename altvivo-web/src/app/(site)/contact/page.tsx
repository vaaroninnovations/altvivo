import type { Metadata } from "next";
import { Building2, LifeBuoy, Mail, ShieldCheck } from "lucide-react";
import { ContactForm } from "@/components/contact";
import { CONTACT_CATEGORIES, type ContactCategory } from "@/lib/contact";
import { Address } from "@/components/legal";
import { Card, SectionHeading } from "@/components/ui";
import { legalInfo } from "@/lib/legal";
import { readSession } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact AltVivo for licences, institutional quotations, technical support, billing and privacy requests.",
};
export const dynamic = "force-dynamic";

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const L = legalInfo();
  const { session } = await readSession();
  const category = (CONTACT_CATEGORIES.find((c) => c.value === topic)?.value ?? "sales") as ContactCategory;
  const channels = [
    { Icon: Building2, title: "Licences & institutions", body: "Quotations, purchase orders, site licences.", email: L.salesEmail },
    { Icon: LifeBuoy, title: "Support & billing", body: "Help with XPRISM, aMaze, invoices and payments.", email: L.supportEmail },
    { Icon: ShieldCheck, title: "Privacy & grievances", body: `${L.grievanceName}: data requests and complaints.`, email: L.grievanceEmail },
  ];

  return (
    <div className="border-b border-line">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.3fr] lg:py-20">
        <div>
          <SectionHeading eyebrow="Contact" title="Talk to the AltVivo team">
            We reply within one working day. For an institutional quotation, tell us the number of seats and your procurement timeline.
          </SectionHeading>
          <ul className="mt-10 space-y-4">
            {channels.map(({ Icon, title, body, email }) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-line bg-surface p-5">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden />
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted">{body}</p>
                  <a href={`mailto:${email}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-accent-ink hover:underline">
                    <Mail className="size-3.5" aria-hidden /> {email}
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {L.address && (
            <div className="mt-8 text-sm text-muted">
              <p className="font-medium text-fg">{L.entity}</p>
              <Address value={L.address} />
            </div>
          )}
        </div>
        <Card className="p-6 sm:p-8">
          <h2 className="mb-6 text-lg font-semibold">Send us a message</h2>
          <ContactForm defaultCategory={category} defaultEmail={session?.email ?? ""} defaultName={session?.name ?? ""} />
        </Card>
      </div>
    </div>
  );
}
