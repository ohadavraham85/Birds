/* lib/family-color.ts — deterministic accent color per bird family name, so
 * observation cards/tiles get a distinct color at a glance based on the
 * (primary) species' family, without hand-picking a color for every one of
 * the ~30 families in species-data.ts. Same family always maps to the same
 * hue, and any unrecognized family still gets a stable color for free. */

const SATURATION = 62;
const LIGHTNESS = 46;

function hashHue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function familyColor(family: string): string {
  if (!family) return '';
  return `hsl(${hashHue(family)} ${SATURATION}% ${LIGHTNESS}%)`;
}
