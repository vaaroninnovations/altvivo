"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Award, Download, ExternalLink, ImageUp, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { LoadState, PageHeader, adminError, useAdmin } from "@/components/admin/kit";
import { Dialog, Switch } from "@/components/client";
import { Alert, Button, ButtonLink, Card, Field, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdvisoryMember } from "@/lib/types";
import { CARD_SIZES, cardBlob, renderWelcomeCard, type CardFormat } from "./welcome-card";

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

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const NO_BUCKET = "Photo uploads are not set up on this server yet (no public media bucket). Paste an https photo URL instead.";

/** Browser-side pre-check; core re-checks type and size and sniffs the uploaded bytes. */
const photoProblem = (f: File) =>
  !PHOTO_TYPES.includes(f.type) ? "Use a JPEG, PNG or WebP image." : f.size > PHOTO_MAX_BYTES ? "The image must be 2 MB or smaller." : null;

/** Signed upload straight to the public bucket, then core verifies it and sets the member's photo. */
async function uploadPortrait(memberId: string, file: File, photoAlt: string, onStep: (s: string) => void) {
  onStep("Checksumming…");
  const sha256 = await sha256Hex(file);
  onStep("Requesting upload…");
  const signed = await api<{ objectKey: string; uploadUrl: string; method: string; headers: Record<string, string> }>(`/v1/api/admin/advisory-board/${memberId}/photo-upload`, {
    method: "POST",
    body: { contentType: file.type, sizeBytes: file.size, sha256 },
  });
  onStep("Uploading photo…");
  const put = await fetch(signed.uploadUrl, { method: signed.method, headers: { "Content-Type": file.type, ...signed.headers }, body: file });
  if (!put.ok) throw new Error(`Photo upload failed (${put.status}).`);
  onStep("Verifying photo…");
  await api(`/v1/api/admin/advisory-board/${memberId}/photo-complete`, { method: "POST", body: { objectKey: signed.objectKey, photoAlt } });
}

const uploadError = (err: unknown) => (err instanceof Error && !("code" in err) ? err.message : adminError(err));

export function AdvisoryView() {
  const { data, error, loading, reload, setData } = useAdmin<{ members: Member[]; photoUploads?: boolean }>("/v1/api/admin/advisory-board");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [photoFor, setPhotoFor] = useState<Member | null>(null);
  const [cardFor, setCardFor] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const members = data?.members ?? [];
  const photoUploads = data?.photoUploads ?? false;
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
    setData({ members: next, photoUploads });
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
                <Button size="sm" variant="ghost" onClick={() => setCardFor(m)}>
                  <Award className="size-3.5" aria-hidden /> Welcome card
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
          photoUploads={photoUploads}
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
          photoUploads={photoUploads}
          onClose={() => setPhotoFor(null)}
          onSaved={() => {
            setPhotoFor(null);
            ok("Portrait updated.");
          }}
        />
      )}
      {cardFor && <WelcomeCardDialog member={cardFor} onClose={() => setCardFor(null)} />}
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

