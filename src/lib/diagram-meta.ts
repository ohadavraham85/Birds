/* lib/diagram-meta.ts — Hebrew labels for the diagram page-kind enum. */

import type { DiagramPageKind } from '../types';

export const DIAGRAM_PAGE_KIND_META: Record<DiagramPageKind, { label: string; shortLabel: string }> = {
  'one-line': { label: 'תרשים חד קווי (One Line Diagram)', shortLabel: 'חד קווי' },
  'front-view': { label: 'מראה לוח (Front View)', shortLabel: 'מראה לוח' },
};
