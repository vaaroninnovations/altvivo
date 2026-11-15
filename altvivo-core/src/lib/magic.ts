export type VaultFileType = 'CSV' | 'JSON' | 'MP4' | 'PDF';

export const MIME_BY_TYPE: Record<VaultFileType, string> = {
  CSV: 'text/csv',
  JSON: 'application/json',
  MP4: 'video/mp4',
  PDF: 'application/pdf',
};

export const EXT_BY_TYPE: Record<VaultFileType, string[]> = {
  CSV: ['.csv'],
  JSON: ['.json'],
  MP4: ['.mp4', '.m4v'],
  PDF: ['.pdf'],
};

export const MAX_BYTES_BY_TYPE: Record<VaultFileType, number> = {
  CSV: 200 * 1024 * 1024,
  JSON: 200 * 1024 * 1024,
  MP4: 2 * 1024 * 1024 * 1024,
  PDF: 100 * 1024 * 1024,
};

/** Bytes needed from the start of an object to classify it. */
export const SNIFF_BYTES = 512;

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A ', 'dash', 'qt  ', 'MSNV', 'NDAS', '3gp4', '3gp5']);

function isLikelyText(buf: Buffer): boolean {
  // Strip a UTF-8 BOM; reject NUL and most C0 control characters.
  const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  for (let i = start; i < buf.length; i++) {
    const b = buf[i]!;
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) return false;
  }
  try {
    // Truncation can split a multi-byte char at the end; drop up to 3 bytes.
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(start, Math.max(start, buf.length - 3)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Magic-byte validation of an uploaded object against its declared type.
 * Rejects polyglots like HTML/SVG/scripts renamed to .csv/.json.
 */
export function matchesDeclaredType(type: VaultFileType, head: Buffer): boolean {
  switch (type) {
    case 'PDF':
      return head.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'MP4': {
      if (head.length < 12) return false;
      const box = head.subarray(4, 8).toString('latin1');
      const brand = head.subarray(8, 12).toString('latin1');
      return box === 'ftyp' && MP4_BRANDS.has(brand);
    }
    case 'JSON': {
      if (!isLikelyText(head)) return false;
      const t = head.toString('utf8').replace(/^﻿/, '').trimStart();
      return t.startsWith('{') || t.startsWith('[');
    }
    case 'CSV': {
      if (!isLikelyText(head)) return false;
      const t = head.toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
      if (t.startsWith('<') || t.startsWith('{') || t.startsWith('%pdf')) return false;
      // Spreadsheet formula injection guard on the first cell.
      return !/^[=+\-@]/.test(t);
    }
    default:
      return false;
  }
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}
