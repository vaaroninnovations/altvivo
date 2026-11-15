import type { Metadata } from "next";
import { Mail, Users } from "lucide-react";
import { MemberCard } from "@/components/advisory";
import { ButtonLink, SectionHeading } from "@/components/ui";
import { getAdvisoryBoard } from "@/lib/server/core";

export const metadata: Metadata = {
  title: "Scientific Advisory Board",
  description: "The pharmacologists, toxicologists, animal-ethics committee members and academic leaders who advise AltVivo.",
};

export const revalidate = 120;

export default async function AdvisoryBoardPage() {
  const members = await getAdvisoryBoard();
  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading eyebrow="Scientific Advisory Board" title="The scientists who keep AltVivo honest">
            Our advisors review how experiments are simulated, how behaviour is scored and how AltVivo supports the 3Rs in teaching and
            research. They are independent of day-to-day operations and serve in an advisory capacity.
          </SectionHeading>
          <p className="readout mt-6 text-sm text-subtle">
            {members.length === 1 ? "1 advisor" : `${members.length} advisors`}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        {members.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {members.map((m) => (
              <MemberCard key={m.slug} member={m} />
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-10 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-ink">
              <Users className="size-6" aria-hidden />
            </div>
            <h2 className="mt-5 text-xl font-semibold">Board members are being confirmed</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              We publish each advisor here once they have agreed to their profile. Researchers interested in advising AltVivo are welcome to write to us.
            </p>
            <ButtonLink href="/contact?topic=partnership" variant="outline" className="mt-6">
              <Mail className="size-4" aria-hidden /> Contact us
            </ButtonLink>
          </div>
        )}
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
          {[
            ["Scientific validity", "Advisors review experiment models, expected responses and teaching notes against published pharmacology."],
            ["Ethics and the 3Rs", "Members with animal-ethics committee experience advise on where simulation can replace, reduce or refine animal use."],
            ["Independence", "Advisors receive complimentary access to the AltVivo applications to review them. The role gives no access to other users' accounts or data."],
          ].map(([title, body]) => (
            <div key={title}>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
