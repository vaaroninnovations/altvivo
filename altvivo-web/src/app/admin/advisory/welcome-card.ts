"use client";

/**
 * "Welcome on board" share card for a new advisory board member, drawn on a
 * canvas in the browser. The portrait arrives as a data: URL from the admin
 * photo proxy (never a cross-origin <img>), so the canvas stays untainted and
 * can always be exported to PNG.
 */

export type CardFormat = "portrait" | "square";
export const CARD_SIZES: Record<CardFormat, { w: number; h: number; label: string }> = {
  portrait: { w: 1080, h: 1350, label: "Portrait · 1080 × 1350 (LinkedIn, Instagram, WhatsApp)" },
  square: { w: 1200, h: 1200, label: "Square · 1200 × 1200" },
};

export interface CardMember {
  honorific: string | null;
  fullName: string;
  credentials: string | null;
  designation: string;
  affiliation: string;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });

/** Resolved font stacks from the site's next/font variables (fallbacks if unavailable). */
function fonts() {
  const css = getComputedStyle(document.documentElement);
  const sans = css.getPropertyValue("--font-sans").trim() || "Inter, system-ui, sans-serif";
  const serif = css.getPropertyValue("--font-serif").trim() || "Georgia, serif";
  return { sans, serif };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (ctx.measureText(`${last}…`).width > maxWidth && last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

/** Shrinks the font until the text fits on at most `maxLines` lines. */
function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, min: number, maxWidth: number, maxLines: number) {
  let px = start;
  for (; px > min; px -= 2) {
    ctx.font = font(px);
    const words = text.split(/\s+/);
    if (wrap(ctx, text, maxWidth, 99).length <= maxLines && words.every((w) => ctx.measureText(w).width <= maxWidth)) break;
  }
  ctx.font = font(px);
  return { px, lines: wrap(ctx, text, maxWidth, maxLines) };
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  // Centered letter-spaced text (canvas letterSpacing is not in every browser yet).
  const chars = [...text];
  const width = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + tracking * (chars.length - 1);
  let cx = x - width / 2;
  ctx.textAlign = "left";
  for (const c of chars) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + tracking;
  }
  ctx.textAlign = "center";
  return width;
}

