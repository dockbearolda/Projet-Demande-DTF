import { WTP_CATEGORIES, MELTING_ICE, BANNED_RISK } from './config';
import { clamp } from './util';

// "goldmine shape" score of a candidate.
// Faithful to the provided score.js. The ONLY change: ratingNow is coalesced to
// rating2024 when the candidate has not been enriched yet, so the drift term is a
// clean 0 instead of NaN (NaN would poison the whole score). Everything else —
// weights, bands, philosophy — is verbatim.

export interface Scored<T> {
  scored: T;
  score: number;
  reason: string;
}

export interface ScoreInput {
  name: string;
  description?: string | null;
  category: string;
  installs: number;
  rating2024: number;
  ratingNow: number | null;
  monthsSinceUpdate: number | null;
  manifestVersion: number | null;
  keywordDemand: number;
  recentReviews90d: number;
  fixableComplaints: number;
}

export function scoreCandidate<T extends ScoreInput>(c: T): Scored<T> {
  const name = `${c.name} ${c.description ?? ''} ${c.category}`.toLowerCase();

  // hard exclusions
  if (MELTING_ICE.some((k) => name.includes(k))) return { scored: c, score: -1, reason: 'melting-ice' };
  if (BANNED_RISK.some((k) => name.includes(k))) return { scored: c, score: -1, reason: 'banned-risk' };

  const ratingNow = c.ratingNow ?? c.rating2024; // guard: pre-enrich => drift 0

  // 1. DEMAND (max weight) — keywordDemand ∈ [0,1] + recent-review velocity
  const demand = (c.keywordDemand || 0) * 40 + clamp(Math.log10((c.recentReviews90d || 0) + 1), 0, 2) * 10; // 0–60

  // 2. STALENESS — peak in the 12–24 month window
  const m = c.monthsSinceUpdate ?? 0;
  const staleness = m < 12 ? (m / 12) * 8 : m <= 24 ? 18 : clamp(18 - (m - 24) / 3, 4, 18);

  // 3. MV2 = guaranteed-broken since Oct 2024 → strong rebuild signal
  const mv2 = c.manifestVersion === 2 ? 12 : 0;

  // 4. RATING DRIFT (decay = angry users)
  const drift = clamp((c.rating2024 - ratingNow) * 6, 0, 12);

  // 5. RECENT FIXABLE COMPLAINTS (1–2★: broken/not working/update/abandoned)
  const complaints = clamp((c.fixableComplaints || 0) * 2, 0, 12);

  // 6. WTP category
  const wtp = WTP_CATEGORIES.some((cat) => c.category?.toLowerCase().includes(cat)) ? 8 : 2;

  // installs = MINOR factor (users you will never reach)
  const installsMinor = clamp(Math.log10(c.installs || 1) - 3, 0, 4); // ~0 under 1k, ~4 at 10M

  const score = demand + staleness + mv2 + drift + complaints + wtp + installsMinor;
  return { scored: c, score: Math.round(score), reason: 'candidate' };
}
