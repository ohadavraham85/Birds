/* views/detail.ts — מסך צפייה בתצפית בודדת (View Mode): תצוגה נקייה וקריאה-בלבד
 * של פרטי התצפית, עם כפתור "עריכה" ייעודי שפותח את טופס העריכה, וייצוא PDF. */

import { getObservation } from '../db/repository';
import { toast } from '../lib/ui';
import { renderObservationCard } from '../lib/obs-card';
import { exportObservationsPdf } from '../lib/pdf';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate, goBack } from '../main';
import type { ViewParams } from './view';
import type { Observation } from '../types';

let container: HTMLElement;
let viewId: string | null = null;
let current: Observation | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="detail-back">→ חזרה</button>
      <h2>פרטי תצפית</h2>
    </div>
    <div id="detail-body"></div>
    <div class="detail-actions">
      <button class="btn btn-primary" id="detail-edit">${icon('edit')} עריכה</button>
      <button class="btn" id="detail-pdf">${icon('document')} ייצוא PDF</button>
    </div>
  `;
  qs(container, '#detail-back').addEventListener('click', goBack);
  qs(container, '#detail-edit').addEventListener('click', () => {
    if (current) navigate('form', { editId: current.id });
  });
  qs(container, '#detail-pdf').addEventListener('click', () => void onExportPdf());
}

export function setParams(params: ViewParams): void {
  viewId = params?.viewId || null;
}

export async function activate(): Promise<void> {
  const body = qs(container, '#detail-body');
  current = viewId ? (await getObservation(viewId)) || null : null;
  if (!current) {
    body.innerHTML = '<p style="color:var(--ink-soft)">התצפית לא נמצאה — ייתכן שנמחקה.</p>';
    qs<HTMLButtonElement>(container, '#detail-edit').disabled = true;
    qs<HTMLButtonElement>(container, '#detail-pdf').disabled = true;
    return;
  }
  qs<HTMLButtonElement>(container, '#detail-edit').disabled = false;
  qs<HTMLButtonElement>(container, '#detail-pdf').disabled = false;
  body.innerHTML = '';
  const card = renderObservationCard(current);
  card.classList.add('static-card');
  body.appendChild(card);
}

async function onExportPdf(): Promise<void> {
  if (!current) return;
  try {
    await exportObservationsPdf([current]);
  } catch (err) {
    toast('הפקת ה-PDF נכשלה: ' + (err as Error).message, true, 5000);
  }
}
