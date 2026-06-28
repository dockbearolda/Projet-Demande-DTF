import { loadEnv } from './util';
loadEnv(); // read .env before anything touches process.env

import { db, DB_FILE } from './db';
import { ingest } from './ingest';
import { runDemand, runSeeds } from './demand';
import { runEnrich } from './enrich';
import { scoreAll } from './scoreAll';
import { report } from './report';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function stats() {
  const total = (db.prepare('SELECT COUNT(*) n FROM candidates').get() as { n: number }).n;
  if (!total) {
    console.log('• DB empty — run `ingest`');
    return;
  }
  const demanded = (db.prepare('SELECT COUNT(*) n FROM candidates WHERE demandAt IS NOT NULL').get() as { n: number }).n;
  const enriched = (db.prepare('SELECT COUNT(*) n FROM candidates WHERE enrichedAt IS NOT NULL').get() as { n: number }).n;
  const scored = (db.prepare('SELECT COUNT(*) n FROM candidates WHERE score IS NOT NULL').get() as { n: number }).n;
  const byReason = db.prepare('SELECT reason, COUNT(*) n FROM candidates GROUP BY reason').all();
  console.log(`DB: ${DB_FILE}`);
  console.log(`  candidates : ${total}`);
  console.log(`  demand-scored: ${demanded}`);
  console.log(`  enriched   : ${enriched}`);
  console.log(`  scored     : ${scored}`);
  console.log(`  by reason  : ${JSON.stringify(byReason)}`);
}

const HELP = `scan-nuggets — Chrome Web Store goldmine finder

Usage: npm run <stage>  (or: tsx src/cli.ts <stage> [flags])

Stages
  ingest            download + filter the DebugBear 2024 dataset into SQLite
                      flags: --refresh (re-download the 59MB dataset)
  demand            Google-autocomplete demand score per candidate
                      flags: --all (recompute all), --limit N
  score             apply score.ts to every candidate
  enrich            LIVE, rate-limited: CWS page + CRX manifest for the shortlist
                      flags: --limit N (default ENRICH_LIMIT=60), --all
  report            write out/top50.csv + out/roadmap.md
  seeds             print demand for the WTP seed keywords
  stats             show pipeline progress
  all               ingest → demand → score → report  (NOT enrich; that is live)

Typical run
  npm run all                 # offline pool + demand + score + report
  npm run enrich              # then the live, polite shortlist enrichment
  npm run score && npm run report   # re-score with drift/MV2/complaints filled in
`;

async function main() {
  const cmd = process.argv[2];
  const limit = opt('limit') ? Number(opt('limit')) : undefined;
  switch (cmd) {
    case 'ingest':
      await ingest({ refresh: flag('refresh') });
      break;
    case 'demand':
      await runDemand({ all: flag('all'), limit });
      break;
    case 'score':
      scoreAll();
      break;
    case 'enrich':
      await runEnrich({ all: flag('all'), limit });
      break;
    case 'report':
      report();
      break;
    case 'seeds':
      await runSeeds();
      break;
    case 'stats':
      stats();
      break;
    case 'all':
      await ingest({ refresh: flag('refresh') });
      await runDemand({ all: flag('all'), limit });
      scoreAll();
      report();
      console.log('\n→ next: `npm run enrich` (live), then `npm run score && npm run report`');
      break;
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
