/* server/index.mjs — reference sync server for יומן צפרות.
 *
 * A dependency-free Node HTTP server implementing the sync contract the PWA
 * expects. State is persisted to server/data.json. Last-write-wins by the
 * `updatedAt` field; tombstones (deleted:true) propagate. Suitable as a local
 * reference / starting point — swap the JSON store for a real database in prod.
 *
 * Contract:
 *   GET  /api/health -> { ok: true }
 *   POST /api/sync   { deviceId, since, ops:[{entity,op,payload}] }
 *                 -> { cursor, changes:{ observations:[], species:[] } }
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data.json');
const PORT = process.env.PORT || 8790;

/** @type {{observations:Record<string,any>, species:Record<string,any>, seq:number}} */
let store = { observations: {}, species: {}, seq: 0 };
if (existsSync(DATA_FILE)) {
  try { store = JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch { /* start fresh */ }
}
function persist() { writeFileSync(DATA_FILE, JSON.stringify(store)); }

const nextSeq = () => ++store.seq;

/** Apply one incoming op with last-write-wins semantics. */
function applyOp(entity, payload) {
  const table = entity === 'observation' ? store.observations : store.species;
  const key = entity === 'observation' ? payload.id : payload.name;
  const existing = table[key];
  if (!existing || (existing.updatedAt || '') <= (payload.updatedAt || '')) {
    table[key] = { ...payload, serverSeq: nextSeq() };
  }
}

/** All rows changed after the client's cursor (serverSeq). */
function changesSince(since) {
  const cursorSeq = Number(since) || 0;
  const pick = (table) => Object.values(table)
    .filter((r) => (r.serverSeq || 0) > cursorSeq)
    .map(({ serverSeq, ...row }) => { void serverSeq; return row; });
  return { observations: pick(store.observations), species: pick(store.species) };
}

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  });
  res.end(data);
}

// in-memory photo store (the Cloudflare Worker uses R2 instead)
const media = new Map();
const TOKEN = process.env.SYNC_TOKEN || '';

function authorized(req) {
  if (!TOKEN) return true; // open in local dev unless a token is set
  return (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') === TOKEN;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method === 'GET' && req.url === '/api/health') return sendJson(res, 200, { ok: true });

  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });

  if (req.method === 'POST' && req.url === '/api/sync') {
    const raw = (await readBody(req)).toString('utf8');
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
    for (const op of body.ops || []) {
      if (op?.entity && op?.payload) applyOp(op.entity, op.payload);
    }
    const changes = changesSince(body.since);
    persist();
    return sendJson(res, 200, { cursor: String(store.seq), changes });
  }

  const m = /^\/api\/media\/([A-Za-z0-9._-]+)$/.exec(req.url || '');
  if (m) {
    const id = m[1];
    if (req.method === 'PUT') {
      media.set(id, { type: req.headers['content-type'] || 'application/octet-stream', data: await readBody(req) });
      return sendJson(res, 200, { ok: true, id });
    }
    if (req.method === 'GET') {
      const obj = media.get(id);
      if (!obj) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': obj.type, 'Access-Control-Allow-Origin': '*' });
      return res.end(obj.data);
    }
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`birds sync server on http://localhost:${PORT}`);
});
