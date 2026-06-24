const express = require('express');
const { apiKeyAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');
const { clientsRouter } = require('./routes/clients');

// Construit l'app Express à partir d'un pool pg.
// Séparé de l'entrée (index.js) pour rester testable sans démarrer le serveur.
function buildApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Healthcheck public (Railway) — pas de données, donc pas d'auth.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Toutes les routes métier exigent X-API-Key.
  app.use('/clients', apiKeyAuth, clientsRouter(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
