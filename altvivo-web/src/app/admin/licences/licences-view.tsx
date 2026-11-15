"use client";

import { useState } from "react";
import { LoadState, PageHeader, useAdmin } from "@/components/admin/kit";
import { LICENSABLE_APPS, LicenceTable, type ManualLicence } from "@/components/admin/licences";
import { Alert } from "@/components/ui";

export function LicencesView() {
  const [app, setApp] = useState("");
  const [active, setActive] = useState(true);
  const qs = new URLSearchParams({ ...(app ? { appId: app } : {}), ...(active ? { active: "1" } : {}) }).toString();
  const { data, error, loading, reload } = useAdmin<{ licences: ManualLicence[] }>(`/v1/api/admin/licences${qs ? `?${qs}` : ""}`);

  return (
    <>
      <PageHeader
        title="Manual licences"
        description="Licences granted outside online checkout: NEFT/RTGS transfers, purchase orders, pilots and complimentary access. Grant new ones from a user's or an institution's page."
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select className="field w-44" value={app} onChange={(e) => setApp(e.target.value)} aria-label="Application">
          <option value="">All applications</option>
          {LICENSABLE_APPS.map((a) => (
            <option key={a.appId} value={a.appId}>
              {a.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[var(--accent)]" />
          In force only
        </label>
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          {data.licences.length >= 500 && (
            <div className="mb-4">
              <Alert tone="info">Showing the most recent 500 licences. Filter by application to narrow the list.</Alert>
            </div>
          )}
          <LicenceTable licences={data.licences} onChanged={reload} showHolder />
        </>
      )}
    </>
  );
}
