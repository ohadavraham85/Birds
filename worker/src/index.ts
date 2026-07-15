/* worker/src/index.ts — Cloudflare Worker backend for יומן צפרות.
 *
 * Implements the sync contract the PWA already speaks, backed by D1 (structured
 * records) and R2 (photos):
 *   GET    /api/health          -> { ok: true }
 *   POST   /api/sync            -> two-way sync (last-write-wins + tombstones)
 *   PUT    /api/media/:id       -> upload a photo blob to R2
 *   GET    /api/media/:id       -> download a photo blob from R2
 *
 * Auth: every request except /api/health must send `Authorization: Bearer <SYNC_TOKEN>`
 * where SYNC_TOKEN is a Worker secret shared with the app (and the 2-3 friends).
 */

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  SYNC_TOKEN: string;
}

interface PushOp {
  entity: 'observation' | 'species';
  op: 'upsert' | 'delete';
  payload: Record<string, unknown> & { id?: string; name?: string; updatedAt?: string };
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function authorized(req: Request, env: Env): boolean {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return !!env.SYNC_TOKEN && token === env.SYNC_TOKEN;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method === 'GET' && path === '/api/health') return json({ ok: true });

    if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      if (req.method === 'POST' && path === '/api/sync') return await handleSync(req, env);

      const media = path.match(/^\/api\/media\/([A-Za-z0-9._-]+)$/);
      if (media) {
        const id = media[1]!;
        if (req.method === 'PUT') return await putMedia(req, env, id);
        if (req.method === 'GET') return await getMedia(env, id);
      }
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
    return json({ error: 'not found' }, 404);
  },
};

async function handleSync(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { since?: string | null; ops?: PushOp[] };
  const since = Number(body.since) || 0;

  // current sequence counter
  const row = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'seq'`).first<{ v: number }>();
  let seq = row?.v ?? 0;

  for (const op of body.ops ?? []) {
    if (!op?.entity || !op?.payload) continue;
    const key = op.entity === 'observation' ? String(op.payload.id) : String(op.payload.name);
    if (!key || key === 'undefined') continue;
    const updatedAt = String(op.payload.updatedAt ?? '');

    const existing = await env.DB
      .prepare(`SELECT updatedAt FROM records WHERE entity = ? AND key = ?`)
      .bind(op.entity, key)
      .first<{ updatedAt: string }>();

    // last-write-wins
    if (!existing || (existing.updatedAt || '') <= updatedAt) {
      seq += 1;
      await env.DB
        .prepare(
          `INSERT INTO records (entity, key, payload, updatedAt, seq) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(entity, key) DO UPDATE SET payload = excluded.payload, updatedAt = excluded.updatedAt, seq = excluded.seq`,
        )
        .bind(op.entity, key, JSON.stringify(op.payload), updatedAt, seq)
        .run();
    }
  }

  await env.DB.prepare(`UPDATE meta SET v = ? WHERE k = 'seq'`).bind(seq).run();

  // pull everything changed after the client's cursor
  const changed = await env.DB
    .prepare(`SELECT entity, payload FROM records WHERE seq > ? ORDER BY seq ASC`)
    .bind(since)
    .all<{ entity: string; payload: string }>();

  const observations: unknown[] = [];
  const species: unknown[] = [];
  for (const r of changed.results ?? []) {
    (r.entity === 'observation' ? observations : species).push(JSON.parse(r.payload));
  }
  return json({ cursor: String(seq), changes: { observations, species } });
}

async function putMedia(req: Request, env: Env, id: string): Promise<Response> {
  if (!req.body) return json({ error: 'empty body' }, 400);
  await env.PHOTOS.put(id, req.body, {
    httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' },
  });
  return json({ ok: true, id });
}

async function getMedia(env: Env, id: string): Promise<Response> {
  const obj = await env.PHOTOS.get(id);
  if (!obj) return json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000',
      ...CORS,
    },
  });
}
