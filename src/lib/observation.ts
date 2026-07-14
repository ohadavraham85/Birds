/* lib/observation.ts — helpers over an observation's species entries.
 *
 * These tolerate legacy rows that still carry a single {species, quantity}
 * (e.g. if the Dexie migration hasn't run yet, or an old backup is restored),
 * so display and filtering stay correct in every case. */

import type { Observation, SpeciesEntry, ObservationImage } from '../types';

interface LegacyShape { species?: string; quantity?: number }

/** Normalized species entries for an observation, with a legacy fallback. */
export function entriesOf(o: Observation): SpeciesEntry[] {
  if (Array.isArray(o.entries) && o.entries.length) return o.entries;
  const legacy = o as unknown as LegacyShape;
  if (legacy.species) return [{ species: legacy.species, quantity: legacy.quantity ?? 1 }];
  return [];
}

export function speciesNames(o: Observation): string[] {
  return entriesOf(o).map((e) => e.species).filter(Boolean);
}

export function primarySpecies(o: Observation): string {
  return entriesOf(o)[0]?.species ?? '';
}

export function totalQuantity(o: Observation): number {
  return entriesOf(o).reduce((sum, e) => sum + (e.quantity || 0), 0);
}

export function hasSpecies(o: Observation, name: string): boolean {
  return entriesOf(o).some((e) => e.species === name);
}

export function entryImages(entry: SpeciesEntry): ObservationImage[] {
  return Array.isArray(entry.images) ? entry.images : [];
}

/** All images across an observation's entries, plus any legacy top-level ones. */
export function allImages(o: Observation): ObservationImage[] {
  const fromEntries = entriesOf(o).flatMap(entryImages);
  const legacy = Array.isArray(o.images) ? o.images : [];
  return [...fromEntries, ...legacy];
}

/** Human label: "חיוויאי הנחשים × 2 · עיט ניצי". */
export function speciesLabel(o: Observation): string {
  return entriesOf(o)
    .map((e) => (e.quantity > 1 ? `${e.species} × ${e.quantity}` : e.species))
    .join(' · ');
}
