import { db } from './db';
import { Candidate } from './types';
import { scoreCandidate } from './score';

export function scoreAll() {
  const rows = db.prepare('SELECT * FROM candidates').all() as unknown as Candidate[];
  if (!rows.length) {
    console.log('• no candidates — run `ingest` first');
    return;
  }
  const update = db.prepare('UPDATE candidates SET score=?, reason=? WHERE id=?');
  db.prepare('BEGIN').run();
  const counts: Record<string, number> = {};
  for (const c of rows) {
    const { score, reason } = scoreCandidate(c);
    update.run(score, reason, c.id);
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  db.prepare('COMMIT').run();

  const top = db
    .prepare("SELECT name, score FROM candidates WHERE reason='candidate' ORDER BY score DESC LIMIT 5")
    .all() as { name: string; score: number }[];
  console.log(`✓ scored ${rows.length} candidates  (${JSON.stringify(counts)})`);
  console.log('  top 5:');
  for (const t of top) console.log(`    ${String(t.score).padStart(3)}  ${t.name}`);
}
