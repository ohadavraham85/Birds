/* db/database.ts — Typed IndexedDB schema via Dexie. */

import Dexie, { type EntityTable } from 'dexie';
import type { Asset, MaintenanceLog, MediaRecord, SettingRow, Diagram, DiagramMarker, DiagramMediaRecord } from '../types';

export class AssetsDatabase extends Dexie {
  assets!: EntityTable<Asset, 'id'>;
  maintenance!: EntityTable<MaintenanceLog, 'id'>;
  media!: EntityTable<MediaRecord, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  diagrams!: EntityTable<Diagram, 'id'>;
  diagramMarkers!: EntityTable<DiagramMarker, 'id'>;
  diagramMedia!: EntityTable<DiagramMediaRecord, 'id'>;

  constructor() {
    super('electric-assets-db');
    this.version(1).stores({
      assets: 'id, code, type, status, updatedAt, deleted',
      maintenance: 'id, assetId, date, updatedAt, deleted',
      media: 'id, assetId',
      settings: 'key',
    });
    this.version(2).stores({
      diagrams: 'id, updatedAt, deleted',
      diagramMarkers: 'id, diagramId, pageId, assetId, updatedAt, deleted',
      diagramMedia: 'id',
    });
  }
}

export const db = new AssetsDatabase();
