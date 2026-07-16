/* views/calendar.ts — תצוגת לוח שנה: חודש עם נקודת/מספר תצפיות בכל יום,
 * לחיצה על יום מציגה למטה את התצפיות של אותו יום. */

import { listObservations, deleteObservation } from '../db/repository';
import { fmtDateTime, toast, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesLabel } from '../lib/observation';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

let container: HTMLElement;
let observations: Observation[] = [];
let byDay = new Map<string, Observation[]>();
let monthCursor = startOfMonth(new Date());
let selectedDay: string | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>לוח שנה</h2>
    <div class="cal-header">
      <button class="btn btn-icon" id="cal-prev" title="חודש קודם" aria-label="חודש קודם">‹</button>
      <h3 id="cal-month-label"></h3>
      <button class="btn btn-icon" id="cal-next" title="חודש הבא" aria-label="חודש הבא">›</button>
      <button class="btn btn-sm" id="cal-today">היום</button>
    </div>
    <div class="cal-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid" id="cal-grid"></div>
    <div id="cal-agenda"></div>
  `;
  qs(container, '#cal-prev').addEventListener('click', () => { shiftMonth(-1); });
  qs(container, '#cal-next').addEventListener('click', () => { shiftMonth(1); });
  qs(container, '#cal-today').addEventListener('click', () => {
    monthCursor = startOfMonth(new Date());
    selectedDay = localDay(new Date().toISOString());
    render();
  });
  qs(container, '#cal-grid').addEventListener('click', onGridClick);
  qs(container, '#cal-agenda').addEventListener('click', (e) => void onAgendaClick(e));
}

export async function activate(): Promise<void> {
  observations = await listObservations();
  byDay = new Map();
  for (const o of observations) {
    const day = localDay(o.dateTime);
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(o);
  }
  render();
}

function shiftMonth(delta: number): void {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1);
  render();
}

function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function render(): void {
  qs(container, '#cal-month-label').textContent =
    monthCursor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  renderGrid();
  renderAgenda();
}

function renderGrid(): void {
  const grid = qs(container, '#cal-grid');
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - firstWeekday);
  const todayStr = localDay(new Date().toISOString());

  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dayStr = localDay(date.toISOString());
    const inMonth = date.getMonth() === month;
    const count = byDay.get(dayStr)?.length ?? 0;
    const classes = ['cal-day'];
    if (!inMonth) classes.push('muted');
    if (dayStr === todayStr) classes.push('today');
    if (count) classes.push('has-obs');
    if (dayStr === selectedDay) classes.push('selected');
    cells.push(`
      <button class="${classes.join(' ')}" data-day="${dayStr}">
        <span class="cal-daynum">${date.getDate()}</span>
        ${count ? `<span class="cal-dot">${count}</span>` : ''}
      </button>`);
  }
  grid.innerHTML = cells.join('');
}

function onGridClick(e: Event): void {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cal-day');
  if (!btn) return;
  const day = btn.dataset.day!;
  selectedDay = selectedDay === day ? null : day;
  render();
}

function renderAgenda(): void {
  const agenda = qs(container, '#cal-agenda');
  if (!selectedDay) { agenda.innerHTML = ''; return; }
  const items = (byDay.get(selectedDay) ?? [])
    .slice()
    .sort((a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0));
  const dateLabel = new Date(selectedDay).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  if (!items.length) {
    agenda.innerHTML = `
      <h3>${dateLabel}</h3>
      <p style="color:var(--ink-soft)">אין תצפיות ביום זה.</p>`;
    return;
  }

  agenda.innerHTML = `
    <h3>${dateLabel} · ${items.length} תצפיות</h3>
    <div class="cal-agenda-list">
      ${items.map((o) => `
        <div class="cal-agenda-item" data-id="${o.id}">
          <div class="cal-agenda-main">
            <span class="cal-agenda-time">🕒 ${fmtDateTime(o.dateTime).split(' ').pop()}</span>
            <span class="cal-agenda-species">${escapeHtml(speciesLabel(o) || '—')}</span>
            ${o.locationName ? `<span class="cal-agenda-place">📍 ${escapeHtml(o.locationName)}</span>` : ''}
          </div>
          <div class="cal-agenda-actions">
            <button class="btn btn-sm act-edit" title="עריכה">✏️</button>
            <button class="btn btn-sm act-del" title="מחיקה">🗑️</button>
          </div>
        </div>`).join('')}
    </div>`;
}

async function onAgendaClick(e: Event): Promise<void> {
  const item = (e.target as HTMLElement).closest<HTMLElement>('.cal-agenda-item');
  if (!item) return;
  const id = item.dataset.id!;
  if ((e.target as HTMLElement).closest('.act-edit')) { navigate('form', { editId: id }); return; }
  if ((e.target as HTMLElement).closest('.act-del')) {
    if (await confirmDialog('למחוק את התצפית?', 'מחיקה')) {
      await deleteObservation(id);
      await activate();
      toast('התצפית נמחקה');
    }
  }
}
