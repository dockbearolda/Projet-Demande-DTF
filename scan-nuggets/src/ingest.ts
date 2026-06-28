import { existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './db';
import { DATASET_URL, INGEST_CATEGORIES, FILTER } from './config';
import { DATA_DIR, ensureDir, fetchWithRetry } from './util';

interface RawExt {
  id: string;
  name: string;
  author: string | null;
  description?: string;
  category?: string;
  rating?: number;
  ratings?: number;
  installs?: number;
}

const DATASET_FILE = resolve(DATA_DIR, 'extensions-2024.json');

async function ensureDataset(refresh: boolean): Promise<RawExt[]> {
  ensureDir(DATA_DIR);
  if (refresh || !existsSync(DATASET_FILE)) {
    console.log(`↓ downloading ${DATASET_URL} (~59 MB) …`);
    const res = await fetchWithRetry(DATASET_URL, { timeoutMs: 180_000 });
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(DATASET_FILE, buf);
    console.log(`  saved ${(buf.length / 1e6).toFixed(1)} MB`);
  } else {
    console.log(`• using cached dataset (${(statSync(DATASET_FILE).size / 1e6).toFixed(1)} MB)`);
  }
  return JSON.parse(readFileSync(DATASET_FILE, 'utf8')) as RawExt[];
}

export async function ingest(opts: { refresh?: boolean } = {}) {
  const all = await ensureDataset(!!opts.refresh);
  console.log(`• ${all.length.toLocaleString()} extensions in dataset`);

  const passes = all.filter(
    (x) =>
      x.category != null &&
      INGEST_CATEGORIES.has(x.category) &&
      typeof x.installs === 'number' &&
      x.installs >= FILTER.installsMin &&
      x.installs <= FILTER.installsMax &&
      typeof x.rating === 'number' &&
      x.rating >= FILTER.ratingMin &&
      x.rating <= FILTER.ratingMax,
  );

  const upsert = db.prepare(`
    INSERT INTO candidates
      (id, name, author, description, category, installs, rating2024, ratings)
    VALUES
      (@id, @name, @author, @description, @category, @installs, @rating2024, @ratings)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, author=excluded.author, description=excluded.description,
      category=excluded.category, installs=excluded.installs,
      rating2024=excluded.rating2024, ratings=excluded.ratings
  `);

  const tx = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  tx.run();
  for (const x of passes) {
    upsert.run({
      id: x.id,
      name: x.name ?? '',
      author: x.author ?? null,
      description: x.description ?? '',
      category: x.category ?? '',
      installs: x.installs ?? 0,
      rating2024: x.rating ?? 0,
      ratings: x.ratings ?? 0,
    });
  }
  commit.run();

  const byCat = db
    .prepare('SELECT category, COUNT(*) n FROM candidates GROUP BY category ORDER BY n DESC')
    .all() as { category: string; n: number }[];
  console.log(`✓ ingested ${passes.length.toLocaleString()} candidates`);
  for (const r of byCat) console.log(`    ${r.category.padEnd(26)} ${r.n}`);
}
