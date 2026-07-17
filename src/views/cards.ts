/* views/cards.ts — מסך יומן (ראשי): כרטיס לכל תצפית עם מיקום לחיץ (מפות),
 * רשימת מינים ממוספרת, הערה ותמונות לכל מין. לחיצה על כרטיס פותחת מסך צפייה
 * (View Mode) בלבד — העריכה עוברת דרך כפתור ייעודי שם. כולל קיבוץ/מיון לפי
 * תאריך, מיקום או פרויקט, וכפתור FAB להוספת תצפית. */

import { listObservations } from '../db/repository';
import { renderObservationCard } from '../lib/obs-card';
import { qs, select } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';

type GroupMode = 'none' | 'day' | 'month' | 'location' | 'project';

let container: HTMLElement;
let observations: Observation[] = [];
let groupBy: GroupMode = 'none';

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>יומן תצפית</h2>
    <div class="filter-bar">
      <select id="j-group" class="filter-sel">
        <option value="none">ללא קיבוץ</option>
        <option value="day">קיבוץ לפי יום</option>
        <option value="month">קיבוץ לפי חודש</option>
        <option value="location">קיבוץ לפי מיקום</option>
        <option value="project">קיבוץ לפי פרויקט</option>
      </select>
    </div>
    <div id="cards-feed-wrap"></div>
  `;
  select(container, '#j-group').addEventListener('change', (e) => {
    groupBy = (e.target as HTMLSelectElement).value as GroupMode;
    render();
  });
}

export async function activate(): Promise<void> {
  observations = await listObservations();
  render();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function groupOf(o: Observation): { key: string; label: string } {
  switch (groupBy) {
    case 'day': {
      const key = dayKey(o.dateTime);
      const label = new Date(o.dateTime).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return { key, label };
    }
    case 'month': {
      const key = monthKey(o.dateTime);
      const label = new Date(o.dateTime).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
      return { key, label };
    }
    case 'location': {
      const label = o.locationName || '(ללא מיקום)';
      return { key: label, label };
    }
    case 'project': {
      const label = o.project || '(ללא פרויקט)';
      return { key: label, label };
    }
    default:
      return { key: '', label: '' };
  }
}

function render(): void {
  const wrap = qs(container, '#cards-feed-wrap');
  wrap.innerHTML = '';
  if (!observations.length) {
    wrap.innerHTML = '<p style="color:var(--ink-soft)">אין עדיין תצפיות — הוסיפו תצפית עם כפתור ה־➕ 📝</p>';
    return;
  }

  const feed = document.createElement('div');
  feed.className = 'cards-feed';
  wrap.appendChild(feed);

  if (groupBy === 'none') {
    for (const o of observations) feed.appendChild(cardWithClick(o));
    return;
  }

  const groups = new Map<string, { label: string; items: Observation[] }>();
  for (const o of observations) {
    const { key, label } = groupOf(o);
    (groups.get(key) ?? groups.set(key, { label, items: [] }).get(key)!).items.push(o);
  }
  const keys = [...groups.keys()].sort((a, b) => (groupBy === 'day' || groupBy === 'month' ? (a < b ? 1 : a > b ? -1 : 0) : a.localeCompare(b, 'he')));
  for (const key of keys) {
    const group = groups.get(key)!;
    const head = document.createElement('h3');
    head.className = 'cards-group-head';
    head.textContent = group.label;
    feed.appendChild(head);
    for (const o of group.items) feed.appendChild(cardWithClick(o));
  }
}

function cardWithClick(o: Observation): HTMLElement {
  const card = renderObservationCard(o);
  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.place-link, .species-imgs img')) return;
    navigate('detail', { viewId: o.id });
  });
  return card;
}

// Called by the FAB in the app chrome.
export function newObservation(): void {
  navigate('form');
}
