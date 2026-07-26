/* views/calendar.ts — תצוגת לוח שנה: חודש עם נקודת/מספר תצפיות בכל יום.
 * לחיצה על יום מציגה למטה את התצפיות שלו (כמו ביומן) עם כפתור להוספת
 * תצפית חדשה לאותו יום; לחיצה על תצפית קיימת פותחת את מסך הצפייה שלה. */

import { listObservations } from '../db/repository';
import { escapeHtml } from '../lib/markdown';
import { renderObservationCard } from '../lib/obs-card';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';
import type { ViewParams } from './view';

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

type ViewMode = 'month' | 'year';

let container: HTMLElement;
let observations: Observation[] = [];
let byDay = new Map<string, Observation[]>();
let monthCursor = startOfMonth(new Date());
let selectedDay: string | null = null;
let viewMode: ViewMode = 'month';

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>לוח שנה</h2>
    <div class="cal-header">
      <button class="btn btn-icon" id="cal-prev" title="הקודם" aria-label="הקודם">‹</button>
      <h3 id="cal-month-label"></h3>
      <button class="btn btn-icon" id="cal-next" title="הבא" aria-label="הבא">›</button>
      <button class="btn btn-icon" id="cal-zoom" title="תצוגה שנתית" aria-label="תצוגה שנתית">${icon('grid')}</button>
      <button class="btn btn-sm" id="cal-today">היום</button>
    </div>
    <div class="cal-weekdays" id="cal-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid" id="cal-grid"></div>
    <div id="cal-agenda"></div>
  `;
  qs(container, '#cal-prev').addEventListener('click', () => { shiftCursor(-1); });
  qs(container, '#cal-next').addEventListener('click', () => { shiftCursor(1); });
  qs(container, '#cal-zoom').addEventListener('click', toggleViewMode);
  qs(container, '#cal-today').addEventListener('click', () => {
    monthCursor = startOfMonth(new Date());
    selectedDay = localDay(new Date().toISOString());
    viewMode = 'month';
    render();
  });
  qs(container, '#cal-grid').addEventListener('click', onGridClick);
}

/** Drill-down from the stats tab: opens the calendar in year view for the given year. */
export function setParams(params: ViewParams): void {
  if (params.year == null) return;
  monthCursor = new Date(params.year, monthCursor.getMonth(), 1);
  viewMode = 'year';
  selectedDay = null;
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

function shiftCursor(delta: number): void {
  monthCursor = viewMode === 'year'
    ? new Date(monthCursor.getFullYear() + delta, monthCursor.getMonth(), 1)
    : new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1);
  render();
}

function toggleViewMode(): void {
  viewMode = viewMode === 'month' ? 'year' : 'month';
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
  qs(container, '#cal-month-label').textContent = viewMode === 'year'
    ? String(monthCursor.getFullYear())
    : monthCursor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  qs(container, '#cal-weekdays').hidden = viewMode === 'year';
  qs(container, '#cal-grid').className = viewMode === 'year' ? 'cal-grid cal-year-grid' : 'cal-grid';
  const zoomBtn = qs<HTMLButtonElement>(container, '#cal-zoom');
  zoomBtn.innerHTML = viewMode === 'year' ? icon('calendar') : icon('grid');
  zoomBtn.title = viewMode === 'year' ? 'תצוגה חודשית' : 'תצוגה שנתית';
  if (viewMode === 'year') {
    renderYearGrid();
    qs(container, '#cal-agenda').innerHTML = '';
  } else {
    renderGrid();
    renderAgenda();
  }
}

function renderYearGrid(): void {
  const grid = qs(container, '#cal-grid');
  const year = monthCursor.getFullYear();
  const counts = Array(12).fill(0) as number[];
  for (const o of observations) {
    const d = new Date(o.dateTime);
    if (!isNaN(d.getTime()) && d.getFullYear() === year) counts[d.getMonth()]!++;
  }
  const max = Math.max(...counts);
  const now = new Date();

  grid.innerHTML = MONTH_NAMES.map((name, i) => {
    const count = counts[i]!;
    const ratio = max ? count / max : 0;
    const heat = count === 0 ? 0 : ratio <= 0.33 ? 1 : ratio <= 0.66 ? 2 : 3;
    const isToday = year === now.getFullYear() && i === now.getMonth();
    return `
      <button class="cal-year-tile heat-${heat}${isToday ? ' today' : ''}" data-month="${i}">
        <span class="cal-year-tile-name">${name}</span>
        ${count ? `<span class="cal-year-tile-count">${count}</span>` : ''}
      </button>`;
  }).join('');
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
        ${locLabel ? `<span class="cal-loc">${icon('pin')} ${escapeHtml(locLabel)}</span>` : ''}
      </button>`);
  }
  grid.innerHTML = cells.join('');
}

function onGridClick(e: Event): void {
  const target = e.target as HTMLElement;
  const yearTile = target.closest<HTMLButtonElement>('.cal-year-tile');
  if (yearTile) {
    monthCursor = new Date(monthCursor.getFullYear(), Number(yearTile.dataset.month), 1);
    viewMode = 'month';
    render();
    return;
  }
  const btn = target.closest<HTMLButtonElement>('.cal-day');
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
  addBtn.innerHTML = `${icon('plus')} הוספת תצפית ליום זה`;
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
      if (target.closest('.place-link, .species-imgs img, .media-link')) return;
      navigate('detail', { viewId: o.id });
    });
    feed.appendChild(card);
  }
}
