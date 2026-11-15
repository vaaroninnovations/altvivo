import Link from "next/link";
import { Building2, Fingerprint, KeyRound } from "lucide-react";
import { AppLogo, Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/client";

const POINTS = [
  { Icon: KeyRound, text: "One sign-in for every AltVivo application" },
  { Icon: Fingerprint, text: "Two-factor authentication and instant sign-out everywhere" },
  { Icon: Building2, text: "Institutional access with your college or university email" },
];

/** Shared by sign in, sign up, MFA and password reset. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="AltVivo home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
        </main>
        <p className="readout text-center text-[11px] text-subtle">Protected by Cloudflare Turnstile · TLS 1.3</p>
      </div>

      {/* Brand panel: always deep ink, in both themes. */}
      <aside className="relative hidden overflow-hidden bg-[#0d0a2c] text-white lg:flex lg:flex-col lg:justify-center" aria-hidden>
        <div className="aurora aurora-a -left-32 -top-40 h-[30rem] w-[30rem] opacity-50" />
        <div className="aurora aurora-b -bottom-40 -right-24 h-[32rem] w-[32rem] opacity-45" />

        <div className="relative mx-auto w-full max-w-lg px-12 py-16">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/altvivo-wordmark-dark.png" width={1200} height={392} alt="" className="h-16 w-auto" />

          <h2 className="mt-12 text-[2.6rem] leading-[1.08] text-white">
            One Identity.
            <br />
            <em className="italic text-[#c9b8ff]">Infinite Scientific Capabilities.</em>
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-white/70">
            Your AltVivo account opens every application you are licensed for, from molecular discovery to translational validation.
          </p>

          <ul className="mt-9 space-y-3.5">
            {POINTS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/5">
                  <Icon className="size-4 text-[#c9b8ff]" strokeWidth={1.75} />
                </span>
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-12 border-t border-white/10 pt-8">
            <p className="readout text-[11px] uppercase tracking-[0.16em] text-white/50">Included applications</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <AppLogo appId="xprism" name="XPRISM" className="h-16 border-white/10" />
              <AppLogo appId="amaze" name="aMaze" className="h-16 border-white/10" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
