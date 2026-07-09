/* csv.js — RFC-4180-style CSV parsing + serialization.
 * Handles quoted fields, embedded commas, quotes and newlines, and a UTF-8 BOM.
 */

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
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
  // drop fully-empty trailing rows
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function csvField(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
  return s;
}

export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n');
}

/* Header aliases: maps Hebrew/English column names to observation fields. */
const HEADER_ALIASES = {
  dateTime: ['תאריך ושעה', 'תאריך', 'date', 'datetime', 'date time', 'time'],
  locationName: ['מיקום', 'שם מיקום', 'אתר', 'location', 'location name', 'site'],
  coordinates: ['קואורדינטות', 'קורדינטות', 'קואורדינאטות', 'coordinates', 'latlong', 'lat/long', 'latlng'],
  lat: ['רוחב', 'lat', 'latitude'],
  lng: ['אורך', 'lng', 'lon', 'long', 'longitude'],
  project: ['פרויקט', 'פרוייקט', 'project'],
  species: ['מין הציפור', 'מין', 'ציפור', 'species', 'bird', 'bird species'],
  quantity: ['מספר פרטים', 'כמות', 'פרטים', 'quantity', 'count', 'number'],
  notes: ['הערות', 'notes', 'comments', 'remarks'],
};

export function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const norm = String(h).trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === norm)) {
        if (!(field in map)) map[field] = idx;
      }
    }
  });
  return map;
}

/** Parse "32.5, 35.4" or "32.5 35.4" into {lat, lng} (or nulls). */
export function parseCoordinates(s) {
  const m = String(s ?? '').match(/(-?\d+(?:\.\d+)?)[,\s;/]+(-?\d+(?:\.\d+)?)/);
  if (!m) return { lat: null, lng: null };
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

/** Best-effort date parsing: ISO, DD/MM/YYYY [HH:MM], YYYY-MM-DD. */
export function parseDateTime(s) {
  s = String(s ?? '').trim();
  if (!s) return null;
  const dm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  if (dm) {
    let [, d, mo, y, h, mi] = dm;
    y = y.length === 2 ? '20' + y : y;
    const date = new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0));
    return isNaN(date) ? null : date.toISOString();
  }
  const date = new Date(s);
  return isNaN(date) ? null : date.toISOString();
}
