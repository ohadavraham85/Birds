/* lib/bulk-edit.ts — the "bulk edit" modal (set tags and/or location for
 * a batch of observations at once) and the mutation that applies it. Shared
 * by the table view and the journal's long-press multi-select. */

import { listTagRows, listLocationRows, getObservation, saveObservation } from '../db/repository';
import { wireCombo } from './combo';
import { escapeHtml } from './markdown';
import type { Observation, LocationRow } from '../types';

export interface BulkEditResult {
  /** Replaces each selected observation's tags with exactly this set. */
  tags?: string[];
  location?: { name: string; lat: number | null; lng: number | null };
}

export async function openBulkEditModal(count: number, observations: Observation[]): Promise<BulkEditResult | null> {
  const tagRows = await listTagRows();
  const locationRows = await listLocationRows();
  const savedLocations = new Map<string, LocationRow>(locationRows.map((l) => [l.name, l]));
  const locationSuggestions = [...new Set([...observations.map((o) => o.locationName), ...locationRows.map((l) => l.name)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));

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
      if (!('tags' in result) && !('location' in result)) { close(null); return; }
      close(result);
    });
    backdrop.querySelector('#be-cancel')!.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
  });
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
    await saveObservation(obs);
    updated++;
  }
  return updated;
}
