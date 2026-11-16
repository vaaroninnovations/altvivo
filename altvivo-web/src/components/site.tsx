import { ArrowRight, LayoutGrid } from "lucide-react";
import { portal } from "@/lib/config";
import { legalInfo } from "@/lib/legal";
import { readSession } from "@/lib/server/session";
import { Logo } from "./brand";
import { ThemeToggle } from "./client";
import { CookiePreferencesLink } from "./consent";
import { MobileNav } from "./mobile-nav";
import { ButtonLink } from "./ui";

export const NAV = [
  { href: "/about", label: "About us" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Documentation" },
];

/** Public header. `absolute` builds full portal URLs (used on app subdomains). */
export async function SiteHeader({ absolute = false }: { absolute?: boolean }) {
  const state = await readSession();
  const href = (p: string) => (absolute ? portal(p) : p);
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/75 backdrop-blur-xl backdrop-saturate-150">
      <div className="brand-gradient h-0.5 w-full" aria-hidden />
      <div className="relative mx-auto flex h-[4.25rem] max-w-7xl items-center gap-6 px-4 sm:px-6">
        <a href={href("/")} className="shrink-0" aria-label="AltVivo home">
          <Logo />
        </a>
        <nav aria-label="Main" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={href(n.href)} className="rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          {state.session ? (
            <ButtonLink href={href("/workspace")} size="sm" external={absolute}>
              <LayoutGrid className="size-4" aria-hidden /> Workspace
            </ButtonLink>
          ) : (
            <>
              <a href={href("/login")} className="hidden whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-fg sm:inline">
                Sign in
              </a>
              <ButtonLink href={href("/free-month")} size="sm" external={absolute}>
                Start free <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
            </>
          )}
          <MobileNav items={NAV.map((n) => ({ ...n, href: href(n.href) }))} signInHref={state.session ? null : href("/login")} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ absolute = false }: { absolute?: boolean }) {
  const href = (p: string) => (absolute ? portal(p) : p);
  const year = new Date().getFullYear();
  const col = (title: string, links: [string, string][]) => (
    <div>
      <p className="eyebrow">{title}</p>
      <ul className="mt-4 space-y-2 text-sm">
        {links.map(([label, to]) => (
          <li key={label}>
            <a className="text-muted hover:text-fg" href={to}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="border-t border-line bg-surface/80 backdrop-blur-sm">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Logo className="[&_img]:h-10" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            The unified digital infrastructure for life sciences, preclinical discovery and scientific education. Alternative to in-vivo, built in-silico and in-vitro.
          </p>
          <p className="mt-5 max-w-sm border-l-2 border-accent/40 pl-4 font-serif text-[1.05rem] italic leading-snug text-fg/80">
            One Identity. Infinite Scientific Capabilities.
          </p>
          <div className="mt-5 sm:hidden">
            <ThemeToggle />
          </div>
        </div>
        {col("Platform", [
          ["XPRISM", "https://xprism.altvivo.bio"],
          ["aMaze", "https://amaze.altvivo.bio"],
          ["One month free", href("/free-month")],
          ["Pricing", href("/pricing")],
          ["Documentation", href("/docs")],
        ])}
        {col("Company", [
          ["About us", href("/about")],
          ["Advisory Board", href("/about#advisory-board")],
          ["Contact", href("/contact")],
          ["Workspace", href("/workspace")],
          ["Sign in", href("/login")],
        ])}
        <div>
          <p className="eyebrow">Legal</p>
          <ul className="mt-4 space-y-2 text-sm">
            {(
              [
                ["Privacy Policy", "/privacy"],
                ["Terms & Conditions", "/terms"],
                ["Refunds & cancellation", "/terms#refunds"],
                ["Cookie Policy", "/cookies"],
                ["Grievance Officer", "/privacy#grievance"],
              ] as const
            ).map(([label, to]) => (
              <li key={label}>
                <a className="text-muted hover:text-fg" href={href(to)}>
                  {label}
                </a>
              </li>
            ))}
            {!absolute && (
              <li>
                <CookiePreferencesLink />
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {year} {legalInfo().entity}. AltVivo is a product of {legalInfo().entity}.</p>
        </div>
      </div>
    </footer>
  );
}
