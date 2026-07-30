/* views/home.ts — מסך הבית: לוח מחוונים עם ספירת נכסים לפי סטטוס/סוג
 * (לחיצה מסננת את הרשימה), וטבלת פעילות תחזוקה אחרונה. */

import { listAssets, listMaintenance } from '../db/repository';
import { escapeHtml } from '../lib/markdown';
import { icon } from '../lib/icons';
import { ASSET_TYPE_META, ASSET_STATUS_META } from '../lib/asset-meta';
import { ASSET_TYPES, ASSET_STATUSES } from '../types';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Asset, AssetType, AssetStatus, MaintenanceLog } from '../types';

let container: HTMLElement;

export function init(el: HTMLElement): void {
  container = el;
}

function statusTilesHtml(assets: Asset[]): string {
  return ASSET_STATUSES.map((s) => {
    const count = assets.filter((a) => a.status === s).length;
    const meta = ASSET_STATUS_META[s];
    return `
      <button type="button" class="stat-tile stat-tile-link" data-filter-status="${s}" style="border-color:${meta.color}">
        <span class="stat-tile-value" style="color:${meta.color}">${count}</span>
        <span class="stat-tile-label">${meta.label}</span>
      </button>`;
  }).join('');
}

function typeTilesHtml(assets: Asset[]): string {
  return ASSET_TYPES.map((t) => {
    const count = assets.filter((a) => a.type === t).length;
    const meta = ASSET_TYPE_META[t];
    return `
      <button type="button" class="type-tile" data-filter-type="${t}">
        <span class="type-tile-icon">${icon(meta.icon)}</span>
        <span class="type-tile-num">${count}</span>
        <span class="type-tile-label">${meta.label}</span>
      </button>`;
  }).join('');
}

function activityRowHtml(log: MaintenanceLog, assetName: string): string {
  return `
    <button type="button" class="activity-row" data-id="${log.assetId}">
      <span class="activity-row-date">${escapeHtml(log.date)}</span>
      <span class="activity-row-main">
        <strong>${escapeHtml(assetName)}</strong>
        ${log.description ? `<span class="hint">${escapeHtml(log.description)}</span>` : ''}
      </span>
      ${log.technician ? `<span class="hint">${escapeHtml(log.technician)}</span>` : ''}
    </button>`;
}

export async function activate(): Promise<void> {
  const assets = await listAssets();
  const logs = (await listMaintenance()).slice(0, 8);
  const assetById = new Map(assets.map((a) => [a.id, a]));

  container.innerHTML = `
    <h2>${icon('bolt')} ניהול נכסי חשמל</h2>
    <p class="hint">${assets.length} נכסים במערכת</p>

    <button type="button" class="btn btn-primary btn-block" id="home-add">${icon('plus')} נכס חדש</button>

    <h3>סטטוס נכסים</h3>
    <div class="stat-tiles">${statusTilesHtml(assets)}</div>

    <h3>סוגי נכסים</h3>
    <div class="type-tiles">${typeTilesHtml(assets)}</div>

    <h3>${icon('wrench')} פעילות תחזוקה אחרונה</h3>
    <div class="activity-list">
      ${logs.length ? logs.map((l) => activityRowHtml(l, assetById.get(l.assetId)?.name || assetById.get(l.assetId)?.code || 'נכס שנמחק')).join('') : '<p class="hint">אין עדיין רשומות תחזוקה.</p>'}
    </div>
  `;

  qs(container, '#home-add').addEventListener('click', () => navigate('form'));
  container.querySelectorAll<HTMLElement>('[data-filter-status]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('list', { filterStatus: btn.dataset.filterStatus as AssetStatus }));
  });
  container.querySelectorAll<HTMLElement>('[data-filter-type]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('list', { filterType: btn.dataset.filterType as AssetType }));
  });
  container.querySelectorAll<HTMLElement>('.activity-row').forEach((btn) => {
    btn.addEventListener('click', () => navigate('detail', { viewId: btn.dataset.id! }));
  });
}
