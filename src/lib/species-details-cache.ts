/* lib/species-details-cache.ts — in-memory mirror of the species master
 * list's reference-data overrides (English/scientific/family name) and the
 * manual status-badge override, kept fresh via onDataChanged. Card/tile
 * rendering needs these synchronously while drawing many species at once,
 * same reasoning as lib/tags-cache.ts. */

import { listSpeciesRows, onDataChanged } from '../db/repository';
import { SPECIES_DETAILS } from '../data/species-data';
import type { SpeciesDetail, SpeciesRow, SpeciesTag } from '../types';

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

export function getManualSpeciesTag(name: string): SpeciesTag | undefined {
  return cache.get(name)?.manualTag;
}

/** A species' birding status, as its badge in the species tab shows it: the
 * manual choice if one was set, otherwise from how many observations it has
 * — 0 → not seen, exactly 1 → lifer, 2+ → seen. */
export function speciesStatusTag(observationCount: number, manual?: SpeciesTag): SpeciesTag {
  if (manual) return manual;
  if (observationCount === 0) return 'unseen';
  if (observationCount === 1) return 'lifer';
  return 'seen';
}

/** The photo hand-picked (species.ts's star button) to represent this
 * species on its closed card/tile — undefined means auto-pick instead. */
export function getCoverPhotoId(name: string): string | undefined {
  return cache.get(name)?.coverPhotoId;
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
