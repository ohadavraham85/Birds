/* db/database.ts — Typed IndexedDB schema via Dexie. */

import Dexie, { type EntityTable } from 'dexie';
import type {
  Observation,
  SpeciesRow,
  LocationRow,
  ProjectRow,
  TagRow,
  MediaRecord,
  SettingRow,
  OutboxEntry,
  ObservationTrack,
  StoredFile,
} from '../types';

/** Cycled through when migrating old projects (which had no color) into tags. */
const MIGRATED_TAG_COLORS = ['#2e7d32', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00', '#00838f'];

export class BirdsDatabase extends Dexie {
  observations!: EntityTable<Observation, 'id'>;
  species!: EntityTable<SpeciesRow, 'name'>;
  locations!: EntityTable<LocationRow, 'name'>;
  projects!: EntityTable<ProjectRow, 'name'>;
  tags!: EntityTable<TagRow, 'name'>;
  media!: EntityTable<MediaRecord, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  outbox!: EntityTable<OutboxEntry, 'id'>;
  tracks!: EntityTable<ObservationTrack, 'id'>;
  files!: EntityTable<StoredFile, 'id'>;

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
    // v7: stored files (Settings ← קבצים) — auto-archived PDF reports + user-uploaded external files
    this.version(7).stores({
      ...stores, locations: 'name, updatedAt', projects: 'name, updatedAt', tracks: 'id, updatedAt',
      files: 'id, kind, createdAt',
    });
    // v8: tags (multi-valued, colored+iconed) replace the single-valued project
    // field — every existing project becomes a tag of the same name, and every
    // observation's single project string becomes a one-element tags array.
    this.version(8).stores({
      ...stores, locations: 'name, updatedAt', projects: 'name, updatedAt', tracks: 'id, updatedAt',
      files: 'id, kind, createdAt', tags: 'name, updatedAt',
    }).upgrade(async (tx) => {
      const projectRows = await tx.table('projects').toArray() as ProjectRow[];
      const now = new Date().toISOString();
      await tx.table('tags').bulkPut(projectRows.map((p, i): TagRow => ({
        name: p.name,
        color: MIGRATED_TAG_COLORS[i % MIGRATED_TAG_COLORS.length]!,
        icon: 'tagGeneric',
        updatedAt: p.updatedAt || now,
        deleted: p.deleted,
      })));
      await tx.table('observations').toCollection().modify((o: Record<string, unknown>) => {
        if (!Array.isArray(o.tags)) {
          const project = (o.project as string) || '';
          o.tags = project ? [project] : [];
        }
      });
    });
    // v9: permanent sequential display number per observation — backfilled once
    // here in earliest-dateTime-first order (ties broken by id) so existing
    // observations get a stable, sensible numbering; every observation saved
    // from now on is assigned the next number by repository.ts.
    this.version(9).stores({
      ...stores, locations: 'name, updatedAt', projects: 'name, updatedAt', tracks: 'id, updatedAt',
      files: 'id, kind, createdAt', tags: 'name, updatedAt',
      observations: 'id, dateTime, updatedAt, synced, deleted, seqNo',
    }).upgrade(async (tx) => {
      const rows = (await tx.table('observations').toArray() as Array<Record<string, unknown>>)
        .sort((a, b) => {
          const da = a.dateTime as string, db_ = b.dateTime as string;
          return da < db_ ? -1 : da > db_ ? 1 : (a.id as string).localeCompare(b.id as string);
        });
      let n = 1;
      for (const row of rows) await tx.table('observations').update(row.id as string, { seqNo: n++ });
    });
  }
}

export const db = new BirdsDatabase();
