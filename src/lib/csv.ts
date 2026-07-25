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

export type CsvField =
  | 'dateTime' | 'locationName' | 'coordinates' | 'lat' | 'lng'
  | 'tags' | 'species' | 'quantity' | 'notes';

const HEADER_ALIASES: Record<CsvField, string[]> = {
  dateTime: ['תאריך ושעה', 'תאריך', 'date', 'datetime', 'date time', 'time'],
  locationName: ['מיקום', 'שם מיקום', 'אתר', 'location', 'location name', 'site'],
  coordinates: ['קואורדינטות', 'קורדינטות', 'קואורדינאטות', 'coordinates', 'latlong', 'lat/long', 'latlng'],
  lat: ['רוחב', 'קו רוחב', 'lat', 'latitude'],
  lng: ['אורך', 'קו אורך', 'lng', 'lon', 'long', 'longitude'],
  // 'project'/'פרויקט' kept as an alias for files exported before the tags migration.
  tags: ['תגיות', 'תגית', 'tags', 'tag', 'פרויקט', 'פרוייקט', 'project'],
  species: ['מין הציפור', 'מין', 'ציפור', 'species', 'bird', 'bird species'],
  quantity: ['מספר פרטים', 'כמות', 'פרטים', 'quantity', 'count', 'number'],
  notes: ['הערות', 'notes', 'comments', 'remarks'],
};

export type HeaderMap = Partial<Record<CsvField, number>>;

export function mapHeaders(headerRow: string[]): HeaderMap {
  const map: HeaderMap = {};
  headerRow.forEach((h, idx) => {
    const norm = String(h).trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [CsvField, string[]][]) {
      if (aliases.some((a) => a.toLowerCase() === norm) && !(field in map)) {
        map[field] = idx;
      }
    }
  });
  return map;
}

export function parseCoordinates(s: unknown): { lat: number | null; lng: number | null } {
  const m = String(s ?? '').match(/(-?\d+(?:\.\d+)?)[,\s;/]+(-?\d+(?:\.\d+)?)/);
  if (!m) return { lat: null, lng: null };
  return { lat: parseFloat(m[1]!), lng: parseFloat(m[2]!) };
}

export function parseDateTime(s: unknown): string | null {
  const str = String(s ?? '').trim();
  if (!str) return null;
  const dm = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  if (dm) {
    const [, d, mo, y, h, mi] = dm;
    const year = y!.length === 2 ? '20' + y : y!;
    const date = new Date(+year, +mo! - 1, +d!, +(h || 0), +(mi || 0));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date.toISOString();
}
