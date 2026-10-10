/* lib/whats-new.ts — the "מה חדש" window (ⓘ in the top bar) listing every
 * update from data/changelog.ts, plus tracking which entries this device
 * has already seen so the button can show an unread dot and the post-update
 * popup can list just what's new. */

import { CHANGELOG, LATEST_CHANGELOG_ID, type ChangelogEntry } from '../data/changelog';
import { showModal } from './ui';
import { escapeHtml } from './markdown';
import { icon } from './icons';

const SEEN_KEY = 'changelogSeenId';

function seenId(): number | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw == null ? null : Number(raw);
  } catch { return LATEST_CHANGELOG_ID; } // storage blocked — don't nag
}

export function markChangelogSeen(): void {
  try { localStorage.setItem(SEEN_KEY, String(LATEST_CHANGELOG_ID)); } catch { /* storage blocked */ }
  syncBadge();
}

/** Entries newer than what this device last saw. A device that has never
 * opened the window gets just the latest entry, not the whole history. */
export function unseenChangelog(): ChangelogEntry[] {
  const seen = seenId();
  if (seen == null) return CHANGELOG.slice(0, 1);
  return CHANGELOG.filter((e) => e.id > seen);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function changelogEntriesHtml(entries: ChangelogEntry[]): string {
  return entries.map((e) => `
    <div class="whats-new-entry">
      <div class="whats-new-head">
        <strong>${escapeHtml(e.title)}</strong>
        <span class="whats-new-meta">${e.version ? `<span dir="ltr">${escapeHtml(e.version)}</span> · ` : ''}${fmtDate(e.date)}</span>
      </div>
      <ul>${e.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>`).join('');
}

export function openWhatsNew(): void {
  const unseen = new Set(unseenChangelog().map((e) => e.id));
  const box = document.createElement('div');
  box.className = 'whats-new-dialog';
  box.innerHTML = `
    <h3>${icon('info')} מה חדש</h3>
    ${__APP_VERSION__ ? `<p class="hint">גרסה נוכחית: <span dir="ltr">${__APP_VERSION__}</span></p>` : ''}
    <div class="whats-new-list">${changelogEntriesHtml(CHANGELOG)}</div>
    <div class="modal-actions"><button type="button" class="btn btn-primary" id="wn-close">סגירה</button></div>`;
  box.querySelectorAll<HTMLElement>('.whats-new-entry').forEach((el, i) => {
    if (unseen.has(CHANGELOG[i]!.id)) el.classList.add('whats-new-unseen');
  });
  const close = showModal(box);
  box.querySelector('#wn-close')!.addEventListener('click', close);
  markChangelogSeen();
}

function syncBadge(): void {
  const btn = document.getElementById('whats-new-btn');
  if (!btn) return;
  const seen = seenId();
  btn.classList.toggle('has-unseen', seen == null || seen < LATEST_CHANGELOG_ID);
}

export function setupWhatsNewButton(): void {
  const btn = document.getElementById('whats-new-btn');
  if (!btn) return;
  btn.innerHTML = icon('info') + '<span class="whats-new-dot"></span>';
  btn.addEventListener('click', openWhatsNew);
  syncBadge();
}
