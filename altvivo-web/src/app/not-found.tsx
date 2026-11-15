import Link from "next/link";
import { Logo } from "@/components/brand";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <Logo className="justify-center" />
        <p className="readout mt-10 text-6xl text-accent-ink">404</p>
        <h1 className="mt-4 text-2xl font-semibold">This page does not exist</h1>
        <p className="mt-2 text-muted">The link may be outdated, or you may not have access to it.</p>
        <Link href="/" className={buttonClass("primary", "md", "mt-8")}>
          Go to altvivo.bio
        </Link>
      </div>
    </main>
  );
}
