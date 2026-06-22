# clients-api

Micro-service **source de vérité unique** de la base clients OLDA. Exposé en
HTTP et consommé par les apps métier (planning, commandes). Sans ORM :
Node.js + Express + `pg` sur PostgreSQL.

- Dédup automatique à la création (sur email puis téléphone)
- Auth par clé d'API (`X-API-Key`) sur toutes les routes de données
- Migration SQL jouée au boot
- Déployable sur Railway, tout en variables d'environnement

---

## Installation

```bash
cd clients-api
npm install
cp .env.example .env      # puis renseigne DATABASE_URL et API_KEY
npm run dev               # http://localhost:3000
```

## Variables d'environnement

| Variable       | Requis | Défaut | Rôle                                                        |
| -------------- | :----: | ------ | ----------------------------------------------------------- |
| `DATABASE_URL` |   ✅   | —      | Chaîne de connexion PostgreSQL                              |
| `API_KEY`      |   ✅   | —      | Secret attendu dans le header `X-API-Key`                   |
| `PORT`         |   —    | `3000` | Port HTTP (Railway l'injecte)                               |
| `DATABASE_SSL` |   —    | `false`| `true` pour forcer TLS (Postgres managé externe)            |
| `PG_POOL_MAX`  |   —    | `10`   | Taille max du pool de connexions                            |

Le service **refuse de démarrer** si `DATABASE_URL` ou `API_KEY` manquent
(jamais d'API ouverte par accident).

## Migration

La table `clients` et ses index sont créés **au démarrage** : `src/index.js`
applique les fichiers de [`migrations/`](migrations/) absents de la table de
suivi `schema_migrations`. C'est idempotent — rien à lancer à la main.

---

## Authentification

Toutes les routes `/clients` exigent l'en-tête :

```
X-API-Key: <ton API_KEY>
```

Sinon → `401`. Seul `GET /health` est public (healthcheck Railway).

## Endpoints

| Méthode | Route          | Description                                            |
| ------- | -------------- | ----------------------------------------------------- |
| `GET`   | `/clients?q=`  | Recherche multi-champ (nom/email/tél, ILIKE), max 20  |
| `GET`   | `/clients/:id` | Fiche complète, `404` si absente                      |
| `POST`  | `/clients`     | Création avec dédup → `{ status: created\|merged }`   |
| `PUT`   | `/clients/:id` | Mise à jour partielle (`updated_at` rafraîchi)        |
| `GET`   | `/health`      | Healthcheck (public)                                  |

### Exemples curl

```bash
KEY="ta-cle-api"
BASE="http://localhost:3000"

# Créer (ou fusionner) un client
curl -s -X POST "$BASE/clients" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"nom":"Atelier Dupont","email":"Contact@Dupont.FR","telephone":"0102030405","type":"pro"}'
# -> 201 { "status": "created", "client": { "id": "…", "email": "contact@dupont.fr", … } }

# Re-poster le même email : fusion, pas de doublon
curl -s -X POST "$BASE/clients" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"nom":"Atelier Dupont SARL","email":"contact@dupont.fr","notes":"client fidèle"}'
# -> 200 { "status": "merged", "client": { … } }

# Recherche (autocomplete)
curl -s "$BASE/clients?q=dupont" -H "X-API-Key: $KEY"

# Fiche complète
curl -s "$BASE/clients/<id>" -H "X-API-Key: $KEY"

# Mise à jour partielle
curl -s -X PUT "$BASE/clients/<id>" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"type":"one_shot"}'
```

Sans clé :

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/clients"   # -> 401
```

---

## Tests

```bash
DATABASE_URL=postgres://localhost:5432/clients_test npm test
```

Tests d'intégration de bout en bout (`node:test`). Sans `DATABASE_URL`, la
suite est ignorée (skip) au lieu d'échouer.

## Import des clients existants

[`scripts/migrate-existant.js`](scripts/migrate-existant.js) lit un CSV legacy
et l'upsert via l'API de dédup (donc relançable sans créer de doublons). C'est
un squelette : branche ta source dans `mapRow()` puis :

```bash
API_URL=http://localhost:3000 API_KEY=ta-cle CSV_PATH=./clients.csv \
  npm run migrate:existant
# DRY_RUN=true pour visualiser sans écrire
```

---

## Déploiement Railway

1. Nouveau service depuis ce dossier (`clients-api/` comme racine), + un
   service **PostgreSQL** attaché.
2. Variables : `DATABASE_URL` (référence le Postgres), `API_KEY` (secret long).
3. Build NIXPACKS, start `npm start`, healthcheck `/health`
   (voir [`railway.json`](railway.json)). La migration tourne au boot.

> Ne pas exposer la base directement : les apps métier passent **toujours** par
> cette API, qui reste la seule source de vérité.
