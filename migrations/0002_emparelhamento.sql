-- 0002_emparelhamento: alinha o emparelhamento com o fluxo de posse do segredo.
--
-- O que muda, e porquê:
--   * A prova de identidade da TV passa a ser o segredo que ela gera localmente.
--     O emparelhamento guarda `segredo_hash` (SHA-256 do segredo) e nunca o segredo.
--   * O código de 6 dígitos deixa de ser chave primária. É público e descartável;
--     serve para a sede identificar o ecrã, não para autenticar. A unicidade passa
--     a ser exigida apenas enquanto o emparelhamento ainda pode ser recolhido.
--   * `confirmado` (dois estados) dá lugar a `estado`, com os quatro do fluxo.
--   * O `token_hash` sai do emparelhamento: o token nasce no momento da recolha,
--     depois de a TV provar posse do segredo, e vive só na linha de `dispositivos`.
--   * `dispositivos.nome` desaparece. A etiqueta de monitorização é núcleo + ordinal
--     de emparelhamento na empresa: o núcleo resolve-se contra o Odoo na altura de
--     mostrar. No D1 não entra texto livre.
--
-- A tabela é recriada em vez de alterada porque está vazia (staging: 0 linhas;
-- produção ainda não tem a 0001 aplicada) e porque `ALTER TABLE` do SQLite não
-- permite acrescentar colunas NOT NULL sem defeito nem remover as que sobram.

DROP TABLE emparelhamentos;

CREATE TABLE emparelhamentos (
  -- Identificador interno e opaco. O código, sendo público e reutilizável, não serve de chave.
  id             TEXT PRIMARY KEY,
  -- Código de 6 dígitos mostrado no ecrã. Público: identifica, não autentica.
  codigo         TEXT NOT NULL,
  -- SHA-256 do segredo de 32 bytes gerado pela TV. O segredo em claro nunca entra aqui.
  segredo_hash   TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (estado IN ('pendente', 'aprovado', 'recolhido', 'expirado')),
  -- Núcleo atribuído pela sede na aprovação. Copiado para `dispositivos` na recolha.
  company_id     INTEGER,
  -- Preenchido na recolha, com o dispositivo criado nesse momento.
  dispositivo_id TEXT REFERENCES dispositivos (id),
  criado_em      TEXT NOT NULL,
  expira_em      TEXT NOT NULL,
  aprovado_em    TEXT,
  recolhido_em   TEXT,
  -- Um emparelhamento aprovado tem sempre núcleo; um recolhido tem também dispositivo.
  CHECK (estado <> 'aprovado'  OR company_id IS NOT NULL),
  CHECK (estado <> 'recolhido' OR (company_id IS NOT NULL AND dispositivo_id IS NOT NULL))
);

-- Unicidade do código apenas entre os emparelhamentos que ainda podem ser recolhidos.
-- O predicado é determinístico de propósito: o SQLite não aceita `datetime('now')` num
-- índice parcial, por isso a caducidade é trabalho do Worker — ao expirar, o estado muda
-- e o código fica outra vez livre. Uma colisão na geração devolve erro de constraint,
-- que a rota trata gerando outro código.
CREATE UNIQUE INDEX idx_emparelhamentos_codigo_vivo
  ON emparelhamentos (codigo)
  WHERE estado IN ('pendente', 'aprovado');

-- Por onde entra o polling da TV: apresenta o segredo, o Worker procura pelo hash.
-- Mesmo predicado do código: uma linha gasta não segura o valor. Uma TV que emparelhe
-- outra vez gera segredo novo, e o hash do emparelhamento anterior — já recolhido ou
-- expirado — não pode fazer falhar esse INSERT.
CREATE UNIQUE INDEX idx_emparelhamentos_segredo_vivo
  ON emparelhamentos (segredo_hash)
  WHERE estado IN ('pendente', 'aprovado');

-- Para a listagem na sede e para a passagem a 'expirado'.
CREATE INDEX idx_emparelhamentos_vivos
  ON emparelhamentos (expira_em)
  WHERE estado IN ('pendente', 'aprovado');

-- Quando e não só se: uma revogação sem data não se audita.
ALTER TABLE dispositivos ADD COLUMN revogado_em TEXT;

-- Sem texto livre no D1. A etiqueta do ecrã constrói-se ao mostrar, a partir do núcleo
-- e da ordem de emparelhamento dentro dele.
ALTER TABLE dispositivos DROP COLUMN nome;
