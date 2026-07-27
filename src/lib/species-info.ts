/* lib/species-info.ts — quick species reference card: photo + short
 * description, fetched live from Hebrew Wikipedia's public REST API. There's
 * no bundled bird database here — this is a best-effort lookup by the exact
 * species name already used in the app, with a graceful "no info found"
 * fallback for names that don't match a Wikipedia article title exactly. */

import { showModal } from './ui';
import { icon } from './icons';
import { escapeHtml } from './markdown';

interface SpeciesSummary {
  title: string;
  extract: string;
  thumbnailUrl: string | null;
  pageUrl: string | null;
}

async function fetchSummary(lang: 'he' | 'en', title: string): Promise<SpeciesSummary | null> {
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === 'disambiguation') return null;
    if (!data.extract && !data.thumbnail?.source) return null;
    return {
      title: data.title || title,
      extract: data.extract || '',
      thumbnailUrl: data.thumbnail?.source || null,
      pageUrl: data.content_urls?.desktop?.page || null,
    };
  } catch {
    return null;
  }
}

/** Tries the Hebrew common name first (matches Hebrew Wikipedia's usual
 * article titles for well-known species), then falls back to the
 * scientific name on English Wikipedia — much more reliably titled —
 * when a sciName is available and the Hebrew lookup didn't pan out. */
async function fetchSpeciesSummary(speciesName: string, sciName?: string): Promise<SpeciesSummary | null> {
  const heResult = await fetchSummary('he', speciesName);
  if (heResult) return heResult;
  if (sciName) return fetchSummary('en', sciName);
  return null;
}

export function openSpeciesInfoModal(speciesName: string, sciName?: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'species-info-modal';
  wrap.innerHTML = `
    <h3>${escapeHtml(speciesName)}</h3>
    <div class="species-info-body" data-body>
      <p class="species-info-loading">${icon('bird')} טוען מידע...</p>
    </div>
  `;
  showModal(wrap);
  const body = wrap.querySelector<HTMLElement>('[data-body]')!;

  void fetchSpeciesSummary(speciesName, sciName).then((info) => {
    if (!info) {
      body.innerHTML = '<p class="hint">לא נמצא מידע זמין למין זה.</p>';
      return;
    }
    body.innerHTML = `
      ${info.thumbnailUrl ? `<img src="${escapeHtml(info.thumbnailUrl)}" alt="${escapeHtml(info.title)}" class="species-info-img">` : ''}
      ${info.extract ? `<p class="species-info-extract">${escapeHtml(info.extract)}</p>` : ''}
      ${info.pageUrl ? `<a href="${escapeHtml(info.pageUrl)}" target="_blank" rel="noopener" class="species-info-link">${icon('link')} עוד בוויקיפדיה</a>` : ''}
    `;
  }).catch(() => {
    body.innerHTML = '<p class="hint">לא נמצא מידע זמין למין זה.</p>';
  });
}

/** Markup only — species.ts reads the data-species-info/-sci attributes back
 * out via its own existing click-delegation (onListClick), same as its
 * other row action buttons. */
export function speciesInfoButtonHtml(speciesName: string, sciName?: string): string {
  return `<button type="button" class="btn btn-sm species-info-btn" data-species-info="${escapeHtml(speciesName)}"${sciName ? ` data-species-sci="${escapeHtml(sciName)}"` : ''} title="מידע על המין" aria-label="מידע על המין">${icon('info')} מידע</button>`;
}
