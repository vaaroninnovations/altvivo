"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ExternalLink, ImageUp, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { LoadState, PageHeader, adminError, useAdmin } from "@/components/admin/kit";
import { Dialog, Switch } from "@/components/client";
import { Alert, Button, ButtonLink, Card, Field, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdvisoryMember } from "@/lib/types";

type Member = AdvisoryMember & { id: string; sortOrder: number; isPublished: boolean; featured: boolean; userId: string | null; updatedAt: string };

const EMPTY = {
  slug: "",
  honorific: "",
  fullName: "",
  credentials: "",
  designation: "",
  affiliation: "",
  bio: "",
  photoUrl: "",
  photoAlt: "",
  specializations: "",
  orcidId: "",
  scholarUrl: "",
  linkedinUrl: "",
  websiteUrl: "",
  isPublished: false,
  featured: false,
};
type Form = typeof EMPTY;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(dr|prof|mr|ms|mrs)\.?\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const toForm = (m: Member): Form => ({
  slug: m.slug,
  honorific: m.honorific ?? "",
  fullName: m.fullName,
  credentials: m.credentials ?? "",
  designation: m.designation,
  affiliation: m.affiliation,
  bio: m.bio,
  photoUrl: m.photoUrl ?? "",
  photoAlt: m.photoAlt ?? "",
  specializations: m.specializations.join(", "),
  orcidId: m.orcidId ?? "",
  scholarUrl: m.scholarUrl ?? "",
  linkedinUrl: m.linkedinUrl ?? "",
  websiteUrl: m.websiteUrl ?? "",
  isPublished: m.isPublished,
  featured: m.featured,
});

