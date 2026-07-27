/* lib/bulk-edit.ts — the "bulk edit" modal (set tags and/or location for
 * a batch of observations at once) and the mutation that applies it. Shared
 * by the table view and the journal's long-press multi-select. */

import { listTagRows, listLocationRows, listObserverRows, addObserver, getObservation, saveObservation } from '../db/repository';
import { wireCombo } from './combo';
import { escapeHtml } from './markdown';
import { icon } from './icons';
import type { Observation, LocationRow } from '../types';

export interface BulkEditResult {
  /** Replaces each selected observation's tags with exactly this set. */
  tags?: string[];
  location?: { name: string; lat: number | null; lng: number | null };
  /** Replaces each selected observation's observers with exactly this set. */
  observers?: string[];
  /** Appended to each selected observation's existing notes (on a new line), never overwritten. */
  appendNotes?: string;
  starred?: boolean;
}

export async function openBulkEditModal(count: number, observations: Observation[]): Promise<BulkEditResult | null> {
  const tagRows = await listTagRows();
  const locationRows = await listLocationRows();
  let observerRows = await listObserverRows();
  const savedLocations = new Map<string, LocationRow>(locationRows.map((l) => [l.name, l]));
  const locationSuggestions = [...new Set([...observations.map((o) => o.locationName), ...locationRows.map((l) => l.name)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
  const selectedObservers = new Set<string>();

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal bulk-edit-modal">
        <h3>עריכה מרוכזת — ${count} תצפיות</h3>
        <label class="notif-toggle-row"><span>עדכון תגיות</span><input type="checkbox" id="be-tags-toggle"></label>
        <div class="filter-modal-checks" id="be-tags-field" hidden>
          ${tagRows.map((t) => `
            <label class="filter-modal-check">
              <input type="checkbox" class="be-tag-check" value="${escapeHtml(t.name)}">
              <span>${escapeHtml(t.name)}</span>
            </label>`).join('') || '<p class="hint">אין תגיות שמורות — ניתן ליצור בהגדרות</p>'}
        </div>
        <label class="notif-toggle-row"><span>עדכון מיקום</span><input type="checkbox" id="be-location-toggle"></label>
        <div class="field combo" id="be-location-field" hidden>
          <input type="text" id="be-location" placeholder="שם מיקום...">
          <div class="combo-list" hidden></div>
          <span class="hint" id="be-location-hint"></span>
        </div>
        <label class="notif-toggle-row"><span>עדכון צופים</span><input type="checkbox" id="be-observers-toggle"></label>
        <div class="field" id="be-observers-field" hidden>
          <div class="observer-picker" id="be-observer-picker"></div>
          <div class="tag-quick-add">
            <input type="text" id="be-observer-new" placeholder="הוספת צופה חדש...">
            <button type="button" class="btn btn-sm" id="be-observer-add">${icon('plus')} הוספה</button>
          </div>
        </div>
        <label class="notif-toggle-row"><span>הוספת הערה</span><input type="checkbox" id="be-notes-toggle"></label>
        <div class="field" id="be-notes-field" hidden>
          <textarea id="be-notes" rows="2" placeholder="טקסט זה יתווסף בשורה חדשה להערות הקיימות של כל תצפית שנבחרה..."></textarea>
        </div>
        <label class="notif-toggle-row"><span>עדכון סימון מועדף</span><input type="checkbox" id="be-starred-toggle"></label>
        <div class="field" id="be-starred-field" hidden>
          <label class="filter-modal-check"><input type="radio" name="be-starred" value="1" checked><span>סמן כמועדף</span></label>
          <label class="filter-modal-check"><input type="radio" name="be-starred" value="0"><span>בטל סימון מועדף</span></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="be-apply">עדכון</button>
          <button class="btn" id="be-cancel">ביטול</button>
        </div>
      </div>`;
    document.getElementById('modal-root')!.appendChild(backdrop);

    const close = (result: BulkEditResult | null): void => { backdrop.remove(); resolve(result); };

    const tagsToggle = backdrop.querySelector<HTMLInputElement>('#be-tags-toggle')!;
    const tagsField = backdrop.querySelector<HTMLElement>('#be-tags-field')!;
    tagsToggle.addEventListener('change', () => { tagsField.hidden = !tagsToggle.checked; });

    const locationToggle = backdrop.querySelector<HTMLInputElement>('#be-location-toggle')!;
    const locationField = backdrop.querySelector<HTMLElement>('#be-location-field')!;
    const locationInput = backdrop.querySelector<HTMLInputElement>('#be-location')!;
    const locationHint = backdrop.querySelector<HTMLElement>('#be-location-hint')!;
    locationToggle.addEventListener('change', () => { locationField.hidden = !locationToggle.checked; });
    const updateLocationHint = (): void => {
      const saved = savedLocations.get(locationInput.value.trim());
      locationHint.textContent = saved && saved.lat != null && saved.lng != null
        ? 'מיקום שמור — הקואורדינטות שלו ייקבעו אוטומטית לכל התצפיות שנבחרו'
        : '';
    };
    locationInput.addEventListener('input', updateLocationHint);
    wireCombo(locationInput, backdrop.querySelector<HTMLElement>('#be-location-field .combo-list')!, () => locationSuggestions, {
      onSelect: () => updateLocationHint(),
    });

    const observersToggle = backdrop.querySelector<HTMLInputElement>('#be-observers-toggle')!;
    const observersField = backdrop.querySelector<HTMLElement>('#be-observers-field')!;
    observersToggle.addEventListener('change', () => { observersField.hidden = !observersToggle.checked; });
    const observerPicker = backdrop.querySelector<HTMLElement>('#be-observer-picker')!;
    const renderObserverPicker = (): void => {
      observerPicker.innerHTML = observerRows.map((o) => `
        <button type="button" class="observer-chip${selectedObservers.has(o.name) ? ' selected' : ''}" data-name="${escapeHtml(o.name)}">${escapeHtml(o.name)}</button>`).join('')
        || '<p class="hint">אין צופים שמורים</p>';
    };
    renderObserverPicker();
    observerPicker.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.observer-chip');
      if (!btn) return;
      const name = btn.dataset.name!;
      if (selectedObservers.has(name)) selectedObservers.delete(name); else selectedObservers.add(name);
      btn.classList.toggle('selected', selectedObservers.has(name));
    });
    backdrop.querySelector('#be-observer-add')!.addEventListener('click', async () => {
      const inp = backdrop.querySelector<HTMLInputElement>('#be-observer-new')!;
      const name = inp.value.trim();
      if (!name) return;
      if (!observerRows.some((o) => o.name === name)) {
        await addObserver(name);
        observerRows = await listObserverRows();
      }
      selectedObservers.add(name);
      inp.value = '';
      renderObserverPicker();
    });

    const notesToggle = backdrop.querySelector<HTMLInputElement>('#be-notes-toggle')!;
    const notesField = backdrop.querySelector<HTMLElement>('#be-notes-field')!;
    notesToggle.addEventListener('change', () => { notesField.hidden = !notesToggle.checked; });

    const starredToggle = backdrop.querySelector<HTMLInputElement>('#be-starred-toggle')!;
    const starredField = backdrop.querySelector<HTMLElement>('#be-starred-field')!;
    starredToggle.addEventListener('change', () => { starredField.hidden = !starredToggle.checked; });

    backdrop.querySelector('#be-apply')!.addEventListener('click', () => {
      const result: BulkEditResult = {};
      if (tagsToggle.checked) {
        result.tags = [...backdrop.querySelectorAll<HTMLInputElement>('.be-tag-check:checked')].map((cb) => cb.value);
      }
      if (locationToggle.checked) {
        const name = locationInput.value.trim();
        const saved = savedLocations.get(name);
        result.location = { name, lat: saved?.lat ?? null, lng: saved?.lng ?? null };
      }
      if (observersToggle.checked) {
        result.observers = [...selectedObservers];
      }
      if (notesToggle.checked) {
        const text = backdrop.querySelector<HTMLTextAreaElement>('#be-notes')!.value.trim();
        if (text) result.appendNotes = text;
      }
      if (starredToggle.checked) {
        result.starred = backdrop.querySelector<HTMLInputElement>('input[name="be-starred"]:checked')!.value === '1';
      }
      if (!Object.keys(result).length) { close(null); return; }
      close(result);
    });
    backdrop.querySelector('#be-cancel')!.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
  });
}

/** Human-readable summary of a `BulkEditResult`, for the confirm-dialog prompt. */
export function summarizeBulkEdit(result: BulkEditResult): string[] {
  const parts: string[] = [];
  if ('tags' in result) parts.push(`תגיות → ${result.tags!.length ? result.tags!.join(', ') : '(ללא תגית)'}`);
  if ('location' in result) parts.push(`מיקום → "${result.location!.name}"`);
  if ('observers' in result) parts.push(`צופים → ${result.observers!.length ? result.observers!.join(', ') : '(ללא)'}`);
  if ('appendNotes' in result) parts.push('הוספת הערה');
  if ('starred' in result) parts.push(result.starred ? 'סימון כמועדף' : 'ביטול סימון מועדף');
  return parts;
}

/** Applies `result` to every observation in `ids`; returns how many were actually found and updated. */
export async function applyBulkEdit(ids: string[], result: BulkEditResult): Promise<number> {
  let updated = 0;
  for (const id of ids) {
    const obs = await getObservation(id);
    if (!obs) continue;
    if ('tags' in result) {
      obs.tags = result.tags!;
      obs.project = result.tags![0] || '';
    }
    if ('location' in result) {
      obs.locationName = result.location!.name;
      obs.lat = result.location!.lat;
      obs.lng = result.location!.lng;
    }
    if ('observers' in result) {
      obs.observers = result.observers!;
    }
    if ('appendNotes' in result) {
      obs.notes = obs.notes ? `${obs.notes}\n${result.appendNotes!}` : result.appendNotes!;
    }
    if ('starred' in result) {
      obs.starred = result.starred!;
    }
    await saveObservation(obs);
    updated++;
  }
  return updated;
}
