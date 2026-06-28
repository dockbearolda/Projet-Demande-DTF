import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Built-in SQLite (Node >= 22.5, needs --experimental-sqlite). Zero native deps.
const DB_PATH = process.env.NUGGETS_DB || resolve(process.cwd(), 'data', 'nuggets.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS candidates (
  id                TEXT PRIMARY KEY,
  name              TEXT,
  author            TEXT,
  description       TEXT,
  category          TEXT,
  installs          INTEGER,
  rating2024        REAL,
  ratingNow         REAL,
  ratings           INTEGER,
  monthsSinceUpdate REAL,
  manifestVersion   INTEGER,
  lastUpdated       TEXT,
  keyword           TEXT,
  keywordDemand     REAL DEFAULT 0,
  recentReviews90d  INTEGER DEFAULT 0,
  fixableComplaints INTEGER DEFAULT 0,
  reviewsJson       TEXT,
  score             INTEGER,
  reason            TEXT,
  demandAt          TEXT,
  enrichedAt        TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_demand ON candidates(keywordDemand DESC);
`);

export const DB_FILE = DB_PATH;
