/* lib/photo-picker.ts — modal grid for picking previously-uploaded, not-yet-
 * associated ("orphan") gallery photos to attach directly to a species entry
 * in the observation form, as an alternative to capturing new photos. */

import { listAllMedia, saveMedia } from '../db/repository';
import { getMediaObjectUrl } from './media';
import { showModal } from './ui';
import type { ObservationImage } from '../types';

/** Resolves to the picked photos' ObservationImage references (already
 * claimed for `obsId`), or an empty array if the user picked none/cancelled. */
export function pickFromGallery(obsId: string): Promise<ObservationImage[]> {
  return new Promise((resolve) => {
    void (async () => {
      const orphans = (await listAllMedia()).filter((m) => !m.obsId);
      const wrap = document.createElement('div');
      wrap.className = 'photo-picker-modal';
      if (!orphans.length) {
        wrap.innerHTML = `
          <h3>בחירה מהגלריה</h3>
          <p class="map-sheet-empty">אין בגלריה תמונות שעדיין לא שויכו לתצפית. אפשר להעלות תמונות חדשות בטאב "גלריה".</p>
          <div class="modal-actions"><button type="button" class="btn photo-picker-cancel">סגירה</button></div>
        `;
        const close = showModal(wrap);
        wrap.querySelector('.photo-picker-cancel')!.addEventListener('click', () => { close(); resolve([]); });
        return;
      }

      wrap.innerHTML = `
        <h3>בחירה מהגלריה</h3>
        <div class="photo-picker-grid"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary photo-picker-confirm">הוספה</button>
          <button type="button" class="btn photo-picker-cancel">ביטול</button>
        </div>
      `;
      const close = showModal(wrap);
      const selected = new Set<string>();
      const grid = wrap.querySelector<HTMLElement>('.photo-picker-grid')!;
      for (const m of orphans) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'photo-picker-tile';
        tile.innerHTML = '<img alt="">';
        tile.addEventListener('click', () => {
          if (selected.has(m.id)) { selected.delete(m.id); tile.classList.remove('selected'); }
          else { selected.add(m.id); tile.classList.add('selected'); }
        });
        grid.appendChild(tile);
        void getMediaObjectUrl(m).then((url) => { if (url) tile.querySelector('img')!.src = url; });
      }

      wrap.querySelector('.photo-picker-confirm')!.addEventListener('click', () => {
        void (async () => {
          const picked: ObservationImage[] = [];
          for (const m of orphans) {
            if (!selected.has(m.id)) continue;
            await saveMedia({ ...m, obsId });
            picked.push({ localId: m.id, name: m.name });
          }
          close();
          resolve(picked);
        })();
      });
      wrap.querySelector('.photo-picker-cancel')!.addEventListener('click', () => { close(); resolve([]); });
    })();
  });
}
