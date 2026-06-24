const { createPool } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { buildApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);

// Fail-fast : on refuse de démarrer sans config critique (jamais d'API ouverte).
function assertEnv() {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.API_KEY) missing.push('API_KEY');
  if (missing.length) {
    console.error(`[boot] variables d'environnement manquantes : ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  assertEnv();

  const pool = createPool();

  // Migration au boot (idempotente, voir db/migrate.js).
  await runMigrations(pool);
  console.log('[boot] migrations à jour');

  const app = buildApp(pool);
  const server = app.listen(PORT, () => {
    console.log(`[boot] clients-api à l'écoute sur le port ${PORT}`);
  });

  // Arrêt propre : on ferme le serveur HTTP puis le pool.
  const shutdown = (signal) => {
    console.log(`[shutdown] signal ${signal} reçu, fermeture…`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[boot] échec du démarrage :', err.message);
  process.exit(1);
});
