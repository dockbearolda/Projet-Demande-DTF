const express = require('express');
const { asyncHandler } = require('../middleware/error');
const { validateForCreate, validateForUpdate } = require('../lib/validate');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id, nom, email, telephone, type, notes, created_at, updated_at';

function clientsRouter(pool) {
  const router = express.Router();

  // GET /clients?q=  — recherche multi-champ (nom/email/tel, ILIKE), limit 20.
  // Sans q : les 20 fiches les plus récemment modifiées (utile pour préremplir).
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = String(req.query.q || '').trim();
      let result;
      if (q) {
        const like = `%${q}%`;
        result = await pool.query(
          `SELECT ${COLUMNS} FROM clients
           WHERE nom ILIKE $1 OR email ILIKE $1 OR telephone ILIKE $1
           ORDER BY nom ASC
           LIMIT 20`,
          [like]
        );
      } else {
        result = await pool.query(
          `SELECT ${COLUMNS} FROM clients ORDER BY updated_at DESC LIMIT 20`
        );
      }
      res.json(result.rows);
    })
  );

  // GET /clients/:id — fiche complète, 404 si absente.
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(404).json({ error: 'Client introuvable', code: 'NOT_FOUND' });
      }
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM clients WHERE id = $1`, [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Client introuvable', code: 'NOT_FOUND' });
      }
      res.json(rows[0]);
    })
  );

  // POST /clients — création avec dédup sur email PUIS téléphone.
  // Transaction + FOR UPDATE : on cherche un doublon, on fusionne s'il existe,
  // sinon on insère. Renvoie { status: 'created' | 'merged', client }.
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { errors, data } = validateForCreate(req.body || {});
      if (errors.length) {
        return res
          .status(400)
          .json({ error: 'Validation', code: 'BAD_REQUEST', details: errors });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1) doublon par email, 2) sinon par téléphone.
        let existing = null;
        if (data.email) {
          const r = await client.query(
            `SELECT ${COLUMNS} FROM clients WHERE lower(email) = lower($1) LIMIT 1 FOR UPDATE`,
            [data.email]
          );
          existing = r.rows[0] || null;
        }
        if (!existing && data.telephone) {
          const r = await client.query(
            `SELECT ${COLUMNS} FROM clients WHERE telephone = $1 LIMIT 1 FOR UPDATE`,
            [data.telephone]
          );
          existing = r.rows[0] || null;
        }

        let row;
        let status;
        if (existing) {
          // MERGE : on enrichit la fiche existante avec les champs fournis.
          const merged = {
            nom: data.nom ?? existing.nom,
            email: data.email ?? existing.email,
            telephone: data.telephone ?? existing.telephone,
            type: data.type ?? existing.type,
            notes: data.notes ?? existing.notes,
          };
          const u = await client.query(
            `UPDATE clients
               SET nom = $1, email = $2, telephone = $3, type = $4, notes = $5, updated_at = now()
             WHERE id = $6
             RETURNING ${COLUMNS}`,
            [merged.nom, merged.email, merged.telephone, merged.type, merged.notes, existing.id]
          );
          row = u.rows[0];
          status = 'merged';
        } else {
          const i = await client.query(
            `INSERT INTO clients (nom, email, telephone, type, notes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING ${COLUMNS}`,
            [data.nom, data.email, data.telephone, data.type, data.notes]
          );
          row = i.rows[0];
          status = 'created';
        }

        await client.query('COMMIT');
        res.status(status === 'created' ? 201 : 200).json({ status, client: row });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  // PUT /clients/:id — mise à jour partielle, updated_at = now().
  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(404).json({ error: 'Client introuvable', code: 'NOT_FOUND' });
      }

      const { errors, data } = validateForUpdate(req.body || {});
      if (errors.length) {
        return res
          .status(400)
          .json({ error: 'Validation', code: 'BAD_REQUEST', details: errors });
      }

      const fields = Object.keys(data); // clés issues d'une whitelist (validate.js)
      if (fields.length === 0) {
        // Rien à modifier : on renvoie la fiche actuelle (404 si absente).
        const { rows } = await pool.query(`SELECT ${COLUMNS} FROM clients WHERE id = $1`, [id]);
        if (rows.length === 0) {
          return res.status(404).json({ error: 'Client introuvable', code: 'NOT_FOUND' });
        }
        return res.json(rows[0]);
      }

      const setClauses = fields.map((f, idx) => `${f} = $${idx + 1}`);
      const values = fields.map((f) => data[f]);
      setClauses.push('updated_at = now()');
      values.push(id);

      const { rows } = await pool.query(
        `UPDATE clients SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
        values
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Client introuvable', code: 'NOT_FOUND' });
      }
      res.json(rows[0]);
    })
  );

  return router;
}

module.exports = { clientsRouter };
