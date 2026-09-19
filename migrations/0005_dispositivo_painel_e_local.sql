-- 0005_dispositivo_painel_e_local: o painel com que um ecrã arranca, e onde ele está.
--
-- Duas colunas em `dispositivos`, e a segunda desfaz uma decisão da 0002. A razão de cada uma
-- está por extenso no `apps/tv/CLAUDE.md`; aqui fica o resumo e o que o esquema garante.
--
--   * `painel_inicial` — qual dos painéis o ecrã mostra quando arranca. Num núcleo com dois ecrãs,
--     um fica nas entregas e o outro nas recolhas, em vez de ambos abrirem no mesmo e alguém ter
--     de carregar no comando todas as manhãs. **É o painel inicial, não uma tranca:** o comando
--     continua a alternar, e a escolha de quem está na cozinha não é escrita aqui.
--
--   * `local` — uma etiqueta curta para quem está na sede saber de que ecrã se trata: "Cozinha",
--     "Sala de convívio". Com dois ecrãs no mesmo núcleo, "PT Núcleo Leiria · ecrã 2" não chega.
--
-- **A `nome` saiu na 0002 e isto não a traz de volta.** A `nome` era escrita por quem instalava,
-- ao telefone, sem ver a lista; esta é escrita na sede, por uma de quatro pessoas, com a lista dos
-- ecrãs do núcleo à frente. E não substitui o ordinal: acrescenta-se a ele, que continua a contar
-- sobre as revogadas e continua a ser o identificador estável.
--
-- **O que o esquema garante, e o que não garante.** O `CHECK` limita o comprimento e é uma trava
-- de último recurso — quem valida a sério é a rota do admin, que também recusa quebras de linha e
-- caracteres de controlo. O que nenhum dos dois garante é o *conteúdo*: alguém vai escrever
-- "Cozinha da Dona Maria" e não há coluna que o impeça. É a mesma troca que as notas dos
-- voluntários já fazem, e a mitigação é a mesma: **isto não vai para um televisor.** Ver a secção
-- respectiva do `apps/tv/CLAUDE.md`.
--
-- O `painel_inicial` fica **sem `CHECK`**, de propósito. A lista de painéis há-de crescer, e um
-- `CHECK` transformava "acrescentar um painel" numa migração. Quem valida na escrita é o Worker
-- (`src/paineis.ts`); quem lê tolera um valor que não conheça e cai no painel por omissão, que é o
-- que faz falta durante uma actualização, com televisores em versões diferentes ao mesmo tempo.

ALTER TABLE dispositivos ADD COLUMN painel_inicial TEXT;

ALTER TABLE dispositivos ADD COLUMN local TEXT CHECK (local IS NULL OR (length(local) BETWEEN 1 AND 30));
