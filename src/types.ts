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
