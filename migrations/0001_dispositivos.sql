-- 0001_dispositivos: dispositivos emparelhados (televisores) e códigos de emparelhamento.

CREATE TABLE dispositivos (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  company_id  INTEGER NOT NULL,
  nome        TEXT,
  criado_em   TEXT NOT NULL,
  visto_em    TEXT,
  versao      TEXT,
  revogado    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_dispositivos_empresa ON dispositivos (company_id) WHERE revogado = 0;

CREATE TABLE emparelhamentos (
  codigo      TEXT PRIMARY KEY,
  expira_em   TEXT NOT NULL,
  company_id  INTEGER,
  token_hash  TEXT,
  confirmado  INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL
);
