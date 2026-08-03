/* lib/exif.ts — minimal, dependency-free EXIF "date taken" reader for JPEGs.
 * Only reads the first ~128KB of the file (where EXIF always lives), so it's
 * fast even on large photos. Returns null for formats without EXIF (PNG,
 * HEIC, screenshots) or photos whose metadata was stripped (e.g. by
 * WhatsApp) — callers should fall back to the File's lastModified date. */

interface IfdEntry { type: number; count: number; inlineStart: number }

function readIfd(view: DataView, ifdOffset: number, little: boolean): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  if (ifdOffset + 2 > view.byteLength) return entries;
  const count = view.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entryStart = ifdOffset + 2 + i * 12;
    if (entryStart + 12 > view.byteLength) break;
    const tag = view.getUint16(entryStart, little);
    const type = view.getUint16(entryStart + 2, little);
    const cnt = view.getUint32(entryStart + 4, little);
    entries.set(tag, { type, count: cnt, inlineStart: entryStart + 8 });
  }
  return entries;
}

function entryAscii(view: DataView, tiffStart: number, e: IfdEntry, little: boolean): string {
  const byteLen = e.count;
  const dataStart = byteLen <= 4 ? e.inlineStart : tiffStart + view.getUint32(e.inlineStart, little);
  let s = '';
  for (let i = 0; i < byteLen - 1 && dataStart + i < view.byteLength; i++) {
    s += String.fromCharCode(view.getUint8(dataStart + i));
  }
  return s;
}

function entryLong(view: DataView, e: IfdEntry, little: boolean): number {
  return view.getUint32(e.inlineStart, little);
}

function parseExifDateString(s: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, se);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTiff(view: DataView, tiffStart: number): Date | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const bo = view.getUint16(tiffStart);
  if (bo !== 0x4949 && bo !== 0x4d4d) return null;
  const little = bo === 0x4949;
  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null;
  const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, little);
  const ifd0 = readIfd(view, ifd0Offset, little);

  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const exifIfdOffset = tiffStart + entryLong(view, exifPtr, little);
    const exifIfd = readIfd(view, exifIfdOffset, little);
    const dto = exifIfd.get(0x9003) || exifIfd.get(0x9004); // DateTimeOriginal / DateTimeDigitized
    if (dto) {
      const d = parseExifDateString(entryAscii(view, tiffStart, dto, little));
      if (d) return d;
    }
  }
  const dt = ifd0.get(0x0132); // DateTime (last-modified in-camera)
  if (dt) {
    const d = parseExifDateString(entryAscii(view, tiffStart, dt, little));
    if (d) return d;
  }
  return null;
}

/** The photo's real capture date where knowable, with a marker of how
 * confident that is — EXIF when the file has it, otherwise the file's own
 * last-modified timestamp (much rougher: e.g. a WhatsApp re-save or a photo
 * copied between devices changes this without the picture having changed). */
export async function resolvePhotoDate(file: File): Promise<{ date: Date; source: 'exif' | 'file' }> {
  const exifDate = await readExifDate(file);
  return exifDate ? { date: exifDate, source: 'exif' } : { date: new Date(file.lastModified), source: 'file' };
}

export async function readExifDate(file: File): Promise<Date | null> {
  try {
    const buf = await file.slice(0, 131072).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      if (marker === 0xffd8) { offset += 2; continue; }
      if (marker === 0xffda || marker === 0xffd9) break; // start of scan / EOI — no more metadata ahead
      const segLen = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        const segStart = offset + 4;
        if (
          segStart + 6 <= view.byteLength &&
          view.getUint32(segStart) === 0x45786966 &&
          view.getUint16(segStart + 4) === 0x0000
        ) {
          return parseTiff(view, segStart + 6);
        }
      }
      offset += 2 + segLen;
    }
  } catch {
    /* truncated/corrupt slice — no date available */
  }
  return null;
}