function MemberDialog({ member, photoUploads, onClose, onSaved }: { member: Member | null; photoUploads: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState<Form>(member ? toForm(member) : EMPTY);
  const [slugTouched, setSlugTouched] = useState(!!member);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Set once a new member is created, so a retry after a failed photo upload updates instead of duplicating.
  const [savedId, setSavedId] = useState<string | null>(member?.id ?? null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function pick(input: HTMLInputElement) {
    const next = input.files?.[0] ?? null;
    setError(null);
    if (next) {
      const problem = photoProblem(next);
      if (problem) {
        input.value = "";
        setFile(null);
        setPreview(null);
        return setError(problem);
      }
    }
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    if (next && !f.photoAlt.trim()) setF((c) => ({ ...c, photoAlt: c.fullName.trim() ? `Portrait of ${c.fullName.trim()}` : "" }));
  }
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value, ...(k === "fullName" && !slugTouched ? { slug: slugify(e.target.value) } : {}) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if ((f.photoUrl.trim() || file) && f.photoAlt.trim().length < 3) return setError("Describe the photo (alt text) for screen-reader users.");
    setBusy(true);
    setError(null);
    let id = savedId;
    try {
      setStep("Saving…");
      if (id) await api(`/v1/api/admin/advisory-board/${id}`, { method: "PATCH", body: toBody(f) });
      else {
        id = (await api<{ member: Member }>("/v1/api/admin/advisory-board", { method: "POST", body: toBody(f) })).member.id;
        setSavedId(id);
      }
      if (file) await uploadPortrait(id, file, f.photoAlt.trim(), setStep);
      onSaved(member ? `${f.fullName} updated.` : `${f.fullName} added${f.isPublished ? " and published" : " as a draft"}.`);
    } catch (err) {
      const msg = uploadError(err);
      setError(id && file ? `${f.fullName} was saved, but the photo was not: ${msg}` : msg);
    } finally {
      setBusy(false);
      setStep(null);
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
          <Field label="URL slug" id="m-slug" hint={`Profile link: altvivo.bio/about#${f.slug || "…"}`}>
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
        </div>
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-medium">Photo</legend>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="size-24 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
              {(preview ?? f.photoUrl.trim()) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview ?? f.photoUrl.trim()} alt="" className="size-full object-cover" />
              )}
            </div>
            <div className="grid min-w-0 flex-1 gap-4">
              <Field
                label="Upload photo"
                id="m-file"
                hint={photoUploads ? "JPEG, PNG or WebP, up to 2 MB. A square crop of at least 400 × 400 px looks best. Uploaded when you save." : NO_BUCKET}
              >
                <input id="m-file" type="file" accept={PHOTO_TYPES.join(",")} className="field" disabled={!photoUploads || busy} onChange={(e) => pick(e.target)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={file ? "Photo URL (replaced by the upload)" : "Or photo URL"} id="m-photo">
                  <input id="m-photo" type="url" className="field" placeholder="https://" disabled={!!file} value={f.photoUrl} onChange={set("photoUrl")} />
                </Field>
                <Field label="Photo alt text" id="m-alt">
                  <input id="m-alt" className="field" maxLength={300} value={f.photoAlt} onChange={set("photoAlt")} />
                </Field>
              </div>
            </div>
          </div>
        </fieldset>
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
            {step ?? (savedId ? "Save changes" : "Add member")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PhotoDialog({ member, photoUploads, onClose, onSaved }: { member: Member; photoUploads: boolean; onClose: () => void; onSaved: () => void }) {
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
    const problem = photoProblem(f);
    if (problem) return setError(problem);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    try {
      await uploadPortrait(member.id, file, alt.trim(), setStep);
      onSaved();
    } catch (err) {
      setError(uploadError(err));
    } finally {
      setStep(null);
    }
  }

  return (
    <Dialog open onClose={() => !step && onClose()} title={`Portrait · ${member.fullName}`}>
      <form onSubmit={upload} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {!photoUploads && <Alert tone="info">{NO_BUCKET} Use Edit to set the photo URL.</Alert>}
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
          <input id="ph-file" type="file" accept={PHOTO_TYPES.join(",")} className="field" disabled={!photoUploads} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
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

function WelcomeCardDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const [format, setFormat] = useState<CardFormat>("portrait");
  const [photo, setPhoto] = useState<{ dataUrl: string | null; note: string | null } | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The portrait comes through core as a data: URL, so the canvas is never tainted by a cross-origin image.
  useEffect(() => {
    let live = true;
    if (!member.photoUrl) setPhoto({ dataUrl: null, note: "No photo on file, so the card shows initials." });
    else
      api<{ dataUrl: string }>(`/v1/api/admin/advisory-board/${member.id}/photo-data`)
        .then((r) => live && setPhoto({ dataUrl: r.dataUrl, note: null }))
        .catch((err) => live && setPhoto({ dataUrl: null, note: `${adminError(err)} The card shows initials instead.` }));
    return () => {
      live = false;
    };
  }, [member.id, member.photoUrl]);

  useEffect(() => {
    if (!photo) return;
    let live = true;
    let url: string | null = null;
    setCard(null);
    setError(null);
    renderWelcomeCard(member, photo.dataUrl, format)
      .then(cardBlob)
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setCard(url);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "Could not draw the card."));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [member, photo, format]);

  function download() {
    if (!card) return;
    const a = document.createElement("a");
    a.href = card;
    a.download = `altvivo-welcome-${member.slug}-${CARD_SIZES[format].w}x${CARD_SIZES[format].h}.png`;
    document.body.append(a);
    a.click();
    a.remove();
  }

  const { w, h } = CARD_SIZES[format];
  return (
    <Dialog open onClose={onClose} title={`Welcome card · ${member.fullName}`} wide>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {photo?.note && <Alert tone="info">{photo.note}</Alert>}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Card size">
          {(Object.keys(CARD_SIZES) as CardFormat[]).map((k) => (
            <Button key={k} size="sm" variant={k === format ? "primary" : "outline"} role="radio" aria-checked={k === format} onClick={() => setFormat(k)}>
              {CARD_SIZES[k].label}
            </Button>
          ))}
        </div>
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface-2" style={{ aspectRatio: `${w} / ${h}` }}>
          {card ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card} alt={`Welcome on board card for ${member.fullName}`} className="size-full" />
          ) : (
            <span className="flex size-full items-center justify-center text-sm text-muted">Drawing the card…</span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={download} disabled={!card}>
            <Download className="size-4" aria-hidden /> Download PNG
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
