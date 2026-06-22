// Tests d'intégration de bout en bout (node:test + fetch natif).
// Nécessite une base Postgres accessible via DATABASE_URL. Sans elle, la suite
// est ignorée (skip) plutôt que de tomber en échec.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createPool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrate');
const { buildApp } = require('../src/app');

const HAS_DB = Boolean(process.env.DATABASE_URL);
const API_KEY = 'test-key';

let pool;
let server;
let base;

before(async () => {
  if (!HAS_DB) return;
  process.env.API_KEY = API_KEY;
  pool = createPool();
  await runMigrations(pool);
  await pool.query('TRUNCATE clients');

  const app = buildApp(pool);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (pool) await pool.end();
});

function api(path, opts = {}) {
  return fetch(base + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(opts.headers || {}),
    },
  });
}

test('401 sans clé API', { skip: !HAS_DB }, async () => {
  const res = await fetch(base + '/clients');
  assert.equal(res.status, 401);
});

test('401 avec mauvaise clé', { skip: !HAS_DB }, async () => {
  const res = await fetch(base + '/clients', { headers: { 'X-API-Key': 'nope' } });
  assert.equal(res.status, 401);
});

test('POST crée un client + normalise email', { skip: !HAS_DB }, async () => {
  const res = await api('/clients', {
    method: 'POST',
    body: JSON.stringify({ nom: 'Acme', email: '  CONTACT@Acme.FR ', telephone: '0102030405' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'created');
  assert.equal(body.client.nom, 'Acme');
  assert.equal(body.client.email, 'contact@acme.fr');
  assert.equal(body.client.type, 'pro');
  assert.match(body.client.id, /^[0-9a-f-]{36}$/);
});

test('POST dédup sur email -> merged (enrichit la fiche)', { skip: !HAS_DB }, async () => {
  const res = await api('/clients', {
    method: 'POST',
    body: JSON.stringify({ nom: 'Acme SARL', email: 'contact@acme.fr', notes: 'maj' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'merged');
  assert.equal(body.client.nom, 'Acme SARL');
  assert.equal(body.client.notes, 'maj');
  assert.equal(body.client.telephone, '0102030405'); // conservé
});

test('POST dédup sur téléphone -> merged', { skip: !HAS_DB }, async () => {
  const res = await api('/clients', {
    method: 'POST',
    body: JSON.stringify({ nom: 'Acme Tel', telephone: '0102030405' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'merged');
});

test('POST sans nom -> 400', { skip: !HAS_DB }, async () => {
  const res = await api('/clients', { method: 'POST', body: JSON.stringify({ email: 'x@y.fr' }) });
  assert.equal(res.status, 400);
});

test('POST type invalide -> 400', { skip: !HAS_DB }, async () => {
  const res = await api('/clients', {
    method: 'POST',
    body: JSON.stringify({ nom: 'Zed', type: 'particulier' }),
  });
  assert.equal(res.status, 400);
});

test('GET /clients/:id + 404 (uuid inexistant et id invalide)', { skip: !HAS_DB }, async () => {
  const created = await (
    await api('/clients', { method: 'POST', body: JSON.stringify({ nom: 'Bob' }) })
  ).json();
  const id = created.client.id;

  assert.equal((await api('/clients/' + id)).status, 200);
  assert.equal((await api('/clients/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await api('/clients/pas-un-uuid')).status, 404);
});

test('GET /clients?q= recherche multi-champ', { skip: !HAS_DB }, async () => {
  const res = await api('/clients?q=acme');
  const rows = await res.json();
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length >= 1);
  assert.ok(rows.length <= 20);
});

test('PUT met à jour partiellement et bump updated_at', { skip: !HAS_DB }, async () => {
  const created = await (
    await api('/clients', { method: 'POST', body: JSON.stringify({ nom: 'Carl', type: 'pro' }) })
  ).json();
  const id = created.client.id;

  const res = await api('/clients/' + id, {
    method: 'PUT',
    body: JSON.stringify({ type: 'one_shot' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'one_shot');
  assert.equal(body.nom, 'Carl'); // champ non fourni conservé
  assert.notEqual(body.updated_at, created.client.updated_at);
});

test('PUT sur id inexistant -> 404', { skip: !HAS_DB }, async () => {
  const res = await api('/clients/00000000-0000-0000-0000-000000000000', {
    method: 'PUT',
    body: JSON.stringify({ nom: 'X' }),
  });
  assert.equal(res.status, 404);
});
