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

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function postSync(
  baseUrl: string,
  token: string,
  body: SyncRequest,
  signal?: AbortSignal,
): Promise<SyncResponse> {
  let resp: Response;
  try {
    resp = await fetch(joinUrl(baseUrl, '/api/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ApiError('לא ניתן להגיע לשרת הסנכרון: ' + (err as Error).message);
  }
  if (resp.status === 401) throw new ApiError('קוד הסנכרון שגוי או חסר');
  if (!resp.ok) throw new ApiError(`השרת החזיר שגיאה (${resp.status})`);
  return (await resp.json()) as SyncResponse;
}

/** Upload a photo blob to the server (R2). Key is the media id. */
export async function uploadMedia(baseUrl: string, token: string, id: string, blob: Blob): Promise<void> {
  const resp = await fetch(joinUrl(baseUrl, `/api/media/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream', ...authHeaders(token) },
    body: blob,
  });
  if (!resp.ok) throw new ApiError(`העלאת תמונה נכשלה (${resp.status})`);
}

/** Download a photo blob from the server (R2). Returns null if missing. */
export async function downloadMedia(baseUrl: string, token: string, id: string): Promise<Blob | null> {
  const resp = await fetch(joinUrl(baseUrl, `/api/media/${encodeURIComponent(id)}`), {
    headers: authHeaders(token),
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new ApiError(`הורדת תמונה נכשלה (${resp.status})`);
  return resp.blob();
}

export async function ping(baseUrl: string, token: string): Promise<boolean> {
  try {
    const resp = await fetch(joinUrl(baseUrl, '/api/health'), { headers: authHeaders(token) });
    return resp.ok;
  } catch {
    return false;
  }
}
