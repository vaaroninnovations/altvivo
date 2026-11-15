"use client";

import { useState } from "react";
import { ArrowUpRight, GraduationCap, Globe } from "lucide-react";
import type { AdvisoryMember } from "@/lib/types";
import { Dialog } from "./client";
import { cx } from "./ui";

const displayName = (m: AdvisoryMember) => [m.honorific, m.fullName].filter(Boolean).join(" ");

function initials(name: string) {
  const parts = name.replace(/^(dr|prof|mr|ms|mrs)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export function Portrait({ member, size = "md" }: { member: AdvisoryMember; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-28" : "size-20";
  if (member.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- portraits come from the CMS (R2 / CDN), not the Next image pipeline
      <img
        src={member.photoUrl}
        alt={member.photoAlt ?? `Portrait of ${displayName(member)}`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={cx(box, "shrink-0 rounded-2xl border border-line object-cover")}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cx(box, "grid shrink-0 place-items-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/25 to-live/20 font-semibold text-accent-ink", size === "lg" ? "text-3xl" : "text-xl")}
    >
      {initials(member.fullName)}
    </div>
  );
}

function OrcidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.15" />
      <path fill="currentColor" d="M8.3 7.6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-.8 1.3h1.6V18H7.5V8.9Zm3.4 0h3.3c3.1 0 4.6 2.2 4.6 4.6 0 2.6-2 4.5-4.6 4.5h-3.3V8.9Zm1.6 1.4v6.3h1.6c2.3 0 3.1-1.6 3.1-3.1 0-1.7-1-3.2-3.1-3.2h-1.6Z" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4V21H3V9.75Zm6.5 0h3.83v1.54h.06c.53-1 1.84-2.06 3.79-2.06 4.05 0 4.8 2.67 4.8 6.13V21h-4v-4.98c0-1.19-.02-2.72-1.66-2.72-1.66 0-1.91 1.3-1.91 2.63V21h-4V9.75Z"
      />
    </svg>
  );
}

export function MemberLinks({ member }: { member: AdvisoryMember }) {
  const links = [
    member.orcidId && { href: `https://orcid.org/${member.orcidId}`, label: `ORCID ${member.orcidId}`, Icon: OrcidIcon },
    member.scholarUrl && { href: member.scholarUrl, label: "Google Scholar", Icon: GraduationCap },
    member.linkedinUrl && { href: member.linkedinUrl, label: "LinkedIn", Icon: LinkedinIcon },
    member.websiteUrl && { href: member.websiteUrl, label: "Website", Icon: Globe },
  ].filter(Boolean) as { href: string; label: string; Icon: (p: { className?: string }) => React.ReactNode }[];
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {links.map(({ href, label, Icon }) => (
        <li key={href}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent-ink"
          >
            <Icon className="size-3.5" />
            {label}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function MemberCard({ member, compact = false }: { member: AdvisoryMember; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const name = displayName(member);
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-6 transition hover:border-accent/40">
      <div className="flex items-start gap-4">
        <Portrait member={member} />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-snug">{name}</h3>
          {member.credentials && <p className="readout mt-0.5 text-xs text-accent-ink">{member.credentials}</p>}
          <p className="mt-2 text-sm text-fg">{member.designation}</p>
          <p className="text-sm text-muted">{member.affiliation}</p>
        </div>
      </div>
      {member.specializations.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Research specialisations">
          {member.specializations.map((s) => (
            <li key={s} className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
              {s}
            </li>
          ))}
        </ul>
      )}
      {!compact && <p className="mt-4 line-clamp-3 flex-1 text-sm leading-relaxed text-muted">{member.bio}</p>}
      <div className={cx("flex flex-wrap items-center justify-between gap-3", compact ? "mt-5" : "mt-5 border-t border-line pt-4")}>
        {!compact && <MemberLinks member={member} />}
        <button type="button" onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
          Read bio <ArrowUpRight className="size-3.5" aria-hidden />
        </button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={name} wide>
        <div className="flex flex-col gap-5 sm:flex-row">
          <Portrait member={member} size="lg" />
          <div>
            {member.credentials && <p className="readout text-sm text-accent-ink">{member.credentials}</p>}
            <p className="mt-1 font-medium">{member.designation}</p>
            <p className="text-sm text-muted">{member.affiliation}</p>
          </div>
        </div>
        <div className="mt-5 space-y-3 text-sm leading-relaxed text-muted">
          {member.bio.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        {member.specializations.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-1.5">
            {member.specializations.map((s) => (
              <li key={s} className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-xs text-accent-ink">
                {s}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5">
          <MemberLinks member={member} />
        </div>
      </Dialog>
    </article>
  );
}
