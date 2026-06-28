import { db } from './db';
import { SEED_KEYWORDS } from './config';
import { cachePath, clamp, fetchWithRetry, hash, nowIso, readJsonCache, sleep, writeJsonCache } from './util';

const RL_MS = Number(process.env.DEMAND_RL_MS ?? 300);

// Noise words stripped when deriving a search keyword from an extension name.
const NOISE = new Set([
  'for', 'chrome', 'extension', 'browser', 'free', 'pro', 'plus', 'app', 'the', 'and', 'online',
  'tool', 'tools', 'best', 'easy', 'my', 'your', 'official', 'new', 'google', 'web', 'addon',
  'add-on', 'plugin', 'manager', 'lite', 'beta',
]);

/** Derive a clean, head-3-token search query from a noisy extension name. */
export function normalizeKeyword(name: string): string {
  const cleaned = name
    .toLowerCase()
    .split(/[-—–|:•·,(/]/)[0] // drop tag-lines after a separator
    .replace(/[^\p{L}\p{N}+ ]/gu, ' ') // keep letters/digits across scripts (не just a-z)
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter((t) => t.length > 1 && !NOISE.has(t));
  const kw = (tokens.length ? tokens : cleaned.split(' ').filter(Boolean)).slice(0, 3).join(' ').trim();
  return kw.length > 1 ? kw : cleaned; // never return a 1-char junk keyword
}

/** Query Google's public autocomplete (Firefox client → plain JSON array). */
export async function autocomplete(query: string): Promise<string[]> {
  const file = cachePath('autocomplete', `${hash(query)}.json`);
  const cached = readJsonCache<string[]>(file);
  if (cached) return cached;

  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`;
  const res = await fetchWithRetry(url, { timeoutMs: 12_000 });
  const json = (await res.json()) as [string, string[], ...unknown[]];
  const suggestions = Array.isArray(json?.[1]) ? json[1] : [];
  writeJsonCache(file, suggestions);
  await sleep(RL_MS); // polite spacing only when we actually hit the network
  return suggestions;
}

/**
 * keywordDemand ∈ [0,1]:
 *  - breadth: how many distinct suggestions Google offers (it only autocompletes
 *    things people actually search → more = more demand).
 *  - relevance: share of suggestions that contain the head token (topic depth /
 *    commercial intent around the term).
 */
export function demandScore(query: string, suggestions: string[]): number {
  const q = query.toLowerCase().trim();
  const sugg = suggestions.map((s) => s.toLowerCase()).filter((s) => s && s !== q);
  const breadth = Math.min(sugg.length, 10) / 10;
  const head = q.split(' ')[0] ?? q;
  const rel = sugg.length ? sugg.filter((s) => s.includes(head)).length / sugg.length : 0;
  return clamp(0.6 * breadth + 0.4 * rel, 0, 1);
}

export async function runDemand(opts: { limit?: number; all?: boolean } = {}) {
  const where = opts.all ? '' : 'WHERE demandAt IS NULL';
  const limit = opts.limit ? `LIMIT ${opts.limit}` : '';
  const rows = db
    .prepare(`SELECT id, name FROM candidates ${where} ORDER BY installs DESC ${limit}`)
    .all() as { id: string; name: string }[];

  if (!rows.length) {
    console.log('• nothing to score for demand (use --all to recompute)');
    return;
  }
  console.log(`• computing keyword demand for ${rows.length} candidates …`);

  const update = db.prepare(
    'UPDATE candidates SET keyword=?, keywordDemand=?, demandAt=? WHERE id=?',
  );
  let done = 0;
  for (const r of rows) {
    const keyword = normalizeKeyword(r.name) || r.name.toLowerCase();
    let demand = 0;
    try {
      const suggestions = await autocomplete(keyword);
      demand = demandScore(keyword, suggestions);
    } catch (e) {
      console.warn(`  ! autocomplete failed for "${keyword}": ${(e as Error).message}`);
    }
    update.run(keyword, demand, nowIso(), r.id);
    if (++done % 50 === 0) console.log(`    ${done}/${rows.length}`);
  }
  console.log(`✓ demand scored for ${done} candidates`);
}

/** Standalone: print demand for the WTP seed keywords (roadmap input). */
export async function runSeeds() {
  console.log('Seed keyword demand (autocomplete):');
  const scored: { kw: string; demand: number; n: number }[] = [];
  for (const kw of SEED_KEYWORDS) {
    try {
      const s = await autocomplete(kw);
      scored.push({ kw, demand: demandScore(kw, s), n: s.length });
    } catch (e) {
      console.warn(`  ! ${kw}: ${(e as Error).message}`);
    }
  }
  scored.sort((a, b) => b.demand - a.demand);
  for (const s of scored) {
    console.log(`  ${s.demand.toFixed(2)}  (${String(s.n).padStart(2)} sugg)  ${s.kw}`);
  }
}
