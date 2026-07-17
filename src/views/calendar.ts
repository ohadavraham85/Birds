/* views/calendar.ts — תצוגת לוח שנה: חודש עם נקודת/מספר תצפיות בכל יום.
 * לחיצה על יום מציגה למטה את התצפיות שלו (כמו ביומן) עם כפתור להוספת
 * תצפית חדשה לאותו יום; לחיצה על תצפית קיימת פותחת את מסך הצפייה שלה. */

import { listObservations } from '../db/repository';
import { escapeHtml } from '../lib/markdown';
import { renderObservationCard } from '../lib/obs-card';
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
    const dayObs = byDay.get(dayStr) ?? [];
    const count = dayObs.length;
    const locs = [...new Set(dayObs.map((o) => o.locationName).filter(Boolean))];
    const locLabel = locs.length > 1 ? `${locs[0]} +${locs.length - 1}` : (locs[0] || '');
    const classes = ['cal-day'];
    if (!inMonth) classes.push('muted');
    if (dayStr === todayStr) classes.push('today');
    if (count) classes.push('has-obs');
    if (dayStr === selectedDay) classes.push('selected');
    cells.push(`
      <button class="${classes.join(' ')}" data-day="${dayStr}"${locs.length ? ` title="${escapeHtml(locs.join(', '))}"` : ''}>
        <span class="cal-daynum">${date.getDate()}</span>
        ${count ? `<span class="cal-dot">${count}</span>` : ''}
        ${locLabel ? `<span class="cal-loc">📍 ${escapeHtml(locLabel)}</span>` : ''}
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
  agenda.innerHTML = '';
  if (!selectedDay) return;

  const items = (byDay.get(selectedDay) ?? [])
    .slice()
    .sort((a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0));
  const dateLabel = new Date(selectedDay).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const day = selectedDay;

  const head = document.createElement('div');
  head.className = 'cal-agenda-head';
  const title = document.createElement('h3');
  title.textContent = dateLabel + (items.length ? ` · ${items.length} תצפיות` : '');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '➕ הוספת תצפית ליום זה';
  addBtn.addEventListener('click', () => navigate('form', { date: day }));
  head.append(title, addBtn);
  agenda.appendChild(head);

  if (!items.length) {
    agenda.insertAdjacentHTML('beforeend', '<p style="color:var(--ink-soft)">אין תצפיות ביום זה.</p>');
    return;
  }

  const feed = document.createElement('div');
  feed.className = 'cards-feed';
  agenda.appendChild(feed);
  for (const o of items) {
    const card = renderObservationCard(o);
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.place-link, .species-imgs img')) return;
      navigate('detail', { viewId: o.id });
    });
    feed.appendChild(card);
  }
}
