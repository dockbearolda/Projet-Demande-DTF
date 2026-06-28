import { db } from './db';
import { cwsUrl } from './config';
import { Review } from './types';
import { cachePath, nowIso, readJsonCache, RateLimited, sleep, writeJsonCache } from './util';
import { detectManifestVersion } from './manifest';

const RL_MS = Number(process.env.ENRICH_RL_MS ?? 3000);
const LIMIT = Number(process.env.ENRICH_LIMIT ?? 60);
// Identifying UA for the plain programmatic fetches (CRX, autocomplete).
const UA =
  process.env.ENRICH_UA ?? 'nuggets-research/0.1 (+local perso research; dockbear@gmail.com)';
// The CWS detail page is a real Chrome SPA — we ARE driving Chromium, so we present a
// real Chrome UA (not evasion) so the page renders and the consent flow behaves.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FIXABLE_RE = /broken|not working|doesn'?t work|stopped working|no longer|stopped|abandoned|please update|needs? (an )?update|outdated|crash/i;

interface Extracted {
  ratingNow: number | null;
  lastUpdated: string | null; // ISO date
  reviews: Review[];
}

/** Parse "3 months ago" / "a year ago" / "Mar 5, 2024" into an age in months. */
function ageMonths(label: string | null, now: Date): number | null {
  if (!label) return null;
  const l = label.toLowerCase().trim();
  const rel = l.match(/(a|an|\d+)\s*(day|week|month|year)s?\s*ago/);
  if (rel) {
    const n = rel[1] === 'a' || rel[1] === 'an' ? 1 : Number(rel[1]);
    const unit = rel[2];
    const perMonth = unit === 'day' ? 1 / 30 : unit === 'week' ? 1 / 4.345 : unit === 'year' ? 12 : 1;
    return n * perMonth;
  }
  const abs = Date.parse(label);
  if (!Number.isNaN(abs)) return (now.getTime() - abs) / (1000 * 60 * 60 * 24 * 30.44);
  return null;
}

/** Best-effort extraction from a live CWS detail page (the page is a heavy SPA). */
async function extractFromPage(id: string): Promise<Extracted> {
  // Lazy import so the rest of the pipeline never needs Playwright installed.
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'playwright not installed — run `npm i playwright && npx playwright install chromium`',
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: BROWSER_UA, locale: 'en-US' });
    const page = await ctx.newPage();
    const res = await page.goto(cwsUrl(id), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (res && res.status() === 429) throw new RateLimited(`429 for ${id}`);

    // EU/consent regions (e.g. gl=MF) redirect to consent.google.com before the store.
    // Click through it once so we actually reach the extension page.
    if (page.url().includes('consent.google.com')) {
      try {
        await page.getByRole('button', { name: /accept all|reject all/i }).first().click({ timeout: 5000 });
        await page.waitForURL(/chromewebstore\.google\.com/, { timeout: 15_000 });
      } catch {
        /* if it persists, extraction below just yields nulls */
      }
    }
    await page.waitForTimeout(3000); // let the SPA settle
    // Scroll down so any lazy-loaded reviews section renders.
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1600);
      await page.waitForTimeout(400);
    }

    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      // rating: "4.2(1.2K ratings)" or "4.2 out of 5"
      let ratingNow: number | null = null;
      const r1 = text.match(/(\d(?:\.\d)?)\s*\(\s*[\d.,KkMm]+\s*ratings?\)/);
      const r2 = text.match(/(\d(?:\.\d)?)\s*out of 5/);
      const rv = r1?.[1] ?? r2?.[1];
      if (rv) ratingNow = parseFloat(rv);

      // last updated: "Updated\nOctober 3, 2024"
      let lastUpdated: string | null = null;
      const u = text.match(/Updated\s*[\r\n]+\s*([A-Za-z]+ \d{1,2}, \d{4})/);
      if (u) lastUpdated = u[1];

      // reviews: a genuine review block has a per-review star rating AND a date.
      // Requiring a date excludes the page-level aggregate ("4.0 out of 5 stars")
      // and the related-extension carousel ("Average rating X out of 5 stars."),
      // which were previously being mis-captured as reviews.
      const reviews: { stars: number; text: string; date: string | null }[] = [];
      const seen = new Set<string>();
      const dateRe = /\b(\d+\s*(?:day|week|month|year)s?\s*ago|[A-Za-z]{3,9} \d{1,2}, \d{4})\b/;
      for (const el of Array.from(document.querySelectorAll('[aria-label]'))) {
        const al = el.getAttribute('aria-label') || '';
        if (/average rating/i.test(al)) continue; // related-extension cards
        const sm = al.match(/(\d(?:\.\d)?)\s*out of 5/);
        if (!sm) continue;
        let n: Element | null = el;
        for (let d = 0; d < 7 && n; d++) {
          const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
          const dm = t.match(dateRe);
          if (dm && t.length >= 30 && t.length <= 900) {
            const key = t.slice(0, 80);
            if (!seen.has(key)) {
              seen.add(key);
              reviews.push({ stars: Math.round(parseFloat(sm[1])), text: t.slice(0, 600), date: dm[0] });
            }
            break;
          }
          n = n.parentElement;
        }
      }
      return { ratingNow, lastUpdated, reviews };
    });

    const now = new Date();
    const updatedIso =
      data.lastUpdated && !Number.isNaN(Date.parse(data.lastUpdated))
        ? new Date(data.lastUpdated).toISOString().slice(0, 10)
        : null;
    const reviews: Review[] = data.reviews
      .slice(0, 30)
      .map((r) => ({ ...r, ageMonths: ageMonths(r.date, now) }));
    return { ratingNow: data.ratingNow, lastUpdated: updatedIso, reviews };
  } finally {
    await browser.close();
  }
}