const toBody = (f: Form) => {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    slug: f.slug.trim(),
    honorific: opt(f.honorific),
    fullName: f.fullName.trim(),
    credentials: opt(f.credentials),
    designation: f.designation.trim(),
    affiliation: f.affiliation.trim(),
    bio: f.bio.trim(),
    photoUrl: opt(f.photoUrl),
    photoAlt: opt(f.photoAlt),
    specializations: f.specializations
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    orcidId: opt(f.orcidId.replace(/^https?:\/\/orcid\.org\//, "")),
    scholarUrl: opt(f.scholarUrl),
    linkedinUrl: opt(f.linkedinUrl),
    websiteUrl: opt(f.websiteUrl),
    isPublished: f.isPublished,
    featured: f.featured,
  };
};

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function AdvisoryView() {
  const { data, error, loading, reload, setData } = useAdmin<{ members: Member[] }>("/v1/api/admin/advisory-board");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [photoFor, setPhotoFor] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const members = data?.members ?? [];
  const ok = (text: string) => {
    setNotice({ tone: "success", text });
    void reload();
  };
  const fail = (err: unknown) => setNotice({ tone: "danger", text: adminError(err) });

  async function patch(m: Member, body: Partial<Record<keyof Form, unknown>>, msg: string) {
    try {
      await api(`/v1/api/admin/advisory-board/${m.id}`, { method: "PATCH", body });
      ok(msg);
    } catch (err) {
      fail(err);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...members];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setData({ members: next });
    try {
      await api("/v1/api/admin/advisory-board/reorder", { method: "POST", body: { ids: next.map((m) => m.id) } });
      void reload();
    } catch (err) {
      fail(err);
      void reload();
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/v1/api/admin/advisory-board/${removing.id}`, { method: "DELETE" });
      ok(`${removing.fullName} removed from the advisory board.`);
      setRemoving(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Advisory board"
        description="Profiles shown on /advisory-board. Drafts stay private until published; featured members are listed first on the landing page. Changes are audited and appear on the site within a minute."
        actions={
          <>
            <ButtonLink href="/advisory-board" variant="outline" target="_blank" rel="noopener">
              <ExternalLink className="size-4" aria-hidden /> View page
            </ButtonLink>
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> Add member
            </Button>
          </>
        }
      />
      {notice && (
        <div className="mb-6">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && !members.length && <Card className="p-10 text-center text-sm text-muted">No advisory board members yet.</Card>}
      <ol className="space-y-3">
        {members.map((m, i) => (
          <li key={m.id}>
            <Card className={`flex flex-col gap-4 p-4 sm:flex-row sm:items-center ${m.isPublished ? "" : "border-dashed"}`}>
              <div className="flex items-center gap-1 sm:flex-col">
                <Button size="sm" variant="ghost" aria-label={`Move ${m.fullName} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${m.fullName} down`} disabled={i === members.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
              </div>
              <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
                {m.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photoUrl} alt={m.photoAlt ?? ""} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-lg font-semibold text-subtle">
                    {m.fullName
                      .split(/\s+/)
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {m.honorific ? `${m.honorific} ` : ""}
                  {m.fullName}
                  {m.credentials && <span className="text-muted">, {m.credentials}</span>}
                </p>
                <p className="truncate text-sm text-muted">
                  {m.designation} · {m.affiliation}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.isPublished ? <Pill tone="live">published</Pill> : <Pill tone="muted">draft</Pill>}
                  {m.featured && <Pill tone="accent">featured</Pill>}
                  {!m.photoUrl && <Pill tone="soon">no photo</Pill>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Switch checked={m.isPublished} label={`Publish ${m.fullName}`} onChange={(v) => patch(m, { isPublished: v }, v ? `${m.fullName} published.` : `${m.fullName} hidden.`)} />
                  Published
                </span>
                <Button size="sm" variant="ghost" aria-pressed={m.featured} onClick={() => patch(m, { featured: !m.featured }, m.featured ? "No longer featured." : `${m.fullName} featured.`)}>
                  <Star className={`size-3.5 ${m.featured ? "fill-current text-accent-ink" : ""}`} aria-hidden /> Feature
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPhotoFor(m)}>
                  <ImageUp className="size-3.5" aria-hidden /> Photo
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                  <Pencil className="size-3.5" aria-hidden /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-danger" aria-label={`Delete ${m.fullName}`} onClick={() => setRemoving(m)}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      {editing && (
        <MemberDialog
          member={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            ok(msg);
          }}
        />
      )}
      {photoFor && (
        <PhotoDialog
          member={photoFor}
          onClose={() => setPhotoFor(null)}
          onSaved={() => {
            setPhotoFor(null);
            ok("Portrait updated.");
          }}
        />
      )}
      <Dialog open={!!removing} onClose={() => !busy && setRemoving(null)} title={`Delete ${removing?.fullName ?? ""}?`}>
        <p className="text-sm text-muted">The profile is removed from the site and the CMS. To take it offline but keep it, switch off Published instead.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>
            Keep
          </Button>
          <Button variant="danger" onClick={remove} loading={busy}>
            <Trash2 className="size-4" aria-hidden /> Delete profile
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function MemberDialog({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState<Form>(member ? toForm(member) : EMPTY);
  const [slugTouched, setSlugTouched] = useState(!!member);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value, ...(k === "fullName" && !slugTouched ? { slug: slugify(e.target.value) } : {}) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.photoUrl.trim() && !f.photoAlt.trim()) return setError("Describe the photo (alt text) for screen-reader users.");
    setBusy(true);
    setError(null);
    try {
      if (member) await api(`/v1/api/admin/advisory-board/${member.id}`, { method: "PATCH", body: toBody(f) });
      else await api("/v1/api/admin/advisory-board", { method: "POST", body: toBody(f) });
      onSaved(member ? `${f.fullName} updated.` : `${f.fullName} added${f.isPublished ? " and published" : " as a draft"}.`);
    } catch (err) {
      setError(adminError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={() => !busy && onClose()} title={member ? `Edit ${member.fullName}` : "Add advisory board member"} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr_1fr]">
          <Field label="Honorific" id="m-hon">
            <input id="m-hon" className="field" placeholder="Prof." maxLength={20} value={f.honorific} onChange={set("honorific")} />
          </Field>
          <Field label="Full name" id="m-name">
            <input id="m-name" className="field" required minLength={2} maxLength={200} value={f.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="Post-nominals" id="m-cred">
            <input id="m-cred" className="field" placeholder="PhD, FNASc" maxLength={200} value={f.credentials} onChange={set("credentials")} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Designation" id="m-des">
            <input id="m-des" className="field" required minLength={2} maxLength={200} value={f.designation} onChange={set("designation")} />
          </Field>
          <Field label="Affiliation" id="m-aff">
            <input id="m-aff" className="field" required minLength={2} maxLength={300} value={f.affiliation} onChange={set("affiliation")} />
          </Field>
          <Field label="URL slug" id="m-slug" hint={`/advisory-board#${f.slug || "…"}`}>
            <input
              id="m-slug"
              className="field readout"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={80}
              value={f.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setF((c) => ({ ...c, slug: e.target.value.toLowerCase() }));
              }}
            />
          </Field>
          <Field label="Specialisations" id="m-spec" hint="Comma-separated, up to 12">
            <input id="m-spec" className="field" value={f.specializations} onChange={set("specializations")} />
          </Field>
        </div>
        <Field label="Biography" id="m-bio" hint={`${f.bio.trim().length} / 5000 characters`}>
          <textarea id="m-bio" rows={6} className="field" required minLength={10} maxLength={5000} value={f.bio} onChange={set("bio")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ORCID iD" id="m-orcid">
            <input id="m-orcid" className="field readout" placeholder="0000-0002-1825-0097" value={f.orcidId} onChange={set("orcidId")} />
          </Field>
          <Field label="Google Scholar URL" id="m-scholar">
            <input id="m-scholar" type="url" className="field" placeholder="https://scholar.google.com/citations?user=…" value={f.scholarUrl} onChange={set("scholarUrl")} />
          </Field>
          <Field label="LinkedIn URL" id="m-li">
            <input id="m-li" type="url" className="field" placeholder="https://www.linkedin.com/in/…" value={f.linkedinUrl} onChange={set("linkedinUrl")} />
          </Field>
          <Field label="Website" id="m-web">
            <input id="m-web" type="url" className="field" placeholder="https://" value={f.websiteUrl} onChange={set("websiteUrl")} />
          </Field>
          <Field label="Photo URL" id="m-photo" hint="Or upload a portrait from the list after saving">
            <input id="m-photo" type="url" className="field" placeholder="https://" value={f.photoUrl} onChange={set("photoUrl")} />
          </Field>
          <Field label="Photo alt text" id="m-alt">
            <input id="m-alt" className="field" maxLength={300} value={f.photoAlt} onChange={set("photoAlt")} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <div className="flex flex-wrap gap-6">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={f.isPublished} onChange={(v) => setF((c) => ({ ...c, isPublished: v }))} label="Published" />
              Published
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={f.featured} onChange={(v) => setF((c) => ({ ...c, featured: v }))} label="Featured" />
              Featured on landing page
            </span>
          </div>
          <Button type="submit" loading={busy}>
            {member ? "Save changes" : "Add member"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PhotoDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [alt, setAlt] = useState(member.photoAlt ?? `Portrait of ${member.fullName}`);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | null) {
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    if (!f) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return setError("Use a JPEG, PNG or WebP image.");
    if (f.size > 2 * 1024 * 1024) return setError("The image must be 2 MB or smaller.");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    try {
      setStep("Checksumming…");
      const sha256 = await sha256Hex(file);
      setStep("Requesting upload…");
      const signed = await api<{ objectKey: string; uploadUrl: string; method: string; headers: Record<string, string> }>(`/v1/api/admin/advisory-board/${member.id}/photo-upload`, {
        method: "POST",
        body: { contentType: file.type, sizeBytes: file.size, sha256 },
      });
      setStep("Uploading…");
      const put = await fetch(signed.uploadUrl, { method: signed.method, headers: { "Content-Type": file.type, ...signed.headers }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      setStep("Verifying…");
      await api(`/v1/api/admin/advisory-board/${member.id}/photo-complete`, { method: "POST", body: { objectKey: signed.objectKey, photoAlt: alt.trim() } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error && !("code" in err) ? err.message : adminError(err));
    } finally {
      setStep(null);
    }
  }

  return (
    <Dialog open onClose={() => !step && onClose()} title={`Portrait · ${member.fullName}`}>
      <form onSubmit={upload} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center gap-4">
          <div className="size-24 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
            {(preview ?? member.photoUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview ?? member.photoUrl!} alt="" className="size-full object-cover" />
            )}
          </div>
          <div className="text-sm text-muted">Square crop, at least 400 × 400 px. JPEG, PNG or WebP up to 2 MB. Stored on the public media bucket.</div>
        </div>
        <Field label="Image file" id="ph-file">
          <input id="ph-file" type="file" accept="image/jpeg,image/png,image/webp" className="field" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Alt text" id="ph-alt">
          <input id="ph-alt" className="field" required minLength={3} maxLength={300} value={alt} onChange={(e) => setAlt(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={!file || alt.trim().length < 3} loading={!!step}>
            <ImageUp className="size-4" aria-hidden /> {step ?? "Upload portrait"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
