// Validation et normalisation des entrées clients.
// Règle de normalisation : trim partout, lower sur l'email.
// Chaîne vide => null (important pour les index UNIQUE partiels).

const VALID_TYPES = ['one_shot', 'pro'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// undefined => champ absent ; null => fourni mais vide ; sinon valeur trimmée.
function normalizeString(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeEmail(value) {
  const s = normalizeString(value);
  return s == null ? s : s.toLowerCase();
}

function normalizeTelephone(value) {
  // Numéro : trim suffit (lower n'a pas d'effet). On ne réécrit pas le format
  // pour ne pas fusionner par erreur des numéros distincts.
  return normalizeString(value);
}

// POST /clients : nom obligatoire, tous les champs normalisés.
function validateForCreate(body) {
  const errors = [];
  const data = {};

  const nom = normalizeString(body.nom);
  if (!nom) errors.push('nom est obligatoire');
  data.nom = nom ?? null;

  const email = normalizeEmail(body.email);
  if (email != null && !EMAIL_RE.test(email)) errors.push('email invalide');
  data.email = email ?? null;

  data.telephone = normalizeTelephone(body.telephone) ?? null;

  let type = normalizeString(body.type);
  if (type == null) type = 'pro';
  else if (!VALID_TYPES.includes(type)) {
    errors.push(`type doit valoir ${VALID_TYPES.join(' | ')}`);
  }
  data.type = type;

  data.notes = normalizeString(body.notes) ?? null;

  return { errors, data };
}

// PUT /clients/:id : mise à jour partielle, seuls les champs *présents* comptent.
function validateForUpdate(body) {
  const errors = [];
  const data = {};

  if ('nom' in body) {
    const nom = normalizeString(body.nom);
    if (!nom) errors.push('nom ne peut pas être vide');
    else data.nom = nom;
  }
  if ('email' in body) {
    const email = normalizeEmail(body.email);
    if (email != null && !EMAIL_RE.test(email)) errors.push('email invalide');
    else data.email = email ?? null;
  }
  if ('telephone' in body) {
    data.telephone = normalizeTelephone(body.telephone) ?? null;
  }
  if ('type' in body) {
    const type = normalizeString(body.type);
    if (type == null || !VALID_TYPES.includes(type)) {
      errors.push(`type doit valoir ${VALID_TYPES.join(' | ')}`);
    } else {
      data.type = type;
    }
  }
  if ('notes' in body) {
    data.notes = normalizeString(body.notes) ?? null;
  }

  return { errors, data };
}

module.exports = { validateForCreate, validateForUpdate, VALID_TYPES };
