"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-3 text-2xl font-semibold">We could not load this page</h1>
        <p className="mt-2 text-muted">Please try again. If it keeps happening, contact support@altvivo.bio{error.digest ? " and quote the reference below" : ""}.</p>
        {error.digest && <p className="readout mt-4 text-xs text-subtle">ref {error.digest}</p>}
        <Button className="mt-8" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
