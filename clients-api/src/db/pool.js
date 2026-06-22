const { Pool } = require('pg');

// Crée un pool pg unique, réutilisé pour toute la durée de vie du process.
// JAMAIS de connexion par requête : on emprunte/relâche depuis ce pool.
function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL manquant : configure la variable d'environnement.");
  }

  const useSsl =
    process.env.DATABASE_SSL === 'true' || /sslmode=require/i.test(connectionString);

  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Un client inactif qui tombe ne doit pas crasher le process.
  pool.on('error', (err) => {
    console.error('[pg] erreur sur un client inactif :', err.message);
  });

  return pool;
}

module.exports = { createPool };
