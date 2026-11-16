import { isAvailable } from "@/lib/catalog";
import { getCatalog } from "@/lib/server/core";
import { loadProtected, requestCurrency, viewerOf, type SearchParams } from "@/lib/server/protected";
import type { WorkspaceData } from "@/lib/types";
import { UpgradeView } from "./upgrade-view";

export const metadata = { title: "Unlock an application" };

/** Target of the access gate (free month over, or no plan): /workspace/upgrade?app=<id>&reason=subscription_required|subscription_expired */
export default async function UpgradePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { session, data } = await loadProtected<WorkspaceData>("/workspace/upgrade", sp, "/v1/api/workspace");
  const catalog = await getCatalog(await requestCurrency(sp.currency));
  const live = data.apps.filter(isAvailable);
  const appId = typeof sp.app === "string" ? sp.app : "";
  return (
    <UpgradeView
      app={live.find((a) => a.appId === appId) ?? null}
      apps={live}
      catalog={catalog}
      viewer={viewerOf(session)}
      trial={data.trial}
      trialDays={data.trialDays}
      reason={typeof sp.reason === "string" ? sp.reason : null}
      cancelled={sp.status === "cancelled"}
    />
  );
}
