/* lib/israel.ts — is a point inside Israel? Used to tell observations made
 * abroad (the home screen's "לא מהארץ" count). The outline is deliberately
 * rough (~30 points) but follows the land borders closely enough to keep
 * Aqaba, Taba, Petra, southern Lebanon and the Syrian side of the Golan out.
 * It includes the Golan Heights, Judea & Samaria and Gaza, and is pushed out
 * to sea on the Mediterranean and at Eilat so a pelagic or harbor sighting
 * just off the coast still counts as Israel. */

/** [lng, lat] vertices, clockwise from the sea off Rosh HaNikra. */
const ISRAEL_OUTLINE: readonly [number, number][] = [
  [34.85, 33.09], [35.105, 33.093], [35.2, 33.09], [35.4, 33.06], [35.5, 33.1],
  [35.53, 33.25], [35.57, 33.29], [35.62, 33.26], [35.75, 33.33], [35.82, 33.28],
  [35.87, 33.15], [35.9, 33.0], [35.85, 32.85], [35.78, 32.73], [35.65, 32.68],
  [35.57, 32.64], [35.55, 32.4], [35.52, 32.1], [35.55, 31.85], [35.53, 31.5],
  [35.47, 31.1], [35.4, 30.9], [35.3, 30.6], [35.17, 30.3], [35.1, 30.0],
  [35.02, 29.7], [35.0, 29.55], [34.95, 29.45], [34.9, 29.49], [34.86, 29.6],
  [34.73, 30.0], [34.53, 30.5], [34.4, 30.85], [34.27, 31.22], [34.22, 31.32],
  [34.1, 31.38], [34.3, 31.65], [34.5, 31.9], [34.6, 32.15], [34.7, 32.5],
  [34.8, 32.85], [34.85, 33.09],
];

/** Ray-casting point-in-polygon test. */
export function isInIsrael(lat: number, lng: number): boolean {
  let inside = false;
  for (let i = 0, j = ISRAEL_OUTLINE.length - 1; i < ISRAEL_OUTLINE.length; j = i++) {
    const [xi, yi] = ISRAEL_OUTLINE[i]!;
    const [xj, yj] = ISRAEL_OUTLINE[j]!;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
