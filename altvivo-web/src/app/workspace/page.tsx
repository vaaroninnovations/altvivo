import { getCatalog } from "@/lib/server/core";
import { loadProtected, requestCurrency, viewerOf, type SearchParams } from "@/lib/server/protected";
import type { WorkspaceData } from "@/lib/types";
import { LauncherView } from "./launcher-view";

export const metadata = { title: "My applications" };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { session, data } = await loadProtected<WorkspaceData>("/workspace", sp, "/v1/api/workspace");
  const catalog = await getCatalog(await requestCurrency(sp.currency));
  const flash = sp.verified === "1" ? "verified" : sp.welcome === "1" ? "welcome" : sp.status === "success" ? "purchased" : null;
  return (
    <LauncherView
      data={data}
      catalog={catalog}
      viewer={viewerOf(session)}
      isAdmin={session.role === "SUPERADMIN"}
      flash={flash}
      notice={typeof sp.notice === "string" ? sp.notice : null}
    />
  );
}
