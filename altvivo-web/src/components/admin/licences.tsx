"use client";

import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { Dialog } from "../client";
import { Alert, Button, Field, Pill, formatDate } from "../ui";
import { Table, addDays, endOfDayIst, isoDate, useSigner } from "./kit";

export interface ManualLicence {
  id: string;
  appId: string;
  userId: string | null;
  orgId: string | null;
  startsAt: string;
  expiresAt: string;
  grantedAt: string;
  grantedBy: string;
  reason: string;
  reference: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  user?: { email: string; fullName: string } | null;
  organization?: { name: string } | null;
}

export const LICENSABLE_APPS = [
  { appId: "xprism", name: "XPRISM" },
  { appId: "amaze", name: "aMaze" },
];
const appName = (id: string) => LICENSABLE_APPS.find((a) => a.appId === id)?.name ?? id;

export function licenceState(l: ManualLicence): { label: string; tone: "live" | "muted" | "soon" | "danger" } {
  if (l.revokedAt) return { label: "Revoked", tone: "danger" };
  const now = Date.now();
  if (new Date(l.startsAt).getTime() > now) return { label: "Scheduled", tone: "soon" };
  if (new Date(l.expiresAt).getTime() <= now) return { label: "Expired", tone: "muted" };
  return { label: "Active", tone: "live" };
}

/** Offline licence (NEFT / RTGS / PO): app, custom start and expiry, reason and payment reference. */
export function GrantLicenceDialog({
  open,
  onClose,
  holder,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  holder: { userId: string; label: string } | { orgId: string; label: string };
  onDone: () => void;
}) {
  const sign = useSigner();
  const [app, setApp] = useState("xprism");
  const [starts, setStarts] = useState(isoDate(new Date()));
  const [expires, setExpires] = useState(isoDate(addDays(365)));
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (expires <= starts) return setError("The expiry date must be after the start date.");
    setError(null);
    sign({
      title: `Grant ${appName(app)} to ${holder.label}`,
      description: `Valid ${formatDate(starts)} – ${formatDate(expires)} (end of day, IST). Each application is a separate, separately signed licence.`,
      defaultReason: reference ? `Offline payment, reference ${reference}` : "",
      run: async ({ totpCode, reason }) => {
        await api("/v1/api/admin/licences", {
          method: "POST",
          body: {
            appId: app,
            ...("userId" in holder ? { userId: holder.userId } : { orgId: holder.orgId }),
            startsAt: new Date(`${starts}T00:00:00+05:30`).toISOString(),
            expiresAt: endOfDayIst(expires),
            reason,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            totpCode,
          },
        });
        onDone();
        onClose();
      },
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Grant a manual licence · ${holder.label}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">For offline payments (NEFT, RTGS, cheque or purchase order) and agreed complimentary access. The licence is audited and can be revoked, never deleted.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Application" id="lic-app">
          <select id="lic-app" className="field" value={app} onChange={(e) => setApp(e.target.value)}>
            {LICENSABLE_APPS.map((a) => (
              <option key={a.appId} value={a.appId}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" id="lic-start">
            <input id="lic-start" type="date" className="field" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </Field>
          <Field label="Expires (end of day)" id="lic-exp">
            <input id="lic-exp" type="date" className="field" value={expires} min={starts} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <Field label="Payment reference (UTR, cheque or PO number)" id="lic-ref">
          <input id="lic-ref" className="field" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="submit">
            <KeyRound className="size-4" aria-hidden /> Continue to sign
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function LicenceTable({ licences, onChanged, showHolder = false }: { licences: ManualLicence[]; onChanged: () => void; showHolder?: boolean }) {
  const sign = useSigner();
  const [extendFor, setExtendFor] = useState<ManualLicence | null>(null);
  const [newExpiry, setNewExpiry] = useState("");

  return (
    <>
      <Table head={[...(showHolder ? ["Holder"] : []), "App", "Period", "Reason / reference", "State", ""]} empty={!licences.length} minWidth={showHolder ? 820 : 680}>
        {licences.map((l) => {
          const st = licenceState(l);
          return (
            <tr key={l.id}>
              {showHolder && (
                <td>
                  {l.user ? (
                    <a href={`/admin/users/${l.userId}`} className="text-accent-ink hover:underline">
                      {l.user.fullName}
                      <span className="block text-xs text-subtle">{l.user.email}</span>
                    </a>
                  ) : (
                    <a href={`/admin/institutions/${l.orgId}`} className="text-accent-ink hover:underline">
                      {l.organization?.name ?? "Institution"}
                    </a>
                  )}
                </td>
              )}
              <td className="font-medium">{appName(l.appId)}</td>
              <td className="whitespace-nowrap">
                {formatDate(l.startsAt)} – {formatDate(l.expiresAt)}
              </td>
              <td className="max-w-xs">
                <span className="line-clamp-2">{l.revokedAt ? `Revoked: ${l.revokeReason}` : l.reason}</span>
                {l.reference && <span className="readout block text-xs text-subtle">{l.reference}</span>}
              </td>
              <td>
                <Pill tone={st.tone}>{st.label}</Pill>
              </td>
              <td className="whitespace-nowrap text-right">
                {!l.revokedAt && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setExtendFor(l);
                        setNewExpiry(isoDate(new Date(Math.max(Date.now(), new Date(l.expiresAt).getTime()) + 365 * 86_400_000)));
                      }}
                    >
                      Change expiry
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() =>
                        sign({
                          title: `Revoke ${appName(l.appId)} licence`,
                          description: "Access ends at once. The licence stays in the record as revoked.",
                          danger: true,
                          confirmLabel: "Revoke",
                          run: async ({ totpCode, reason }) => {
                            await api(`/v1/api/admin/licences/${l.id}/revoke`, { method: "POST", body: { reason, totpCode } });
                            onChanged();
                          },
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      <Dialog open={!!extendFor} onClose={() => setExtendFor(null)} title="Change licence expiry">
        {extendFor && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const l = extendFor;
              setExtendFor(null);
              sign({
                title: `New expiry ${formatDate(newExpiry)}`,
                description: `${appName(l.appId)} · currently until ${formatDate(l.expiresAt)}`,
                run: async ({ totpCode, reason }) => {
                  await api(`/v1/api/admin/licences/${l.id}`, { method: "PATCH", body: { expiresAt: endOfDayIst(newExpiry), reason, totpCode } });
                  onChanged();
                },
              });
            }}
          >
            <Field label="Expires (end of day, IST)" id="ext-date">
              <input id="ext-date" type="date" className="field" value={newExpiry} min={isoDate(extendFor.startsAt)} onChange={(e) => setNewExpiry(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit">Continue to sign</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