export async function renderWelcomeCard(member: CardMember, photoDataUrl: string | null, format: CardFormat): Promise<HTMLCanvasElement> {
  const { w: W, h: H } = CARD_SIZES[format];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const { sans, serif } = fonts();
  await Promise.all([
    document.fonts.load(`600 40px ${sans}`),
    document.fonts.load(`700 80px ${serif}`),
    document.fonts.load(`400 40px ${sans}`),
  ]).catch(() => undefined);
  const [wordmark, photo] = await Promise.all([
    loadImage("/brand/altvivo-wordmark-dark.png"),
    photoDataUrl ? loadImage(photoDataUrl).catch(() => null) : Promise.resolve(null),
  ]);

  // ---- background: deep indigo → violet, soft glows, fine dot grid
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#070b2e");
  bg.addColorStop(0.55, "#12093f");
  bg.addColorStop(1, "#2a0a52");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.15, H * 0.1, W * 0.6, "rgba(59,69,255,0.28)");
  glow(W * 0.9, H * 0.85, W * 0.7, "rgba(169,60,255,0.30)");
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let y = 30; y < H; y += 36) for (let x = 30; x < W; x += 36) ctx.fillRect(x, y, 2, 2);

  // ---- inner frame
  const pad = 48;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, 36);
  ctx.stroke();

  const cx = W / 2;
  const tall = H / W > 1.1;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ---- wordmark
  const wmW = W * 0.36;
  const wmH = (wordmark.naturalHeight / wordmark.naturalWidth) * wmW;
  let y = pad + (tall ? 72 : 56);
  ctx.drawImage(wordmark, cx - wmW / 2, y, wmW, wmH);
  y += wmH + (tall ? 78 : 56);

  // ---- eyebrow + headline
  ctx.fillStyle = "#b9a8ff";
  ctx.font = `600 26px ${sans}`;
  spaced(ctx, "ADVISORY BOARD", cx, y, 7);
  y += tall ? 84 : 72;
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${tall ? 82 : 76}px ${serif}`;
  ctx.fillText("Welcome on board", cx, y);
  y += 18;

  // ---- measure the text block first, so the portrait can shrink to make room
  const maxText = W - pad * 2 - 120;
  const name = `${member.honorific ? `${member.honorific} ` : ""}${member.fullName}`;
  const serifBold = (px: number) => `700 ${px}px ${serif}`;
  // One line if it fits at a readable size, otherwise two lines.
  let nameFit = fitText(ctx, name, serifBold, tall ? 66 : 60, 50, maxText, 1);
  if (wrap(ctx, name, maxText, 99).length > 1) nameFit = fitText(ctx, name, serifBold, tall ? 62 : 56, 40, maxText, 2);
  const nameLead = nameFit.px * 1.12;
  const desPx = tall ? 32 : 30;
  const affPx = tall ? 30 : 28;
  ctx.font = `400 ${desPx}px ${sans}`;
  const desLines = wrap(ctx, member.designation, maxText, 2);
  ctx.font = `400 ${affPx}px ${sans}`;
  const affLines = wrap(ctx, member.affiliation, maxText, 2);
  ctx.font = `500 28px ${sans}`;
  const credLine = member.credentials ? wrap(ctx, member.credentials, maxText, 1)[0]! : null;
  // From the first name baseline to the last institution line (the gap below the ring covers the name's ascent).
  const textH = (nameFit.lines.length - 1) * nameLead + (credLine ? 44 : 0) + 52 + desLines.length * 42 + affLines.length * 40;

  const footerY = H - pad - 40;
  const ph = 66;
  const pillTop = footerY - 54 - ph;
  const gapAbove = tall ? 56 : 40; // headline → ring
  const gapBelow = tall ? 84 : 72; // ring → name baseline
  const space = pillTop - 44 - y - gapAbove - gapBelow - textH;
  const r = Math.max(100, Math.min(tall ? 200 : 170, Math.floor((space - 24) / 2)));
  const slack = Math.max(0, space - 24 - 2 * r);
  y += gapAbove + slack / 2;

  // ---- portrait with gradient ring
  const py = y + 12 + r;
  const ring = ctx.createLinearGradient(cx - r, py - r, cx + r, py + r);
  ring.addColorStop(0, "#3b45ff");
  ring.addColorStop(1, "#c04cff");
  ctx.save();
  ctx.shadowColor = "rgba(140,80,255,0.55)";
  ctx.shadowBlur = 60;
  ctx.beginPath();
  ctx.arc(cx, py, r + 12, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, py, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = "#0d0a33";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, py, r - 2, 0, Math.PI * 2);
  ctx.clip();
  if (photo) {
    // cover-crop, biased slightly upward so faces are not cut off
    const s = Math.max((2 * r) / photo.naturalWidth, (2 * r) / photo.naturalHeight);
    const dw = photo.naturalWidth * s;
    const dh = photo.naturalHeight * s;
    ctx.drawImage(photo, cx - dw / 2, py - r - (dh - 2 * r) * 0.3, dw, dh);
  } else {
    const g = ctx.createLinearGradient(cx - r, py - r, cx + r, py + r);
    g.addColorStop(0, "#2b2f8f");
    g.addColorStop(1, "#5a1f9e");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, py - r, 2 * r, 2 * r);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 ${Math.round(r * 0.8)}px ${serif}`;
    ctx.textBaseline = "middle";
    const initials = member.fullName
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    ctx.fillText(initials, cx, py + 4);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
  y = py + r + 12 + gapBelow;

  // ---- name, credentials, designation, institution
  ctx.fillStyle = "#ffffff";
  ctx.font = serifBold(nameFit.px);
  for (const [i, line] of nameFit.lines.entries()) ctx.fillText(line, cx, y + i * nameLead);
  y += (nameFit.lines.length - 1) * nameLead;
  if (credLine) {
    ctx.fillStyle = "#c9bdff";
    ctx.font = `500 28px ${sans}`;
    y += 44;
    ctx.fillText(credLine, cx, y);
  }
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `400 ${desPx}px ${sans}`;
  y += 52;
  for (const line of desLines) {
    ctx.fillText(line, cx, y);
    y += 42;
  }
  ctx.fillStyle = "rgba(255,255,255,0.66)";
  ctx.font = `400 ${affPx}px ${sans}`;
  for (const line of affLines) {
    ctx.fillText(line, cx, y);
    y += 40;
  }

  // ---- "Advisory Board member" pill above the footer
  ctx.font = `600 28px ${sans}`;
  const label = "Advisory Board member";
  const pw = ctx.measureText(label).width + 84;
  const pill = ctx.createLinearGradient(cx - pw / 2, 0, cx + pw / 2, 0);
  pill.addColorStop(0, "#3b45ff");
  pill.addColorStop(1, "#a93cff");
  ctx.beginPath();
  ctx.roundRect(cx - pw / 2, pillTop, pw, ph, ph / 2);
  ctx.fillStyle = pill;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, pillTop + ph / 2 + 1);
  ctx.textBaseline = "alphabetic";

  // ---- footer
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `500 24px ${sans}`;
  ctx.fillText("altvivo.bio  ·  Digital infrastructure for life sciences", cx, footerY);

  return canvas;
}

export const cardBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the card"))), "image/png"));
