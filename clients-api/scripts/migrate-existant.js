#!/usr/bin/env node
/**
 * migrate-existant.js — Import des clients « legacy » vers clients-api.
 *
 * Principe : on lit un CSV de clients existants et on les pousse via
 * POST /clients. L'API se charge de la DÉDUP (email puis téléphone), donc
 * relancer le script est sans danger : un client déjà présent est fusionné,
 * pas dupliqué.
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  SQUELETTE : la source CSV est à brancher plus tard.                  │
 *  │  1. Mets ton fichier à CSV_PATH (ou exporte la variable d'env).      │
 *  │  2. Adapte mapRow() aux noms de colonnes de TON export.             │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * Lancement :
 *   API_URL=http://localhost:3000 \
 *   API_KEY=ta-cle \
 *   CSV_PATH=./clients-legacy.csv \
 *   npm run migrate:existant
 */

const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, 'clients-legacy.csv');
const DRY_RUN = process.env.DRY_RUN === 'true';

// --- Mapping CSV -> payload API ------------------------------------------
// Adapte les clés (à gauche du ||) aux entêtes de ton CSV. Les entêtes sont
// normalisées en minuscules avant d'arriver ici.
function mapRow(record) {
  return {
    nom: record.nom || record.name || record.client || '',
    email: record.email || record.mail || '',
    telephone: record.telephone || record.tel || record.phone || '',
    type: record.type || 'pro',
    notes: record.notes || record.commentaire || '',
  };
}

// --- Mini parseur CSV -----------------------------------------------------
// Gère les guillemets doubles et les virgules échappées. Suffisant pour un
// import ponctuel ; pour un CSV complexe (retours-ligne dans un champ),
// remplace par la lib `csv-parse`.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToRecords(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const rec = {};
    headers.forEach((h, idx) => {
      rec[h] = (r[idx] || '').trim();
    });
    return rec;
  });
}

async function upsertClient(payload) {
  const res = await fetch(`${API_URL}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} : ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  if (!API_KEY) {
    console.error('API_KEY manquant (exporte la variable d’environnement).');
    process.exit(1);
  }
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV introuvable : ${CSV_PATH}`);
    console.error('Renseigne CSV_PATH une fois ta source legacy prête.');
    process.exit(1);
  }

  const records = rowsToRecords(parseCsv(fs.readFileSync(CSV_PATH, 'utf8')));
  console.log(`${records.length} ligne(s) à importer depuis ${CSV_PATH}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  let created = 0;
  let merged = 0;
  let failed = 0;

  for (const [index, record] of records.entries()) {
    const ligne = index + 2; // +1 entête, +1 base 1
    const payload = mapRow(record);

    if (!payload.nom) {
      console.warn(`L${ligne} ignorée : nom vide`);
      failed++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`L${ligne} (dry) ->`, payload);
      continue;
    }
    try {
      const { status } = await upsertClient(payload);
      if (status === 'created') created++;
      else merged++;
    } catch (err) {
      console.error(`L${ligne} échec :`, err.message);
      failed++;
    }
  }

  console.log(`Terminé : ${created} créé(s), ${merged} fusionné(s), ${failed} échec(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
