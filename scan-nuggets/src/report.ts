import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './db';
import { Candidate, Review } from './types';
import { cwsUrl } from './config';
import { ensureDir, OUT_DIR, toCsv } from './util';

export function report() {
  ensureDir(OUT_DIR);
  const rows = db
    .prepare("SELECT * FROM candidates WHERE reason='candidate' ORDER BY score DESC")
    .all() as unknown as Candidate[];

  if (!rows.length) {
    console.log('• nothing to report — run `ingest`, `demand`, `score` first');
    return;
  }

  // top50.csv
  const top50 = rows.slice(0, 50);
  const csv = toCsv(
    ['rank', 'id', 'name', 'score', 'reason', 'installs', 'monthsSinceUpdate', 'MV', 'keywordDemand', 'rating2024', 'ratingNow', 'drift', 'url'],
    top50.map((c, i) => {
      const drift = c.ratingNow != null ? +(c.rating2024 - c.ratingNow).toFixed(2) : '';
      return [
        i + 1,
        c.id,
        c.name,
        c.score,
        c.reason,
        c.installs,
        c.monthsSinceUpdate ?? '',
        c.manifestVersion ?? '',
        c.keywordDemand?.toFixed(3) ?? '',
        c.rating2024?.toFixed(2) ?? '',
        c.ratingNow?.toFixed(2) ?? '',
        drift,
        cwsUrl(c.id),
      ];
    }),
  );
  const csvPath = resolve(OUT_DIR, 'top50.csv');
  writeFileSync(csvPath, csv);

  // roadmap.md — top 10 with their recent 1–2★ reviews grouped per candidate
  const top10 = rows.slice(0, 10);
  const enriched = rows.some((r) => r.enrichedAt);
  const lines: string[] = [
    '# Goldmine roadmap — top 10',
    '',
    `_Generated from ${rows.length} scored candidates._`,
    '',
  ];
  if (!enriched) {
    lines.push(
      '> ⚠️ The enrich stage has not run yet, so rating drift, MV2 and review complaints are empty.',
      '> Run `npm run enrich` (live, rate-limited) then `npm run score` + `npm run report` to fill these in.',
      '',
    );
  }
  for (const [i, c] of top10.entries()) {
    lines.push(`## ${i + 1}. ${c.name}  —  score ${c.score}`);
    lines.push('');
    lines.push(`- **id**: \`${c.id}\`  ·  [open in CWS](${cwsUrl(c.id)})`);
    lines.push(`- **category**: ${c.category}  ·  **installs**: ${c.installs.toLocaleString()}`);
    lines.push(
      `- **rating**: ${c.rating2024?.toFixed(2)} (2024)` +
        (c.ratingNow != null ? ` → ${c.ratingNow.toFixed(2)} (now), drift ${(c.rating2024 - c.ratingNow).toFixed(2)}` : ''),
    );
    lines.push(
      `- **keyword**: \`${c.keyword ?? '—'}\` (demand ${c.keywordDemand?.toFixed(2) ?? '—'})` +
        (c.manifestVersion ? `  ·  **MV${c.manifestVersion}**` : '') +
        (c.monthsSinceUpdate != null ? `  ·  updated ${c.monthsSinceUpdate}mo ago` : ''),
    );
    lines.push('');

    const reviews: Review[] = c.reviewsJson ? safeParse(c.reviewsJson) : [];
    const bad = reviews
      .filter((r) => r.stars <= 2)
      .sort((a, b) => (a.ageMonths ?? 999) - (b.ageMonths ?? 999));
    if (bad.length) {
      lines.push('**Recent 1–2★ complaints (your roadmap):**');
      lines.push('');
      for (const r of bad.slice(0, 10)) {
        const age = r.ageMonths != null ? `${r.ageMonths.toFixed(1)}mo` : (r.date ?? '?');
        lines.push(`- ${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} (${age}) — ${r.text.replace(/\n+/g, ' ').slice(0, 280)}`);
      }
    } else {
      lines.push('_No recent 1–2★ reviews captured (run/expand enrich)._');
    }
    lines.push('');
  }
  const mdPath = resolve(OUT_DIR, 'roadmap.md');
  writeFileSync(mdPath, lines.join('\n'));

  console.log(`✓ wrote ${csvPath}`);
  console.log(`✓ wrote ${mdPath}`);
}

function safeParse(s: string): Review[] {
  try {
    return JSON.parse(s) as Review[];
  } catch {
    return [];
  }
}
