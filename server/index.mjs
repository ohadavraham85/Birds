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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(data);
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method === 'GET' && req.url === '/api/health') return sendJson(res, 200, { ok: true });

  if (req.method === 'POST' && req.url === '/api/sync') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
      for (const op of body.ops || []) {
        if (op?.entity && op?.payload) applyOp(op.entity, op.payload);
      }
      const changes = changesSince(body.since);
      persist();
      sendJson(res, 200, { cursor: String(store.seq), changes });
    });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`birds sync server on http://localhost:${PORT}`);
});
