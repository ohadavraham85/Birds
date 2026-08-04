/* db/repository.ts — offline-first data access. Every mutation writes to the
 * local Dexie store immediately (so the UI is instant and works offline);
 * reads always come from the local store. */

import { db } from './database';
import type { Asset, MaintenanceLog, MediaRecord, Diagram, DiagramMarker, DiagramMediaRecord, LayoutNode, LayoutEdge } from '../types';

/* ---------- change notifications ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();

export function onDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emitChange(): void {
  for (const fn of listeners) fn();
}

function now(): string {
  return new Date().toISOString();
}

/* ---------- assets ---------- */

export async function saveAsset(asset: Asset): Promise<Asset> {
  asset.updatedAt = now();
  await db.assets.put(asset);
  emitChange();
  return asset;
}

export function getAsset(id: string): Promise<Asset | undefined> {
  return db.assets.get(id);
}

/** All non-deleted assets. */
export async function listAssets(): Promise<Asset[]> {
  const all = await db.assets.toArray();
  return all.filter((a) => !a.deleted);
}

/** Everything including tombstones — used by backup. */
export function listAssetsRaw(): Promise<Asset[]> {
  return db.assets.toArray();
}

export async function putAssetRaw(asset: Asset): Promise<void> {
  await db.assets.put(asset);
  emitChange();
}

/** Soft-deletes the asset and hard-deletes its media + maintenance log rows
 * (nothing local-only needs a tombstone for those — there is no sync). */
export async function deleteAsset(id: string): Promise<void> {
  const asset = await db.assets.get(id);
  if (!asset) return;
  const media = await mediaForAsset(id);
  for (const m of media) await db.media.delete(m.id);
  const logs = await listMaintenanceForAsset(id);
  for (const l of logs) await db.maintenance.delete(l.id);
  asset.deleted = true;
  asset.updatedAt = now();
  await db.assets.put(asset);
  emitChange();
}

export async function countAssets(): Promise<number> {
  return (await listAssets()).length;
}

/* ---------- maintenance log ---------- */

