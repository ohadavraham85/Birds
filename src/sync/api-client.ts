/* sync/api-client.ts — thin typed client for the sync server. */

import type { Observation, SpeciesRow } from '../types';

export interface PushOp {
  entity: 'observation' | 'species';
  op: 'upsert' | 'delete';
  payload: Observation | SpeciesRow;
}

export interface SyncRequest {
  deviceId: string;
  since: string | null;
  ops: PushOp[];
}

export interface SyncResponse {
  cursor: string;
  changes: {
    observations: Observation[];
    species: SpeciesRow[];
  };
}

export class ApiError extends Error {}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

export async function postSync(
  baseUrl: string,
  body: SyncRequest,
  signal?: AbortSignal,
): Promise<SyncResponse> {
  let resp: Response;
  try {
    resp = await fetch(joinUrl(baseUrl, '/api/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ApiError('לא ניתן להגיע לשרת הסנכרון: ' + (err as Error).message);
  }
  if (!resp.ok) {
    throw new ApiError(`השרת החזיר שגיאה (${resp.status})`);
  }
  return (await resp.json()) as SyncResponse;
}

export async function ping(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(joinUrl(baseUrl, '/api/health'), { method: 'GET' });
    return resp.ok;
  } catch {
    return false;
  }
}
