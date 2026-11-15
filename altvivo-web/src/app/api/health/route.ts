export const dynamic = "force-dynamic";

/** Liveness for the container healthcheck (does not depend on altvivo-core). */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
