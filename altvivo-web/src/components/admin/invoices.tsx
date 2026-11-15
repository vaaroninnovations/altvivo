"use client";

import { useState, type FormEvent } from "react";
import { FileDown, FilePlus2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { InvoiceSummary } from "@/lib/types";
import { Dialog } from "../client";
import { Alert, Button, Field, Pill, formatDate } from "../ui";
import { adminError, isoDate, useSigner } from "./kit";

export type AdminInvoice = InvoiceSummary & { orgId: string | null; userId: string | null; relatedInvoiceId: string | null };

export const KIND_LABEL: Record<InvoiceSummary["kind"], string> = { TAX_INVOICE: "Tax invoice", PROFORMA: "Proforma", CREDIT_NOTE: "Credit note" };

export function InvoiceStatus({ inv }: { inv: InvoiceSummary }) {
  if (inv.status === "PAID") return <Pill tone="live">paid</Pill>;
  if (inv.status === "CANCELLED") return <Pill tone="muted">cancelled</Pill>;
  if (inv.kind === "PROFORMA" && inv.validUntil && new Date(inv.validUntil) < new Date()) return <Pill tone="soon">expired</Pill>;
  return <Pill tone="accent">{inv.kind === "PROFORMA" ? "awaiting payment" : "issued"}</Pill>;
}

async function openPdf(id: string) {
  const r = await api<{ url: string }>(`/v1/api/admin/invoices/${id}/pdf`);
  window.open(r.url, "_blank", "noopener");
}

/** PDF, record bank payment (proformas), cancel (unpaid), credit note (tax invoices). */
export function InvoiceActions({ inv, onChanged }: { inv: AdminInvoice; onChanged: (msg: string) => void }) {
  const sign = useSigner();
  const [pay, setPay] = useState(false);
  const [credit, setCredit] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [amount, setAmount] = useState((inv.totalMinor / 100).toFixed(2));
  const [method, setMethod] = useState("neft");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(isoDate(new Date()));
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [desc, setDesc] = useState("");
  const [taxable, setTaxable] = useState("");

  function submitPayment(e: FormEvent) {
    e.preventDefault();
    const minor = Math.round(Number(amount) * 100);
    setPay(false);
    sign({
      title: `Record ${method.toUpperCase()} payment for ${inv.number}`,
      description: `${formatMoney(minor, inv.currency)} received on ${formatDate(paidAt)} (ref. ${reference}). Core issues the GST tax invoice and licenses the institution for one term.`,
      reason: "none",
      run: async ({ totpCode }) => {
        await api(`/v1/api/admin/invoices/${inv.id}/record-payment`, {
          method: "POST",
          body: { amountMinor: minor, method, reference, paidAt: new Date(`${paidAt}T12:00:00+05:30`).toISOString(), totpCode },
        });
        onChanged(`Payment recorded against ${inv.number}; tax invoice issued and licences granted.`);
      },
    });
  }

  function submitCredit(e: FormEvent) {
    e.preventDefault();
    setCredit(false);
    sign({
      title: mode === "full" ? `Credit note reversing ${inv.number}` : `Partial credit note against ${inv.number}`,
      description: mode === "full" ? `Reverses ${formatMoney(inv.totalMinor, inv.currency)} with the same tax split.` : `Taxable ${formatMoney(Math.round(Number(taxable) * 100), inv.currency)} plus GST at the invoice's rate.`,
      danger: true,
      run: async ({ totpCode, reason }) => {
        await api(`/v1/api/admin/invoices/${inv.id}/credit-note`, {
          method: "POST",
          body: mode === "full" ? { mode, reason, totpCode } : { mode, description: desc, taxableMinor: Math.round(Number(taxable) * 100), reason, totpCode },
        });
        onChanged(`Credit note issued against ${inv.number}.`);
      },
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setPdfErr(null);
          openPdf(inv.id).catch((err) => setPdfErr(adminError(err)));
        }}
        title={pdfErr ?? "Download PDF"}
      >
        <FileDown className="size-3.5" aria-hidden /> {pdfErr ? "Retry" : "PDF"}
      </Button>
      {inv.kind === "PROFORMA" && inv.status === "ISSUED" && (
        <Button size="sm" variant="outline" onClick={() => setPay(true)}>
          Record payment
        </Button>
      )}
      {inv.kind === "TAX_INVOICE" && (inv.status === "ISSUED" || inv.status === "PAID") && (
        <Button size="sm" variant="ghost" onClick={() => setCredit(true)}>
          Credit note
        </Button>
      )}
      {inv.status === "ISSUED" && (
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          onClick={() =>
            sign({
              title: `Cancel ${inv.number}`,
              description: "Only for documents with no payment against them. The number stays used; the document is marked cancelled.",
              danger: true,
              confirmLabel: "Cancel document",
              run: async ({ totpCode, reason }) => {
                await api(`/v1/api/admin/invoices/${inv.id}/cancel`, { method: "POST", body: { reason, totpCode } });
                onChanged(`${inv.number} cancelled.`);
              },
            })
          }
        >
          Cancel
        </Button>
      )}

      <Dialog open={pay} onClose={() => setPay(false)} title={`Payment received · ${inv.number}`}>
        <form onSubmit={submitPayment} className="space-y-4 text-left">
          <Alert tone="info">The amount must equal the proforma total, {formatMoney(inv.totalMinor, inv.currency)}.</Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Amount (${inv.currency})`} id="pay-amt">
              <input id="pay-amt" className="field readout" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Method" id="pay-method">
              <select id="pay-method" className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
                {["neft", "rtgs", "imps", "cheque", "upi", "wire"].map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="UTR / cheque / reference" id="pay-ref">
              <input id="pay-ref" className="field readout" required minLength={4} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Received on" id="pay-date">
              <input id="pay-date" type="date" className="field" max={isoDate(new Date())} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={reference.trim().length < 4}>
              Continue to sign
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={credit} onClose={() => setCredit(false)} title={`Credit note · ${inv.number}`}>
        <form onSubmit={submitCredit} className="space-y-4 text-left">
          <div role="radiogroup" className="flex gap-4 text-sm">
            {(["full", "partial"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="cn-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-[var(--accent)]" />
                {m === "full" ? "Reverse the whole invoice" : "Credit part of it"}
              </label>
            ))}
          </div>
          {mode === "partial" && (
            <>
              <Field label="Description on the credit note" id="cn-desc">
                <input id="cn-desc" className="field" required minLength={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
              </Field>
              <Field label={`Taxable amount to credit (${inv.currency}, before GST)`} id="cn-amt">
                <input id="cn-amt" className="field readout" inputMode="decimal" required value={taxable} onChange={(e) => setTaxable(e.target.value)} />
              </Field>
            </>
          )}
          <p className="text-xs text-subtle">Credit notes cannot exceed the invoice total. Refund the money through Razorpay, Stripe or your bank separately.</p>
          <div className="flex justify-end">
            <Button type="submit" variant="danger" disabled={mode === "partial" && (!desc.trim() || !(Number(taxable) > 0))}>
              <FilePlus2 className="size-4" aria-hidden /> Continue to sign
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** New proforma for an institution (site-licence plan, seats, optional discount and PO). */
export function ProformaDialog({
  open,
  onClose,
  orgId,
  orgName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  orgName: string;
  onDone: (msg: string, pdfUrl: string | null) => void;
}) {
  const [seats, setSeats] = useState("25");
  const [po, setPo] = useState("");
  const [discount, setDiscount] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invoice: InvoiceSummary; pdf: { url: string } }>(`/v1/api/admin/organizations/${orgId}/proformas`, {
        method: "POST",
        body: {
          planCode: "site_license_annual",
          seats: Number(seats),
          ...(po.trim() ? { poNumber: po.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(Number(discount) > 0 ? { discountMinor: Math.round(Number(discount) * 100) } : {}),
          validDays: Number(validDays),
        },
      });
      onDone(`Proforma ${r.invoice.number} issued: ${formatMoney(r.invoice.totalMinor, r.invoice.currency)} incl. GST.`, r.pdf.url);
      onClose();
    } catch (err) {
      setError(adminError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`New proforma · ${orgName}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-muted">Institutional Site Licence (XPRISM + aMaze, 12 months) at the current per-seat price, addressed to the institution&apos;s billing details.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Seats" id="pf-seats">
            <input id="pf-seats" type="number" min={1} className="field readout" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </Field>
          <Field label="Valid for (days)" id="pf-valid">
            <input id="pf-valid" type="number" min={1} max={180} className="field readout" value={validDays} onChange={(e) => setValidDays(e.target.value)} />
          </Field>
          <Field label="PO / indent number" id="pf-po">
            <input id="pf-po" className="field" maxLength={64} value={po} onChange={(e) => setPo(e.target.value)} />
          </Field>
          <Field label="Negotiated discount (before GST)" id="pf-disc" hint="Amount, not percent">
            <input id="pf-disc" className="field readout" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        </div>
        <Field label="Note on the document (optional)" id="pf-notes">
          <textarea id="pf-notes" rows={2} className="field" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            <FilePlus2 className="size-4" aria-hidden /> Issue proforma
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
