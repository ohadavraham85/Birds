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
    this.version(1).stores({
      observations: 'id, dateTime, updatedAt, synced, deleted',
      species: 'name, updatedAt',
      media: 'id, obsId',
      settings: 'key',
      outbox: '++id, entity, entityId, createdAt',
    });
  }
}

export const db = new BirdsDatabase();
