/* lib/export-excel.ts — exports observations to a CSV file (opened fine by
 * Excel), one row per species entry so multi-species observations expand
 * cleanly. Shared by the table view and the journal's long-press
 * multi-select export. */

import { toCsv } from './csv';
import { toast } from './ui';
import { entriesOf } from './observation';
import type { Observation } from '../types';

export function exportObservationsExcel(observations: Observation[]): void {
  if (!observations.length) { toast('אין תצפיות לייצוא', true); return; }
  const rows: unknown[][] = [
    ['תאריך ושעה', 'מיקום', 'קו רוחב', 'קו אורך', 'פרויקט', 'מין הציפור', 'מספר פרטים', 'הערות'],
    ...observations.flatMap((o) => {
      const entries = entriesOf(o).length ? entriesOf(o) : [{ species: '', quantity: 1 }];
      return entries.map((e) => [o.dateTime, o.locationName || '', o.lat ?? '', o.lng ?? '', o.project || '', e.species, e.quantity ?? 1, o.notes || '']);
    }),
  ];
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `תצפיות-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`יוצאו ${observations.length} תצפיות ל-Excel/CSV ✓`);
}
