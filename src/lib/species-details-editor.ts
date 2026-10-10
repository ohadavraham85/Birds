/* lib/species-details-editor.ts — full-details editor for a species: English
 * and scientific name and family (otherwise read from the bundled reference
 * data — an override here takes precedence, see species-details-cache.ts),
 * plus the manual status-badge override. Opened from Settings' species list
 * and from each card in the "מינים" tab. */

import { listSpeciesRows, updateSpeciesDetails } from '../db/repository';
import { getSpeciesDetail, listKnownFamilies, refreshSpeciesDetailsCache } from './species-details-cache';
import { generalGroupOf } from '../data/species-groups';
import { escapeHtml } from './markdown';
import { qs } from './dom';
import { toast } from './ui';
import { SPECIES_TAGS, SPECIES_TAG_LABELS, type SpeciesTag } from '../types';

export async function openSpeciesDetailsEditor(name: string, onSaved?: () => void): Promise<void> {
  const d = getSpeciesDetail(name);
  const rows = await listSpeciesRows();
  const currentTag = rows.find((r) => r.name === name)?.manualTag || '';
  const families = listKnownFamilies();
  const groupHint = (family: string): string => (family ? `קבוצה כללית: ${generalGroupOf(family)}` : '');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal bulk-edit-modal">
      <h3>עריכת פרטי מין — ${escapeHtml(name)}</h3>
      <div class="field">
        <label for="spd-en">שם אנגלי</label>
        <input type="text" id="spd-en" dir="ltr" value="${escapeHtml(d.en)}">
      </div>
      <div class="field">
        <label for="spd-sci">שם מדעי</label>
        <input type="text" id="spd-sci" dir="ltr" value="${escapeHtml(d.sci)}">
      </div>
      <div class="field">
        <label for="spd-family">משפחה</label>
        <select id="spd-family">
          <option value="">ללא משפחה</option>
          ${families.map((f) => `<option value="${escapeHtml(f)}"${f === d.family ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('')}
        </select>
        <p class="hint" id="spd-group" style="margin:4px 0 0">${escapeHtml(groupHint(d.family))}</p>
      </div>
      <div class="field">
        <label for="spd-tag">סיווג</label>
        <select id="spd-tag">
          <option value=""${!currentTag ? ' selected' : ''}>אוטומטי (לפי מספר תצפיות)</option>
          ${SPECIES_TAGS.map((tag) => `<option value="${tag}"${currentTag === tag ? ' selected' : ''}>${SPECIES_TAG_LABELS[tag]}</option>`).join('')}
        </select>
      </div>
      <p class="hint" style="margin-top:0">אוטומטי: 0 תצפיות → ${SPECIES_TAG_LABELS.unseen}, תצפית אחת → ${SPECIES_TAG_LABELS.lifer}, יותר → ${SPECIES_TAG_LABELS.seen}. סיווג ידני גובר על החישוב האוטומטי — ניתן גם לשנות אותו בלחיצה על התגית ברשימת המינים.</p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="spd-save">שמירה</button>
        <button class="btn" id="spd-cancel">ביטול</button>
      </div>
    </div>`;
  document.getElementById('modal-root')!.appendChild(backdrop);
  const close = (): void => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs(backdrop, '#spd-cancel').addEventListener('click', close);
  const familySel = qs<HTMLSelectElement>(backdrop, '#spd-family');
  familySel.addEventListener('change', () => { qs(backdrop, '#spd-group').textContent = groupHint(familySel.value); });
  qs(backdrop, '#spd-save').addEventListener('click', () => {
    void (async () => {
      const en = qs<HTMLInputElement>(backdrop, '#spd-en').value.trim();
      const sci = qs<HTMLInputElement>(backdrop, '#spd-sci').value.trim();
      const family = familySel.value;
      const manualTag = qs<HTMLSelectElement>(backdrop, '#spd-tag').value as SpeciesTag | '';
      await updateSpeciesDetails(name, { en, sci, family, manualTag });
      await refreshSpeciesDetailsCache();
      close();
      toast(`פרטי "${name}" עודכנו`);
      onSaved?.();
    })();
  });
}
