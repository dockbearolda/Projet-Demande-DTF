const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// Applique au boot les migrations SQL absentes de `schema_migrations`.
// Chaque fichier est joué dans une transaction ; l'enregistrement n'a lieu
// qu'en cas de succès. Les fichiers sont triés par nom (001_, 002_, ...).
async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] appliqué : ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`[migrate] échec sur ${file} : ${err.message}`);
    } finally {
      client.release();
    }
  }
}

module.exports = { runMigrations };
