/* lib/species-details-cache.ts — in-memory mirror of the species master
 * list's reference-data overrides (English/scientific/family name) and the
 * manual "birding target" flag, kept fresh via onDataChanged. Card/tile
 * rendering needs these synchronously while drawing many species at once,
 * same reasoning as lib/tags-cache.ts. */

import { listSpeciesRows, onDataChanged } from '../db/repository';
import { SPECIES_DETAILS } from '../data/species-data';
import type { SpeciesDetail, SpeciesRow } from '../types';

let cache = new Map<string, SpeciesRow>();

/** The bundled reference data for a species, with any user-set overrides
 * (English/scientific/family name) applied on top. */
export function getSpeciesDetail(name: string): SpeciesDetail {
  const base = SPECIES_DETAILS[name] || { he: name, en: '', sci: '', family: '' };
  const row = cache.get(name);
  if (!row) return base;
  return {
    he: base.he,
    en: row.enOverride ?? base.en,
    sci: row.sciOverride ?? base.sci,
    family: row.familyOverride ?? base.family,
  };
}

export function isSpeciesTarget(name: string): boolean {
  return !!cache.get(name)?.isTarget;
}

/** Every family name currently in use, bundled or custom-entered via an
 * override — for the family edit dropdown in Settings, sorted alphabetically. */
export function listKnownFamilies(): string[] {
  const set = new Set<string>();
  for (const d of Object.values(SPECIES_DETAILS)) if (d.family) set.add(d.family);
  for (const row of cache.values()) if (row.familyOverride) set.add(row.familyOverride);
  return [...set].sort((a, b) => a.localeCompare(b, 'he'));
}

export async function refreshSpeciesDetailsCache(): Promise<void> {
  cache = new Map((await listSpeciesRows()).map((r) => [r.name, r]));
}

onDataChanged(() => { void refreshSpeciesDetailsCache(); });
