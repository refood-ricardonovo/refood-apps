-- 0006_emparelhamento_leva_configuracao: o painel e o local escolhidos já na aprovação.
--
-- A 0005 pôs `painel_inicial` e `local` em `dispositivos`, e a sede escrevia-os depois, na lista
-- de ecrãs. Na prática o momento é outro: quem aprova está ao telefone com quem instala, sabe
-- naquele instante que aquele ecrã é o da cozinha e que abre nas recolhas, e não há razão para o
-- obrigar a voltar à lista a seguir para dizer o que já sabia.
--
-- As duas colunas passam a existir também no emparelhamento, e a **recolha copia-as** para o
-- dispositivo — exactamente como já copia o `company_id`.
--
-- **Isto não toca na escrita atómica da recolha, e é por isso que é seguro.** O que lá está é um
-- `INSERT ... SELECT` condicionado ao mesmo `WHERE` do `UPDATE`, dentro de um `batch`: acrescentar
-- duas colunas à lista do `SELECT` é a mesma forma, sem leitura antes da escrita e sem mudar nada
-- na corrida. O `CLAUDE.md` desta app diz para não reescrever aquilo como ler-e-depois-escrever;
-- continua a não estar reescrito.
--
-- Um emparelhamento aprovado e nunca recolhido leva as colunas consigo para o caducamento, e não
-- faz mal a ninguém: a linha morre com elas.
--
-- Os mesmos limites da 0005 no `local`, pela mesma razão — e o `painel_inicial` continua sem
-- `CHECK`, para acrescentar um painel não ser uma migração.

ALTER TABLE emparelhamentos ADD COLUMN painel_inicial TEXT;

ALTER TABLE emparelhamentos ADD COLUMN local TEXT CHECK (local IS NULL OR (length(local) BETWEEN 1 AND 30));
