import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export const nowIso = () => new Date().toISOString();

export const DATA_DIR = resolve(process.cwd(), 'data');
export const OUT_DIR = resolve(process.cwd(), 'out');

/** Best-effort .env loader (Node >= 20.12, zero deps). */
export function loadEnv() {
  const p = resolve(process.cwd(), '.env');
  if (existsSync(p) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(p);
    } catch {
      /* ignore */
    }
  }
}

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

export function cachePath(...parts: string[]) {
  const p = resolve(DATA_DIR, 'cache', ...parts);
  ensureDir(dirname(p));
  return p;
}

export const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

export function readJsonCache<T>(file: string): T | null {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

export function writeJsonCache(file: string, data: unknown) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(data));
}

export class RateLimited extends Error {}

interface FetchOpts {
  timeoutMs?: number;
  ua?: string;
  retries?: number;
}

/** fetch with timeout, honest UA, retry+backoff. Throws RateLimited on HTTP 429. */
export async function fetchWithRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 20_000, ua = 'nuggets-research/0.1 (+local research)', retries = 2 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': ua } });
      clearTimeout(t);
      if (res.status === 429) throw new RateLimited(`429 from ${url}`);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      clearTimeout(t);
      if (e instanceof RateLimited) throw e; // never retry a rate-limit — back off hard
      lastErr = e;
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Minimal CSV cell escaping (RFC-4180-ish). */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\n') + '\n';
}
