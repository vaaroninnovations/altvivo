"use client";

import { useState, type FormEvent } from "react";
import { Copy, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { Dialog } from "@/components/client";
import { Alert, Button, Field } from "@/components/ui";
import { useAdmin, useSigner } from "@/components/admin/kit";

const ROLES = ["STUDENT", "RESEARCHER", "PI", "INSTITUTE_ADMIN", "ADVISORY_BOARD", "SUPERADMIN"] as const;

interface Created {
  userId: string;
  email: string;
  emailSent: boolean;
  setupLink: string;
  setupLinkExpiresInDays: number;
}

export function AddUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const sign = useSigner();
  const orgs = useAdmin<{ organizations: { id: string; name: string; seatsUsed: number; seatLimit: number; status: string }[] }>(open ? "/v1/api/admin/organizations" : null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [role, setRole] = useState<string>("RESEARCHER");
  const [orgId, setOrgId] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail("");
    setFullName("");
    setAffiliation("");
    setRole("RESEARCHER");
    setOrgId("");
    setSendInvite(true);
    setError(null);
    setCreated(null);
    setCopied(false);
  }

  function close() {
    reset();
    onClose();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setError("Enter a valid email address.");
    if (fullName.trim().length < 2) return setError("Enter the person's full name.");
    setError(null);
    sign({
      title: `Create account for ${fullName.trim()}`,
      description: (
        <>
          {mail} · role <span className="readout">{role}</span>
          {orgId && <> · {orgs.data?.organizations.find((o) => o.id === orgId)?.name}</>}.{" "}
          {sendInvite ? "A password-setup link will be emailed to them." : "No email is sent; you will get a setup link to share yourself."}
          {(role === "SUPERADMIN" || role === "INSTITUTE_ADMIN") && " They must enrol two-factor authentication at first sign-in."}
        </>
      ),
      run: async ({ totpCode, reason }) => {
        const res = await api<Omit<Created, "email">>("/v1/api/admin/users", {
          method: "POST",
          body: {
            email: mail,
            fullName: fullName.trim(),
            ...(affiliation.trim() ? { affiliation: affiliation.trim() } : {}),
            role,
            ...(orgId ? { orgId } : {}),
            sendInvite,
            reason,
            totpCode,
          },
        });
        setCreated({ ...res, email: mail });
        onCreated();
      },
    });
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.setupLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={created ? "Account created" : "Add a user"}>
      {created ? (
        <div className="space-y-4">
          {created.emailSent ? (
            <Alert tone="success">A password-setup email was sent to {created.email}.</Alert>
          ) : (
            <Alert tone="warning">No email was sent to {created.email}. Share the setup link below with them over a trusted channel.</Alert>
          )}
          <Field label={`Setup link (single use, valid ${created.setupLinkExpiresInDays} days)`} id="new-user-link">
            <div className="flex gap-2">
              <input id="new-user-link" className="field readout text-xs" readOnly value={created.setupLink} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={copy}>
                <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset}>
              Add another
            </Button>
            <Button type="button" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">Creates the account without a password. The person sets their own password from a single-use link, which also verifies their email.</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" id="new-user-name">
              <input id="new-user-name" className="field" maxLength={200} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
            </Field>
            <Field label="Email" id="new-user-email">
              <input id="new-user-email" type="email" className="field" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="Affiliation (optional)" id="new-user-aff">
            <input id="new-user-aff" className="field" maxLength={300} value={affiliation} onChange={(e) => setAffiliation(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" id="new-user-role">
              <select id="new-user-role" className="field" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Institution (optional)" id="new-user-org">
              <select id="new-user-org" className="field" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">None</option>
                {orgs.data?.organizations.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.status !== "ACTIVE" || o.seatsUsed >= o.seatLimit}>
                    {o.name} ({o.seatsUsed}/{o.seatLimit} seats)
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
            Email them the password-setup link
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit">
              <KeyRound className="size-4" aria-hidden /> Continue to sign
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
