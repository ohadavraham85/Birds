/* types.ts — Domain models shared across the app. */

export const ASSET_TYPES = ['pole', 'line', 'transformer', 'panel', 'meter', 'switchgear', 'generator'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ['active', 'maintenance', 'faulty', 'decommissioned'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const VOLTAGE_LEVELS = ['low', 'medium', 'high'] as const;
export type VoltageLevel = (typeof VOLTAGE_LEVELS)[number];

/** An image attached to an asset. `localId` links to a blob in the media store. */
export interface AssetImage {
  localId: string;
  name: string;
}

/** One electrical asset placed on the map (עמוד, שנאי, לוח, מונה, קו, מפסק, גנרטור). */
export interface Asset {
  id: string;
  /** Free-text asset number/identifier used in the field (e.g. תג נכס). */
  code: string;
  /** Short descriptive name (e.g. "עמוד תאורה — רח' הרצל 12"). */
  name: string;
  type: AssetType;
  status: AssetStatus;
  voltage: VoltageLevel;
  lat: number | null;
  lng: number | null;
  address?: string;
  /** ISO date (YYYY-MM-DD) — when the asset was installed. */
  installDate?: string | null;
  /** ISO date (YYYY-MM-DD) — most recent maintenance, kept in sync with the
   * newest MaintenanceLog row for quick display without a join. */
  lastMaintenanceDate?: string | null;
  notes: string;
  images: AssetImage[];
  /** Soft-delete tombstone. */
  deleted: boolean;
  /** Last local modification, ISO. */
  updatedAt: string;
}

/** One maintenance/service record logged against an asset. */
export interface MaintenanceLog {
  id: string;
  assetId: string;
  /** ISO date (YYYY-MM-DD) the work was performed. */
  date: string;
  description: string;
  technician?: string;
  deleted: boolean;
  updatedAt: string;
}

/** Original-quality image blob, linked to an asset. */
export interface MediaRecord {
  id: string;
  assetId: string;
  name: string;
  mime: string;
  blob: Blob;
}

export interface SettingRow<T = unknown> {
  key: string;
  value: T;
}

/* ---------- diagrams ---------- */

export const DIAGRAM_PAGE_KINDS = ['one-line', 'front-view'] as const;
export type DiagramPageKind = (typeof DIAGRAM_PAGE_KINDS)[number];

/** One rasterized sheet (one-line diagram or front-view/cabinet layout)
 * belonging to a Diagram. `localId` links to a blob in the diagramMedia
 * store — same pattern as AssetImage/MediaRecord for asset photos. */
export interface DiagramPage {
  id: string;
  kind: DiagramPageKind;
  localId: string;
  /** Natural pixel size of the stored image — lets marker (x, y) be stored
   * as fractions (0..1) independent of display zoom. */
  width: number;
  height: number;
}

/** An uploaded switchboard/site drawing (e.g. a Schneider Electric one-line
 * + front-view sheet pair) shared across the app — any number of existing
 * assets can be linked to a cubicle/cell on it via DiagramMarker. */
export interface Diagram {
  id: string;
  name: string;
  pages: DiagramPage[];
  notes?: string;
  deleted: boolean;
  updatedAt: string;
}

/** Links an existing Asset to a point (cubicle/cell) on one page of a
 * Diagram. (x, y) are fractions of the page image's width/height. */
export interface DiagramMarker {
  id: string;
  diagramId: string;
  pageId: string;
  assetId: string;
  x: number;
  y: number;
  label?: string;
  deleted: boolean;
  updatedAt: string;
}

/** Original-quality diagram page image blob. */
export interface DiagramMediaRecord {
  id: string;
  mime: string;
  blob: Blob;
}

/* ---------- network layout (the single master "array" board-to-board map) ---------- */

/** One draggable board/station box on the master network layout. Optionally
 * linked to that board's own internal Diagram (the one-line/front-view
 * sheets with asset markers) — clicking the node drills into it. */
export interface LayoutNode {
  id: string;
  label: string;
  subLabel?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  diagramId?: string;
  deleted: boolean;
  updatedAt: string;
}

/** A dynamic connector between two LayoutNodes, drawn as a routed line with
 * an arrowhead that re-computes live as either endpoint moves. */
export interface LayoutEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  deleted: boolean;
  updatedAt: string;
}
