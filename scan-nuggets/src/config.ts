// Locked philosophy (see score.ts): keyword demand + rating drift + MV2 dominate;
// installs is a minor factor; melting-ice and banned categories are excluded outright.

// WTP = "willingness to pay". Substring-matched against the candidate category.
export const WTP_CATEGORIES = [
  'productivity',
  'developer-tools',
  'seo',
  'marketing',
  'finance',
  'workflow',
];

// The browser is absorbing these — the keyword melts away under you. Exclude.
export const MELTING_ICE = [
  'tab ',
  'suspend',
  'memory',
  'dark mode',
  'new tab',
  'screenshot',
  'ad block',
  'adblock',
];

// CWS-policy / ToS risk. Exclude.
export const BANNED_RISK = [
  'coupon',
  'cashback',
  'affiliate',
  'auto-buy',
  'autobuy',
  'bot ',
  'scraper',
  'vpn',
  'crack',
  'proxy',
];

// The DebugBear 2024 dataset only exposes 3 top categories split into ~18 subcategories.
// These are the WTP-relevant ones we keep at ingest time. SEO / marketing / finance are
// NOT separate buckets in 2024 — they live inside productivity/{tools,workflow}, and the
// keyword-demand stage surfaces them from there.
export const INGEST_CATEGORIES = new Set([
  'productivity/workflow',
  'productivity/tools',
  'productivity/developer',
  'productivity/communication',
]);

// Stage-1 hard filter (DebugBear 2024 fields).
export const FILTER = {
  installsMin: 10_000,
  installsMax: 1_000_000,
  ratingMin: 3.5,
  ratingMax: 4.4,
};

// Seed keywords for the demand stage / `seeds` report. Start here, widen via autocomplete.
export const SEED_KEYWORDS = [
  'seo overlay',
  'invoice',
  'screen recorder annotate',
  'email finder',
  'json viewer pro',
  'pdf fill',
  'salesforce',
  'notion',
  'accessibility audit',
  'meta tags',
  'crm',
  'time tracker',
];

export const DATASET_URL =
  'https://raw.githubusercontent.com/DebugBear/chrome-extension-list/master/extensions-2024.json';

// Public CRX endpoint — the exact artifact a user installs. Used to read manifest_version,
// which is NOT present on the public CWS detail page.
export const crxUrl = (id: string) =>
  `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3` +
  `&prodversion=120.0&x=id%3D${id}%26installsource%3Dondemand%26uc`;

export const cwsUrl = (id: string) => `https://chromewebstore.google.com/detail/${id}`;
