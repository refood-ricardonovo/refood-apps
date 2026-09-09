-- 0004_presencas_demo: quem entrou na demonstração da PWA, e de que núcleo.
--
-- **Tabela do `apps/app`, e só dele.** Vive nesta pasta porque o livro-razão do D1 é único, não
-- porque a posse seja partilhada — a mesma regra das três tabelas do `apps/tv`.
--
-- **É descartável, como o ecrã que a enche.** Existe para uma apresentação: alguém escreve o NIF,
-- aparece no mural projectado na sala. Sai com o atalho do NIF, no dia em que o login a sério
-- entrar. Ver `apps/app/CLAUDE.md`.
--
-- Nada aqui identifica ninguém por si: dois inteiros e uma data. **Sem nomes, sem NIF, sem email.**
-- Os nomes do mural são lidos ao Odoo a cada pedido e nunca aterram aqui.

CREATE TABLE presencas_demo (
  -- **O `id` da `hr.employee`, e não o `barcode` — é um desvio à regra da raiz, com razão.**
  --
  -- O `CLAUDE.md` da raiz manda referenciar um voluntário pelo `barcode`, porque o `id` é interno
  -- e não é portável entre bases. As duas coisas continuam verdadeiras; o que muda é que aqui não
  -- pesam:
  --
  --   * o mural resolve os nomes com um `read` de `hr.employee` **por id**, portanto guardar o
  --     `barcode` obrigava a uma pesquisa a mais por cada refresh só para voltar ao id;
  --   * esta tabela é esvaziada no fim da demonstração e nunca atravessa bases, que é exactamente
  --     o risco de que a regra protege;
  --   * há fichas activas sem `barcode`, e uma delas não poderia entrar.
  --
  -- Fora desta tabela a regra mantém-se inteira: uma tabela operacional a sério referencia pelo
  -- `barcode`.
  --
  -- PRIMARY KEY, e é isso que faz "não duplicar se já lá estiver" ser um `ON CONFLICT DO NOTHING`
  -- em vez de um ler-depois-escrever com uma corrida pelo meio.
  employee_id INTEGER PRIMARY KEY,

  -- O núcleo, copiado da ficha no momento da entrada. Toda a tabela operacional leva `company_id`:
  -- sem ele não há filtro por núcleo. Aqui é também o que o mural agrupa.
  company_id  INTEGER NOT NULL,

  -- ISO-8601 UTC, como o resto do esquema.
  criado_em   TEXT NOT NULL
);

-- O mural lê por núcleo, e é a única leitura que esta tabela serve.
CREATE INDEX idx_presencas_demo_nucleo ON presencas_demo (company_id);
