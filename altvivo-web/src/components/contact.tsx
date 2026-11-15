"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { CONTACT_CATEGORIES, type ContactCategory } from "@/lib/contact";
import { Alert, Button, Field } from "./ui";


/** POST /v1/public/contact (CSRF + Origin checked, rate-limited; stored and emailed to support). */
export function ContactForm({
  defaultCategory = "sales",
  defaultSubject = "",
  defaultMessage = "",
  defaultEmail = "",
  defaultName = "",
}: {
  defaultCategory?: ContactCategory;
  defaultSubject?: string;
  defaultMessage?: string;
  defaultEmail?: string;
  defaultName?: string;
}) {
  const [form, setForm] = useState({
    name: defaultName,
    email: defaultEmail,
    institution: "",
    category: defaultCategory as string,
    subject: defaultSubject,
    message: defaultMessage,
    website: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Enter your name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = "Enter a valid email address";
    if (form.subject.trim().length < 3) e.subject = "Add a short subject";
    if (form.message.trim().length < 10) e.message = "Tell us a little more (at least 10 characters)";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ reference?: string }>("/v1/public/contact", { method: "POST", body: { ...form, institution: form.institution || null } });
      setReference(r.reference ?? "received");
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(
        err instanceof ApiError && err.status === 429
          ? "You have sent several messages in a short time. Please wait a few minutes, or email support@altvivo.bio."
          : err instanceof ApiError
            ? err.message
            : "Your message could not be sent. Please retry or email support@altvivo.bio.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-live/30 bg-live-soft p-4 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-live-ink" aria-hidden />
        <div>
          <p className="font-medium text-fg">Thank you, we have your message.</p>
          <p className="mt-1 text-muted">
            A confirmation is on its way to <span className="readout">{form.email}</span>. We usually reply within one working day.
            {reference !== "received" && <span className="readout mt-1 block text-xs text-subtle">Reference {reference.slice(0, 8)}</span>}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" id="ct-name" error={errors.name}>
          <input id="ct-name" className="field" value={form.name} onChange={set("name")} autoComplete="name" aria-invalid={!!errors.name} />
        </Field>
        <Field label="Email" id="ct-email" error={errors.email}>
          <input id="ct-email" type="email" className="field" value={form.email} onChange={set("email")} autoComplete="email" aria-invalid={!!errors.email} />
        </Field>
        <Field label="Institution (optional)" id="ct-inst">
          <input id="ct-inst" className="field" value={form.institution} onChange={set("institution")} autoComplete="organization" />
        </Field>
        <Field label="Topic" id="ct-cat">
          <select id="ct-cat" className="field" value={form.category} onChange={set("category")}>
            {CONTACT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Subject" id="ct-subject" error={errors.subject}>
            <input id="ct-subject" className="field" value={form.subject} onChange={set("subject")} maxLength={200} aria-invalid={!!errors.subject} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Message" id="ct-message" error={errors.message}>
            <textarea id="ct-message" rows={6} className="field" value={form.message} onChange={set("message")} maxLength={5000} aria-invalid={!!errors.message} />
          </Field>
        </div>
      </div>
      {/* Honeypot: hidden from people and assistive technology, filled in by bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="ct-website">Website</label>
        <input id="ct-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>
      <p className="text-xs text-subtle">
        We use these details only to answer you (see the <a href="/privacy" className="underline">Privacy Policy</a>).
      </p>
      <Button type="submit" loading={busy}>
        <Send className="size-4" aria-hidden /> Send message
      </Button>
    </form>
  );
}
