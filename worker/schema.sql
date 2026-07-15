-- D1 schema for the birds sync backend.
CREATE TABLE IF NOT EXISTS records (
  entity    TEXT NOT NULL,          -- 'observation' | 'species'
  key       TEXT NOT NULL,          -- observation id / species name
  payload   TEXT NOT NULL,          -- full JSON row
  updatedAt TEXT NOT NULL,          -- ISO, for last-write-wins
  seq       INTEGER NOT NULL,       -- server change sequence (sync cursor)
  PRIMARY KEY (entity, key)
);
CREATE INDEX IF NOT EXISTS idx_records_seq ON records(seq);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', 0);
