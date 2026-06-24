-- Migration initiale : table clients + index de recherche et de dédup.
-- Idempotente : peut être rejouée sans risque (IF NOT EXISTS partout).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- fournit gen_random_uuid()

CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  email       TEXT,
  telephone   TEXT,
  type        TEXT        NOT NULL DEFAULT 'pro',  -- one_shot | pro
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recherche insensible à la casse sur le nom (autocomplete).
CREATE INDEX IF NOT EXISTS idx_clients_nom_lower
  ON clients (lower(nom));

-- Dédup : un email unique (insensible à la casse), uniquement s'il est présent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_email_lower
  ON clients (lower(email)) WHERE email IS NOT NULL;

-- Dédup : un téléphone unique, uniquement s'il est présent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_telephone
  ON clients (telephone) WHERE telephone IS NOT NULL;