/** Newest first. */
export async function listMaintenanceForAsset(assetId: string): Promise<MaintenanceLog[]> {
  const all = await db.maintenance.where('assetId').equals(assetId).toArray();
  return all.filter((l) => !l.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** All non-deleted maintenance logs across every asset, newest first — used
 * by the home screen's recent-activity feed. */
export async function listMaintenance(): Promise<MaintenanceLog[]> {
  const all = await db.maintenance.toArray();
  return all.filter((l) => !l.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function listMaintenanceRaw(): Promise<MaintenanceLog[]> {
  return db.maintenance.toArray();
}

export async function putMaintenanceRaw(log: MaintenanceLog): Promise<void> {
  await db.maintenance.put(log);
  emitChange();
}

/** Saves the log and keeps the parent asset's `lastMaintenanceDate` in sync
 * with the newest non-deleted log for that asset. */
export async function saveMaintenance(log: MaintenanceLog): Promise<MaintenanceLog> {
  log.updatedAt = now();
  await db.maintenance.put(log);
  await syncLastMaintenanceDate(log.assetId);
  emitChange();
  return log;
}

export async function deleteMaintenance(id: string): Promise<void> {
  const log = await db.maintenance.get(id);
  if (!log) return;
  await db.maintenance.delete(id);
  await syncLastMaintenanceDate(log.assetId);
  emitChange();
}

async function syncLastMaintenanceDate(assetId: string): Promise<void> {
  const asset = await db.assets.get(assetId);
  if (!asset) return;
  const logs = await listMaintenanceForAsset(assetId);
  const newest = logs[0]?.date ?? null;
  if (asset.lastMaintenanceDate !== newest) {
    asset.lastMaintenanceDate = newest;
    asset.updatedAt = now();
    await db.assets.put(asset);
  }
}

/* ---------- media ---------- */

export async function saveMedia(media: MediaRecord): Promise<MediaRecord> {
  await db.media.put(media);
  return media;
}
export function getMedia(id: string): Promise<MediaRecord | undefined> {
  return db.media.get(id);
}
export function mediaForAsset(assetId: string): Promise<MediaRecord[]> {
  return db.media.where('assetId').equals(assetId).toArray();
}
export async function deleteMedia(id: string): Promise<void> {
  await db.media.delete(id);
}

/* ---------- settings ---------- */

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting<T = unknown>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

/* ---------- diagrams ---------- */

export async function saveDiagram(diagram: Diagram): Promise<Diagram> {
  diagram.updatedAt = now();
  await db.diagrams.put(diagram);
  emitChange();
  return diagram;
}

export function getDiagram(id: string): Promise<Diagram | undefined> {
  return db.diagrams.get(id);
}

/** All non-deleted diagrams. */
export async function listDiagrams(): Promise<Diagram[]> {
  const all = await db.diagrams.toArray();
  return all.filter((d) => !d.deleted);
}

/** Soft-deletes the diagram, hard-deletes its markers and page images
 * (nothing local-only needs a tombstone for those — there is no sync). */
export async function deleteDiagram(id: string): Promise<void> {
  const diagram = await db.diagrams.get(id);
  if (!diagram) return;
  const markers = await listMarkersForDiagram(id);
  for (const m of markers) await db.diagramMarkers.delete(m.id);
  for (const page of diagram.pages) await db.diagramMedia.delete(page.localId);
  diagram.deleted = true;
  diagram.updatedAt = now();
  await db.diagrams.put(diagram);
  emitChange();
}

/* ---------- diagram markers ---------- */

export async function saveDiagramMarker(marker: DiagramMarker): Promise<DiagramMarker> {
  marker.updatedAt = now();
  await db.diagramMarkers.put(marker);
  emitChange();
  return marker;
}

export async function listMarkersForDiagram(diagramId: string): Promise<DiagramMarker[]> {
  const all = await db.diagramMarkers.where('diagramId').equals(diagramId).toArray();
  return all.filter((m) => !m.deleted);
}

/** Every diagram+page a given asset is linked from — used by the asset
 * detail screen to show "linked diagrams". */
export async function listMarkersForAsset(assetId: string): Promise<DiagramMarker[]> {
  const all = await db.diagramMarkers.where('assetId').equals(assetId).toArray();
  return all.filter((m) => !m.deleted);
}

export async function deleteDiagramMarker(id: string): Promise<void> {
  await db.diagramMarkers.delete(id);
  emitChange();
}

/* ---------- diagram media ---------- */

export async function saveDiagramMedia(media: DiagramMediaRecord): Promise<DiagramMediaRecord> {
  await db.diagramMedia.put(media);
  return media;
}
export function getDiagramMedia(id: string): Promise<DiagramMediaRecord | undefined> {
  return db.diagramMedia.get(id);
}
export async function deleteDiagramMedia(id: string): Promise<void> {
  await db.diagramMedia.delete(id);
}

/* ---------- network layout (single master board-to-board map) ---------- */

export async function saveLayoutNode(node: LayoutNode): Promise<LayoutNode> {
  node.updatedAt = now();
  await db.layoutNodes.put(node);
  emitChange();
  return node;
}

export async function listLayoutNodes(): Promise<LayoutNode[]> {
  const all = await db.layoutNodes.toArray();
  return all.filter((n) => !n.deleted);
}

/** Hard-deletes the node and every edge touching it (no tombstone needed —
 * edges have no independent meaning once an endpoint is gone). */
export async function deleteLayoutNode(id: string): Promise<void> {
  const edges = await listLayoutEdges();
  for (const e of edges) {
    if (e.fromNodeId === id || e.toNodeId === id) await db.layoutEdges.delete(e.id);
  }
  await db.layoutNodes.delete(id);
  emitChange();
}

export async function saveLayoutEdge(edge: LayoutEdge): Promise<LayoutEdge> {
  edge.updatedAt = now();
  await db.layoutEdges.put(edge);
  emitChange();
  return edge;
}

export async function listLayoutEdges(): Promise<LayoutEdge[]> {
  const all = await db.layoutEdges.toArray();
  return all.filter((e) => !e.deleted);
}

export async function deleteLayoutEdge(id: string): Promise<void> {
  await db.layoutEdges.delete(id);
  emitChange();
}

/** Seeds the master layout with the board-to-board topology from the "33kV
 * ONE LINE DIAGRAM ARRAY" drawing (project 3723300062-0) as a starting
 * point — the user drags/reconnects freely from there. No-op (returns
 * false) if any layout node already exists, so it only ever runs once. */
export async function seedInitialLayoutIfEmpty(): Promise<boolean> {
  if ((await listLayoutNodes()).length > 0) return false;

  const nodeDefs: Array<{ id: string; label: string; subLabel: string; x: number; y: number }> = [
    { id: 'eb60', label: 'EB', subLabel: 'Building 60 · קיים', x: 40, y: 60 },
    { id: 'rm6', label: 'RM6', subLabel: 'NE-II · 25-0089', x: 260, y: 60 },
    { id: 'eb1', label: 'EB1', subLabel: 'Building 83 · F400-36kV', x: 480, y: 60 },
    { id: 'eb7', label: 'EB7', subLabel: 'Building 140 · לאישור', x: 720, y: 60 },
    { id: 'eb2', label: 'EB2', subLabel: 'Building 102 · קיים', x: 40, y: 320 },
    { id: 'eb3', label: 'EB3', subLabel: 'Building 50 · לביצוע', x: 260, y: 320 },
    { id: 'eb4', label: 'EB4', subLabel: 'Building 51 · לביצוע', x: 480, y: 320 },
    { id: 'eb5', label: 'EB5', subLabel: 'Building 82 · לביצוע', x: 700, y: 320 },
    { id: 'eb6', label: 'EB6', subLabel: 'Building 80.2 · חדש', x: 920, y: 320 },
  ];
  for (const n of nodeDefs) {
    await saveLayoutNode({ id: n.id, label: n.label, subLabel: n.subLabel, x: n.x, y: n.y, width: 150, height: 76, deleted: false, updatedAt: '' });
  }

  const edgeDefs: Array<[string, string]> = [
    ['eb60', 'rm6'], ['rm6', 'eb1'], ['eb1', 'eb7'],
    ['eb2', 'eb3'], ['eb3', 'eb4'], ['eb4', 'eb5'], ['eb5', 'eb6'],
  ];
  for (const [fromNodeId, toNodeId] of edgeDefs) {
    await saveLayoutEdge({ id: crypto.randomUUID(), fromNodeId, toNodeId, deleted: false, updatedAt: '' });
  }
  return true;
}

/* ---------- data reset ---------- */

export async function clearAllData(): Promise<void> {
  await db.assets.clear();
  await db.maintenance.clear();
  await db.media.clear();
  await db.diagrams.clear();
  await db.diagramMarkers.clear();
  await db.diagramMedia.clear();
  await db.layoutNodes.clear();
  await db.layoutEdges.clear();
  emitChange();
}