export async function runEnrich(opts: { limit?: number; all?: boolean } = {}) {
  const limit = opts.limit ?? LIMIT;
  // Shortlist = top provisional-score candidates not yet enriched. Falls back to
  // demand order if scoring hasn't run yet.
  const where = opts.all ? "reason='candidate'" : "reason='candidate' AND enrichedAt IS NULL";
  const rows = db
    .prepare(
      `SELECT id, name FROM candidates WHERE ${where}
       ORDER BY COALESCE(score, keywordDemand*100) DESC LIMIT ?`,
    )
    .all(limit) as { id: string; name: string }[];

  if (!rows.length) {
    console.log('• nothing to enrich (run `score` first, or pass --all)');
    return;
  }
  console.log(`• enriching ${rows.length} candidates (live CWS + CRX, ${RL_MS}ms/req) …`);

  const update = db.prepare(`
    UPDATE candidates SET
      ratingNow=@ratingNow, lastUpdated=@lastUpdated, monthsSinceUpdate=@monthsSinceUpdate,
      manifestVersion=@manifestVersion, recentReviews90d=@recentReviews90d,
      fixableComplaints=@fixableComplaints, reviewsJson=@reviewsJson, enrichedAt=@enrichedAt
    WHERE id=@id
  `);

  const now = new Date();
  let done = 0;
  for (const r of rows) {
    const cacheFile = cachePath('cws', `${r.id}.json`);
    let ext = readJsonCache<Extracted>(cacheFile);
    let mv: number | null = null;

    try {
      mv = await detectManifestVersion(r.id, UA);
      if (!ext) {
        ext = await extractFromPage(r.id);
        writeJsonCache(cacheFile, ext);
        await sleep(RL_MS); // strict rate limit only on real fetches
      }
    } catch (e) {
      if (e instanceof RateLimited) {
        console.error(`✗ HTTP 429 — stopping to respect the rate limit. ${done} enriched.`);
        break;
      }
      console.warn(`  ! ${r.name}: ${(e as Error).message}`);
      if (!ext) ext = { ratingNow: null, lastUpdated: null, reviews: [] };
    }

    const monthsSinceUpdate = ext.lastUpdated
      ? (now.getTime() - Date.parse(ext.lastUpdated)) / (1000 * 60 * 60 * 24 * 30.44)
      : null;
    const recent = ext.reviews.filter((rv) => rv.ageMonths != null && rv.ageMonths <= 3);
    const fixable = ext.reviews.filter(
      (rv) => rv.stars <= 2 && rv.ageMonths != null && rv.ageMonths <= 6 && FIXABLE_RE.test(rv.text),
    );

    update.run({
      id: r.id,
      ratingNow: ext.ratingNow,
      lastUpdated: ext.lastUpdated,
      monthsSinceUpdate: monthsSinceUpdate != null ? Number(monthsSinceUpdate.toFixed(1)) : null,
      manifestVersion: mv,
      recentReviews90d: recent.length,
      fixableComplaints: fixable.length,
      reviewsJson: JSON.stringify(ext.reviews),
      enrichedAt: nowIso(),
    });
    done++;
    if (done % 10 === 0) console.log(`    ${done}/${rows.length}`);
  }
  console.log(`✓ enriched ${done} candidates`);
}
