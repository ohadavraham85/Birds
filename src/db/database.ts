/* db/database.ts — Typed IndexedDB schema via Dexie. */

import Dexie, { type EntityTable } from 'dexie';
import type {
  Observation,
  SpeciesRow,
  LocationRow,
  ProjectRow,
  MediaRecord,
  SettingRow,
  OutboxEntry,
  ObservationTrack,
} from '../types';

export class BirdsDatabase extends Dexie {
  observations!: EntityTable<Observation, 'id'>;
  species!: EntityTable<SpeciesRow, 'name'>;
  locations!: EntityTable<LocationRow, 'name'>;
  projects!: EntityTable<ProjectRow, 'name'>;
  media!: EntityTable<MediaRecord, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  outbox!: EntityTable<OutboxEntry, 'id'>;
  tracks!: EntityTable<ObservationTrack, 'id'>;

  constructor() {
    super('birds-db');
    const stores = {
      observations: 'id, dateTime, updatedAt, synced, deleted',
      species: 'name, updatedAt',
      media: 'id, obsId',
      settings: 'key',
      outbox: '++id, entity, entityId, createdAt',
    };
    this.version(1).stores(stores);
    // v2: multiple species per observation — migrate {species, quantity} → entries[]
    this.version(2).stores(stores).upgrade(async (tx) => {
      await tx.table('observations').toCollection().modify((o: Record<string, unknown>) => {
        if (!Array.isArray(o.entries)) {
          o.entries = [{ species: (o.species as string) ?? '', quantity: (o.quantity as number) ?? 1 }];
          delete o.species;
          delete o.quantity;
        }
      });
    });
    // v3: per-species images — move observation-level images into the first entry
    this.version(3).stores(stores).upgrade(async (tx) => {
      await tx.table('observations').toCollection().modify((o: Record<string, unknown>) => {
        const imgs = o.images as unknown[] | undefined;
        const entries = o.entries as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(imgs) && imgs.length && Array.isArray(entries) && entries.length) {
          const first = entries[0]!;
          first.images = [...((first.images as unknown[]) ?? []), ...imgs];
          o.images = [];
        }
      });
    });
    // v4: locations master list (name + canonical coordinates), managed in Settings
    this.version(4).stores({ ...stores, locations: 'name, updatedAt' });
    // v5: projects master list (name only), managed in Settings
    this.version(5).stores({ ...stores, locations: 'name, updatedAt', projects: 'name, updatedAt' });
    // v6: recorded GPS tracks (one per observation, captured while its form was open)
    this.version(6).stores({
      ...stores, locations: 'name, updatedAt', projects: 'name, updatedAt', tracks: 'id, updatedAt',
    });
  }
}

export const db = new BirdsDatabase();
