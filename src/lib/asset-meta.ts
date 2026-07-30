/* lib/asset-meta.ts — Hebrew labels, icons and colors for the asset
 * type/status/voltage enums, shared by every view that renders an asset. */

import type { AssetType, AssetStatus, VoltageLevel } from '../types';
import type { IconName } from './icons';

export const ASSET_TYPE_META: Record<AssetType, { label: string; icon: IconName }> = {
  pole: { label: 'עמוד חשמל', icon: 'pole' },
  line: { label: 'קו/כבל', icon: 'link' },
  transformer: { label: 'שנאי', icon: 'transformer' },
  panel: { label: 'לוח חשמל', icon: 'panel' },
  meter: { label: 'מונה', icon: 'meter' },
  switchgear: { label: 'מפסק/ממסר', icon: 'switchgear' },
  generator: { label: 'גנרטור', icon: 'generator' },
};

export const ASSET_STATUS_META: Record<AssetStatus, { label: string; color: string }> = {
  active: { label: 'פעיל', color: '#2e7d32' },
  maintenance: { label: 'בתחזוקה', color: '#e07a2e' },
  faulty: { label: 'תקול', color: '#c1443c' },
  decommissioned: { label: 'מושבת', color: '#8a8f98' },
};

export const VOLTAGE_META: Record<VoltageLevel, { label: string }> = {
  low: { label: 'מתח נמוך' },
  medium: { label: 'מתח בינוני' },
  high: { label: 'מתח גבוה' },
};
