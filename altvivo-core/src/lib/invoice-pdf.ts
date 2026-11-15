import type { Invoice, InvoiceLine } from '@prisma/client';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import type { Config } from '../config.js';

const require = createRequire(import.meta.url);
// DejaVu Sans: Unicode coverage for the rupee sign and accented Latin names.
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

/** GST state / UT codes (CBIC). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '96': 'Outside India', '97': 'Other Territory',
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]!);
  else if (n > 0) parts.push(ONES[n]!);
  return parts.join(' ');
}

/** Indian numbering (crore, lakh, thousand) for INR; international for USD. */
export function numberToWords(n: bigint, system: 'indian' | 'international'): string {
  if (n === 0n) return 'Zero';
  const scales: [bigint, string][] =
    system === 'indian'
      ? [[10_000_000n, 'Crore'], [100_000n, 'Lakh'], [1000n, 'Thousand']]
      : [[1_000_000_000n, 'Billion'], [1_000_000n, 'Million'], [1000n, 'Thousand']];
  const out: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      const q = rest / size;
      out.push(`${q >= 1000n ? numberToWords(q, system) : below1000(Number(q))} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0n) out.push(below1000(Number(rest)));
  return out.join(' ');
}

export function amountInWords(minor: bigint, currency: string): string {
  const major = minor / 100n;
  const cents = minor % 100n;
  if (currency === 'INR') {
    return `Rupees ${numberToWords(major, 'indian')}${cents ? ` and ${numberToWords(cents, 'indian')} Paise` : ''} Only`;
  }
  return `US Dollars ${numberToWords(major, 'international')}${cents ? ` and ${numberToWords(cents, 'international')} Cents` : ''} Only`;
}

export function money(minor: bigint, currency: string): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const major = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  const grouped = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US').format(major);
  return `${neg ? '-' : ''}${currency === 'INR' ? '₹' : '$'}${grouped}.${cents}`;
}

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

const IST_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const istDate = (d: Date | null) => (d ? IST_DATE.format(d) : '-');
const plainDate = (d: Date | null) => (d ? IST_DATE.format(new Date(`${d.toISOString().slice(0, 10)}T12:00:00+05:30`)) : '-');

const TITLE: Record<Invoice['kind'], string> = {
  TAX_INVOICE: 'TAX INVOICE',
  PROFORMA: 'PROFORMA INVOICE',
  CREDIT_NOTE: 'CREDIT NOTE',
};

type Inv = Invoice & { lines: InvoiceLine[] };

const INK = '#0B0F19';
const MUTED = '#475569';
const RULE = '#CBD5E1';
const ACCENT = '#0EA5E9';

/**
 * Renders an issued document. Contents follow CGST Rules 46 (tax invoice),
 * 53 (credit note) and the LUT export endorsement; a proforma is clearly
 * marked as not being a tax invoice and carries bank details for NEFT/RTGS.
 */
export async function renderInvoicePdf(inv: Inv, related: Invoice | null, cfg: Config): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
    info: {
      Title: `${TITLE[inv.kind]} ${inv.number ?? ''}`.trim(),
      Author: cfg.SELLER_LEGAL_NAME,
      Subject: `${TITLE[inv.kind]} for ${inv.buyerName}`,
      Producer: 'AltVivo billing',
      CreationDate: inv.issuedAt ?? new Date(),
    },
  });
  doc.registerFont('r', FONT_REGULAR);
  doc.registerFont('b', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = 40;
  const width = doc.page.width - 80;
  const bottom = doc.page.height - 60;
  const cur = inv.currency;

  // -------------------------------------------------------------- header ---
  doc.font('b').fontSize(16).fillColor(ACCENT).text(cfg.SELLER_TRADE_NAME || cfg.SELLER_LEGAL_NAME, left, 40);
  doc.font('b').fontSize(9).fillColor(INK).text(inv.sellerLegalName);
  doc.font('r').fontSize(8.5).fillColor(MUTED).text(inv.sellerAddress, { width: width * 0.55 });
  if (inv.sellerGstin) doc.text(`GSTIN: ${inv.sellerGstin}${cfg.SELLER_PAN ? `   PAN: ${cfg.SELLER_PAN}` : ''}`);
  doc.text([cfg.SELLER_EMAIL, cfg.SELLER_PHONE].filter(Boolean).join('   '));
  const headerBottom = doc.y;

  const metaX = left + width * 0.58;
  const metaW = width * 0.42;
  doc.font('b').fontSize(14).fillColor(INK).text(TITLE[inv.kind], metaX, 40, { width: metaW, align: 'right' });
  const meta: [string, string][] = [
    [inv.kind === 'CREDIT_NOTE' ? 'Credit note no.' : inv.kind === 'PROFORMA' ? 'Proforma no.' : 'Invoice no.', inv.number ?? '-'],
    ['Date', istDate(inv.issuedAt)],
    ['Place of supply', `${inv.placeOfSupply} - ${GST_STATES[inv.placeOfSupply] ?? ''}`],
    ['Reverse charge', 'No'],
  ];
  if (inv.poNumber) meta.push(['Buyer PO no.', inv.poNumber]);
  if (inv.kind === 'PROFORMA') meta.push(['Valid until', plainDate(inv.validUntil)]);
  if (inv.dueDate) meta.push(['Due date', plainDate(inv.dueDate)]);
  if (related && inv.kind === 'CREDIT_NOTE') meta.push(['Against invoice', `${related.number} dated ${istDate(related.issuedAt)}`]);
  if (related && inv.kind === 'TAX_INVOICE') meta.push(['Against proforma', related.number ?? '-']);
  let my = doc.y + 4;
  for (const [k, v] of meta) {
    doc.font('r').fontSize(8.5).fillColor(MUTED).text(k, metaX, my, { width: metaW * 0.42 });
    doc.font('b').fillColor(INK).text(v, metaX + metaW * 0.42, my, { width: metaW * 0.58, align: 'right' });
    my = doc.y + 2;
  }

  let y = Math.max(headerBottom, my) + 14;
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor(RULE).lineWidth(0.8).stroke();
  y += 10;

  // -------------------------------------------------------------- bill to --
  doc.font('b').fontSize(8).fillColor(MUTED).text(inv.kind === 'PROFORMA' ? 'QUOTATION FOR' : 'BILL TO', left, y);
  doc.font('b').fontSize(10).fillColor(INK).text(inv.buyerName, left, doc.y + 2, { width: width * 0.6 });
  doc.font('r').fontSize(8.5).fillColor(MUTED).text(inv.buyerAddress, { width: width * 0.6 });
  if (inv.buyerGstin) doc.text(`GSTIN: ${inv.buyerGstin}`);
  if (inv.buyerStateCode) doc.text(`State: ${GST_STATES[inv.buyerStateCode] ?? ''} (${inv.buyerStateCode})`);
  doc.text(inv.buyerEmail);
  y = doc.y + 14;

  // --------------------------------------------------------------- lines ---
  const taxCols: { key: 'cgstMinor' | 'sgstMinor' | 'igstMinor'; label: string; rate: (l: InvoiceLine) => number }[] =
    inv.taxTreatment === 'INTRA_STATE'
      ? [
          { key: 'cgstMinor', label: 'CGST', rate: (l) => l.gstRateBp / 2 },
          { key: 'sgstMinor', label: 'SGST', rate: (l) => l.gstRateBp / 2 },
        ]
      : inv.taxTreatment === 'INTER_STATE'
        ? [{ key: 'igstMinor', label: 'IGST', rate: (l) => l.gstRateBp }]
        : [];
  const cols = [
    { label: '#', w: 0.04, align: 'left' as const },
    // Money columns sized for Indian-grouped amounts up to Rs 99,99,99,999.99.
    { label: 'Description', w: taxCols.length === 2 ? 0.2 : taxCols.length === 1 ? 0.32 : 0.45, align: 'left' as const },
    { label: 'SAC', w: 0.08, align: 'left' as const },
    { label: 'Qty', w: 0.05, align: 'right' as const },
    { label: 'Rate', w: 0.11, align: 'right' as const },
    { label: 'Taxable', w: 0.13, align: 'right' as const },
    ...taxCols.map((t) => ({ label: t.label, w: taxCols.length === 2 ? 0.12 : 0.13, align: 'right' as const })),
  ];
  const used = cols.reduce((s, c) => s + c.w, 0);
  cols.push({ label: 'Amount', w: 1 - used, align: 'right' });

  const drawHead = () => {
    doc.rect(left, y, width, 18).fill('#F1F5F9');
    let x = left + 4;
    doc.font('b').fontSize(7.5).fillColor(INK);
    for (const c of cols) {
      doc.text(c.label, x, y + 5, { width: c.w * width - 8, align: c.align });
      x += c.w * width;
    }
    y += 22;
  };
  drawHead();

  for (const l of inv.lines) {
    const period = l.periodStart && l.periodEnd ? `\nPeriod: ${plainDate(l.periodStart)} - ${plainDate(l.periodEnd)}` : '';
    const discount = l.discountMinor > 0n ? `\nDiscount: ${money(l.discountMinor, cur)}` : '';
    const descr = `${l.description}${period}${discount}`;
    const cells = [
      String(l.position),
      descr,
      l.sacCode,
      String(l.quantity),
      money(l.unitPriceMinor, cur),
      money(l.taxableMinor, cur),
      ...taxCols.map((t) => `${money(l[t.key], cur)}\n@ ${pct(t.rate(l))}`),
      money(l.totalMinor, cur),
    ];
    doc.font('r').fontSize(7.5);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i]!.w * width - 8 }))) + 8;
    if (y + h > bottom - 140) {
      doc.addPage();
      y = 40;
      drawHead();
    }
    let x = left + 4;
    cells.forEach((c, i) => {
      doc.font('r').fontSize(7.5).fillColor(INK).text(c, x, y, { width: cols[i]!.w * width - 8, align: cols[i]!.align });
      x += cols[i]!.w * width;
    });
    y += h;
    doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor(RULE).lineWidth(0.5).stroke();
  }

  // -------------------------------------------------------------- totals ---
  if (y > bottom - 170) {
    doc.addPage();
    y = 40;
  }
  const tx = left + width * 0.55;
  const tw = width * 0.45;
  const totals: [string, bigint][] = [['Taxable value', inv.taxableMinor]];
  if (inv.discountMinor > 0n) totals.unshift(['Discount', -inv.discountMinor]);
  if (inv.taxTreatment === 'INTRA_STATE') totals.push(['CGST', inv.cgstMinor], ['SGST', inv.sgstMinor]);
  if (inv.taxTreatment === 'INTER_STATE') totals.push(['IGST', inv.igstMinor]);
  if (inv.taxTreatment === 'EXPORT') totals.push(['IGST (zero-rated)', 0n]);
  y += 6;
  for (const [k, v] of totals) {
    doc.font('r').fontSize(8.5).fillColor(MUTED).text(k, tx, y, { width: tw * 0.55 });
    doc.fillColor(INK).text(money(v, cur), tx + tw * 0.55, y, { width: tw * 0.45, align: 'right' });
    y += 14;
  }
  doc.rect(tx, y, tw, 22).fill('#E0F2FE');
  doc.font('b').fontSize(10).fillColor(INK).text(inv.kind === 'CREDIT_NOTE' ? 'Total credit' : 'Total', tx + 6, y + 6, { width: tw * 0.5 });
  doc.text(money(inv.totalMinor, cur), tx + tw * 0.5, y + 6, { width: tw * 0.5 - 6, align: 'right' });
  y += 30;
  doc.font('r').fontSize(8).fillColor(MUTED).text('Amount in words', left, y);
  doc.font('b').fillColor(INK).text(amountInWords(inv.totalMinor, cur), left, doc.y + 1, { width });
  y = doc.y + 12;

  // --------------------------------------------------------------- notes ---
  const notes: string[] = [];
  if (inv.taxTreatment === 'EXPORT') {
    notes.push(
      `Supply meant for export under LUT without payment of integrated tax${cfg.SELLER_LUT_REFERENCE ? ` (LUT ARN ${cfg.SELLER_LUT_REFERENCE})` : ''}.`,
    );
  }
  if (inv.kind === 'PROFORMA') {
    notes.push('This proforma invoice is a quotation and not a tax invoice. A GST tax invoice is issued when payment is received.');
    if (cfg.SELLER_BANK_ACCOUNT_NUMBER) {
      notes.push(
        `Pay by NEFT / RTGS to: ${cfg.SELLER_BANK_ACCOUNT_NAME || cfg.SELLER_LEGAL_NAME}, A/c ${cfg.SELLER_BANK_ACCOUNT_NUMBER}, ` +
          `IFSC ${cfg.SELLER_BANK_IFSC}, ${cfg.SELLER_BANK_NAME}${cfg.SELLER_BANK_BRANCH ? `, ${cfg.SELLER_BANK_BRANCH}` : ''}. ` +
          `Quote ${inv.number} as the payment reference.`,
      );
    }
  }
  if (inv.kind === 'CREDIT_NOTE' && related) notes.push(`Issued against tax invoice ${related.number} under section 34 of the CGST Act.`);
  if (inv.status === 'PAID' && inv.paidAt) notes.push(`Paid on ${istDate(inv.paidAt)}.`);
  if (inv.status === 'CANCELLED') notes.push(`CANCELLED on ${istDate(inv.cancelledAt)}: ${inv.cancelReason ?? ''}`);
  if (inv.notes) notes.push(inv.notes);
  for (const n of notes) {
    doc.font('r').fontSize(8).fillColor(INK).text(n, left, y, { width });
    y = doc.y + 4;
  }

  // ---------------------------------------------------------- signature ----
  y = Math.max(y + 16, doc.y + 16);
  if (y > bottom - 40) {
    doc.addPage();
    y = 60;
  }
  doc.font('b').fontSize(8.5).fillColor(INK).text(`For ${inv.sellerLegalName}`, tx, y, { width: tw, align: 'right' });
  doc.font('r').fontSize(8).fillColor(MUTED).text('Authorised signatory', tx, y + 26, { width: tw, align: 'right' });

  // ------------------------------------------------------------- footers ---
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit start a new page.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('r')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Computer-generated document; no physical signature is required. ${inv.number ?? ''} - page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - 34,
        { width, align: 'center', lineBreak: false },
      );
    doc.page.margins.bottom = margin;
  }
  if (inv.status === 'CANCELLED') {
    doc.switchToPage(range.start);
    doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('b').fontSize(72).fillColor('#DC2626').opacity(0.15).text('CANCELLED', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
    doc.restore();
  }
  doc.end();
  return done;
}
