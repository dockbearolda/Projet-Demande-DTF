const crypto = require('crypto');

// Comparaison à temps constant pour éviter une attaque temporelle sur la clé.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Exige X-API-Key === process.env.API_KEY. 401 sinon.
function apiKeyAuth(req, res, next) {
  const expected = process.env.API_KEY;
  const provided = req.get('X-API-Key');

  if (!provided || !expected || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Non autorisé', code: 'UNAUTHORIZED' });
  }
  next();
}

module.exports = { apiKeyAuth };
