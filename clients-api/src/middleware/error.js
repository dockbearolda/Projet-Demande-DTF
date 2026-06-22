// Enrobe un handler async : les rejets de promesse partent vers errorHandler.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Route inconnue.
function notFound(req, res) {
  res.status(404).json({ error: 'Ressource introuvable', code: 'NOT_FOUND' });
}

// Handler d'erreurs central : codes HTTP corrects, aucune fuite de stacktrace.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // JSON malformé dans le body (body-parser).
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide', code: 'BAD_REQUEST' });
  }
  // Violation d'unicité Postgres (email/téléphone déjà pris par une autre fiche).
  if (err && err.code === '23505') {
    return res
      .status(409)
      .json({ error: 'Conflit : email ou téléphone déjà utilisé', code: 'CONFLICT' });
  }
  // Syntaxe invalide (ex : UUID/valeur mal formée).
  if (err && err.code === '22P02') {
    return res.status(400).json({ error: 'Identifiant ou valeur invalide', code: 'BAD_REQUEST' });
  }

  // On logge la stack côté serveur, on ne l'expose jamais au client.
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Erreur interne', code: 'INTERNAL' });
}

module.exports = { asyncHandler, notFound, errorHandler };
