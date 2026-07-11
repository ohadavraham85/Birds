/* db/database.ts — Typed IndexedDB schema via Dexie. */

import Dexie, { type EntityTable } from 'dexie';
import type {
  Observation,
  SpeciesRow,
  MediaRecord,
  SettingRow,
  OutboxEntry,
} from '../types';

export class BirdsDatabase extends Dexie {
  observations!: EntityTable<Observation, 'id'>;
  species!: EntityTable<SpeciesRow, 'name'>;
  media!: EntityTable<MediaRecord, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  outbox!: EntityTable<OutboxEntry, 'id'>;

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
  }
}

export const db = new BirdsDatabase();
