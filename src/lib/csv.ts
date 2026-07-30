/* lib/csv.ts — RFC-4180-style CSV parsing + serialization. */

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function csvField(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n');
}
