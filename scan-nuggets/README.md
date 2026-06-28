# scan-nuggets

Find Chrome Web Store extensions that are **goldmine-shaped to rebuild**: high keyword
demand, declining rating, stuck on Manifest V2, recent fixable complaints — in
willingness-to-pay categories. Five offline-first stages over the free
[DebugBear 2024 dataset](https://github.com/DebugBear/chrome-extension-list), with a
small, strictly rate-limited live enrichment pass for the shortlist only.

The scoring philosophy is locked (see [`src/score.ts`](src/score.ts)): **keyword demand +
rating drift + MV2 dominate; installs is minor; melting-ice and banned categories are
excluded outright.**

## Pipeline

| Stage | What | Network |
|-------|------|---------|
| `ingest` | Download the DebugBear 2024 JSON → SQLite. Keep WTP categories, installs 10k–1M, rating 3.5–4.4. | 1× 59 MB download (cached) |
| `demand` | Per candidate: Google autocomplete → `keywordDemand ∈ [0,1]`. | many tiny calls, cached, ~300 ms apart |
| `score` | Apply `score.ts` to every candidate. | none |
| `enrich` | **Live, shortlist only.** Public CWS page → `ratingNow`, `lastUpdated`; public CRX → `manifest_version`; reviews best-effort (see note). | 1 req / 3 s, disk-cached, stops on HTTP 429 |
| `report` | `out/top50.csv` + `out/roadmap.md` (top-10 with their recent 1–2★ reviews). | none |

## Run

```bash
npm install                       # tsx + playwright pkg (no native build)
npm run all                       # ingest → demand → score → report (offline + autocomplete)

# then the live, polite shortlist pass:
npx playwright install chromium   # one-time, only needed for enrich's page scrape
npm run enrich                    # CWS pages + CRX manifests for the top ~60
npm run score && npm run report   # re-score now that drift / MV2 / complaints are filled in
```

Other commands: `npm run seeds` (demand for the WTP seed keywords), `npm run stats`
(pipeline progress), `npm run ingest -- --refresh` (re-download the dataset),
`npm run demand -- --limit 50` / `-- --all`.

Output lands in `out/`. The SQLite DB and all caches live in `data/` (both git-ignored).

## Notes / deviations from the original spec

- **SQLite via Node's built-in `node:sqlite`** instead of `better-sqlite3` — zero native
  compile on Node 24, fewer deps. Same synchronous API shape.
- **`manifest_version` comes from the public CRX, not the CWS page.** The new Chrome Web
  Store detail page does not expose `manifest_version` anywhere in its DOM. We download the
  CRX (the exact package a user installs) and read `manifest.json` from it via `unzip`.
  Best-effort: if it fails, the MV2 signal is simply absent (no crash).
- **`score.ts` is faithful to the provided `score.js`** — same weights, bands, exclusions.
  The only change: `ratingNow` is coalesced to `rating2024` for not-yet-enriched candidates
  so the drift term is a clean `0` instead of `NaN`.
- The 2024 dataset has no SEO / marketing / finance buckets; those tools live inside
  `productivity/{tools,workflow}` and surface via keyword demand.
- **Enrich's strong signals — `ratingNow` (→ drift), `manifest_version` (MV2),
  `lastUpdated` (→ staleness) — are solid and verified.** The page also crosses the
  EU consent wall automatically (Saint-Martin / `gl=MF` redirects to `consent.google.com`).
- **Reviews are best-effort and often empty.** The current `chromewebstore.google.com`
  renders individual user reviews inconsistently (JS-gated, obfuscated, sometimes absent
  from the headless DOM). The extractor only accepts a block that has both a per-review
  star rating *and* a date, so it never mistakes the related-extension carousel for
  reviews — but that means `recentReviews90d` / `fixableComplaints` (and the roadmap
  quotes) are 0 when the page doesn't expose reviews. Those terms simply don't contribute
  to the score in that case; the demand + drift + MV2 + staleness signals still rank the list.

## Guardrails

Small volume only (the enrich shortlist is dozens, not 112k). Strict rate limit + disk
cache on every live call. Public pages only — the data any logged-out user sees. Stops
on HTTP 429. Honest, identifying User-Agent (`ENRICH_UA`). Does not touch chrome-stats.
See `.env.example` for the knobs.
