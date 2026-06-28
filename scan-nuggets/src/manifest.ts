import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { crxUrl } from './config';
import { cachePath, fetchWithRetry } from './util';

/**
 * Read manifest_version from the extension's public CRX.
 *
 * manifest_version is NOT shown on the public CWS detail page, so we fetch the CRX
 * (the exact package a user installs) and read manifest.json out of it. A .crx is a
 * ZIP with a small header prefix; `unzip` finds the central directory from the end of
 * the file and ignores the prefix, so `unzip -p file.crx manifest.json` just works.
 *
 * Best-effort: any failure returns null (the MV2 signal simply stays absent).
 */
export async function detectManifestVersion(id: string, ua: string): Promise<number | null> {
  const crx = cachePath('crx', `${id}.crx`);
  try {
    if (!existsSync(crx)) {
      const res = await fetchWithRetry(crxUrl(id), { timeoutMs: 30_000, ua });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) return null; // not a real package
      writeFileSync(crx, buf);
    }
    // `unzip` exits non-zero on the harmless "extra bytes" warning that every CRX
    // triggers (the protobuf header before the ZIP), so we use spawnSync and read
    // stdout regardless of the exit code rather than letting it throw.
    const out = spawnSync('unzip', ['-p', crx, 'manifest.json'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    if (!out.stdout) return null;
    const mf = JSON.parse(stripJsonComments(out.stdout));
    const mv = Number(mf.manifest_version);
    return mv === 2 || mv === 3 ? mv : null;
  } catch {
    return null;
  }
}

// Chrome tolerates // and /* */ comments in manifest.json; strip them before JSON.parse.
function stripJsonComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
