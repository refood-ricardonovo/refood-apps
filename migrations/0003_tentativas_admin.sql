-- 0003_tentativas_admin: trava as tentativas falhadas de autenticação da sede.
--
-- São quatro pessoas a partilhar uma palavra-passe. Sem trava, a única defesa de `/api/admin/*` é o
-- comprimento do segredo, e quem o tente adivinhar tem tentativas ilimitadas e silenciosas.
--
-- O estado é técnico e vive no D1, como o resto: nada aqui identifica uma pessoa. A chave **não é o
-- IP** — é o SHA-256 do IP concatenado com o próprio segredo do admin, que dá um balde estável por
-- origem sem guardar a origem. Um IPv4 hasheado sozinho reverte-se por força bruta em segundos; com
-- o segredo pelo meio, não se reverte sem já se ter aquilo que se queria descobrir.

CREATE TABLE tentativas_admin (
  -- SHA-256 de (ip + segredo do admin). Balde de contagem, não identificador de ninguém.
  chave         TEXT PRIMARY KEY,
  falhas        INTEGER NOT NULL DEFAULT 0,
  primeira_em   TEXT NOT NULL,
  ultima_em     TEXT NOT NULL,
  -- Preenchido quando o balde estoura. Enquanto estiver no futuro, nem se compara o segredo.
  bloqueado_ate TEXT
);

-- Para a limpeza dos baldes velhos, que corre no caminho da falha — o único que os cria.
CREATE INDEX idx_tentativas_admin_velhas ON tentativas_admin (ultima_em);
