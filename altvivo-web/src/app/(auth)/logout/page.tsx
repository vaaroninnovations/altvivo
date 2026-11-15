"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/config";

/**
 * Central sign-out. Spokes (XPRISM, aMaze, the top bar) send users here with
 * ?next=<where to land>. Ends the session at the IdP - which clears the shared
 * .altvivo.bio cookies and revokes the session for every app - then continues.
 */
function SignOut() {
  const next = safeNext(useSearchParams().get("next"), "/");
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        new BroadcastChannel("altvivo-session").postMessage({ type: "signedout" });
      } catch {
        /* unsupported */
      }
      window.location.replace(next);
    };
    api("/v1/auth/logout", { method: "POST", retryOnExpiry: false }).then(finish, finish);
    const t = setTimeout(finish, 5000);
    return () => clearTimeout(t);
  }, [next]);
  return null;
}

export default function LogoutPage() {
  return (
    <div className="flex flex-col items-center text-center" role="status">
      <Loader2 className="size-8 animate-spin text-accent-ink" aria-hidden />
      <h1 className="mt-6 text-2xl font-semibold">Signing you out of AltVivo…</h1>
      <p className="mt-2 text-sm text-muted">This ends your session on every AltVivo application.</p>
      <Suspense>
        <SignOut />
      </Suspense>
    </div>
  );
}
