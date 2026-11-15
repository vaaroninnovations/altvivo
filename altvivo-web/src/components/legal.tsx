import type { ReactNode } from "react";

/** Long-form policy layout: title block, sticky table of contents, `.legal` prose. */
export function LegalDoc({
  eyebrow,
  title,
  intro,
  effective,
  version,
  toc,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  effective: string;
  version: string;
  toc: { id: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-16">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          <div className="mt-5 max-w-3xl text-lg leading-relaxed text-muted">{intro}</div>
          <p className="readout mt-6 text-xs text-subtle">
            Effective {effective} · version {version}
          </p>
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="eyebrow">On this page</p>
            <ol className="mt-4 space-y-2 text-sm">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="text-muted hover:text-fg">
                    {t.label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
        <article className="legal min-w-0 max-w-3xl">{children}</article>
      </div>
    </>
  );
}

/** Multi-line postal address from configuration. */
export function Address({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className="block whitespace-pre-line">{value}</span>
  );
}
