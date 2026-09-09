# Beneficiários

`res.beneficiary` e os modelos que lhe estão pendurados: `res.delivery.route`, as linhas do agregado
(`res.income.line`, `res.expense.line`, `res.nutritional.line`, `res.need.line`, `res.skill.line`) e
as tabelas de referência que umas e outras usam. `res.support.partner` aparece aqui só no que toca
às duas ligações da ficha; o modelo está em [`parceiros-apoio.md`](parceiros-apoio.md). Índice e
convenções transversais em [`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> _Center_, quem trabalha no Odoo vê _Núcleo_. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## Antes de tudo: este modelo não se lê como os outros

**`res.beneficiary` devolve zero registos a quem não puser `allowed_company_ids` no contexto — sem
erro nenhum.** Não é um modelo vazio: são 11 786 registos, dos quais 6 233 ativos.

Quem filtra é o **`search()` que o módulo redefine** em `refood/models/res_beneficiary.py`, e não a
regra de registo. A distinção interessa, porque muda o que se pode esperar dos outros modelos:

- O modelo tem três `ir.rule` de leitura, e a global é
  `['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]`. **Não é ela.** Um
  `read_group` sem contexto nenhum devolve os 11 786 registos, e o `read_group` passa pela regra
  mas não pelo `search`. O `res.support.partner` tem a **mesma** regra global e responde igual com e
  sem contexto (ver [`parceiros-apoio.md`](parceiros-apoio.md)).
- O que fica de fora é o `search` — e portanto o `search_read` e o `search_count`, que passam por
  ele. Um `read` de ids conhecidos devolve as fichas na mesma.

O que o `search` lê são as **empresas ativas no contexto do pedido**, não as empresas a que o
utilizador tem acesso. São dois âmbitos diferentes:

- **O que o utilizador pode ver** — `res.users.company_ids`, a permissão, que não muda de pedido
  para pedido. O utilizador de integração tem 84 das 87 empresas.
- **O que está escolhido neste pedido** — `allowed_company_ids` no contexto, que é o seletor de
  empresas do Odoo. Só aceita empresas da lista anterior, e é este que conta.

Medido em staging, com esse utilizador de 84 empresas e a empresa por omissão sem beneficiários:

| `allowed_company_ids` enviado                | Registos      |
| -------------------------------------------- | ------------- |
| ausente                                      | **0**         |
| `[]`                                         | **0**         |
| a empresa por omissão do utilizador, sozinha | 2             |
| as 84                                        | 11 786        |
| uma única empresa com dados                  | 1 541         |
| as 84 mais uma que não está nas 84           | `AccessError` |

**Sem `allowed_company_ids` o Odoo não cai na empresa por omissão do utilizador** — se caísse, o
primeiro caso dava 2 como o terceiro. O conjunto de empresas ativas fica vazio, e o filtro não deixa
passar nada. Não é "vê só o seu núcleo": é vê zero.

Os dois modos de falhar são diferentes e ambos enganam:

- **Sem `allowed_company_ids`** — resposta HTTP 200, lista vazia, sem aviso. Parece uma base sem
  beneficiários.
- **Com um `company_id` a que o utilizador não tem acesso** — `AccessError`, _Access to unauthorized
  or invalid companies_, que o `packages/odoo` converte em `OdooAuthError`. Basta um id fora da
  permissão na lista para rebentar o pedido todo, mesmo que os outros 84 estejam certos.

**Morde no `search`, não no `read` nem no `read_group`.** Quem já tem o id lê a ficha sem contexto
nenhum, e uma contagem por `read_group` dá o total certo. Quem procura é que não encontra nada — e
por isso o mesmo código pode funcionar num sítio e falhar noutro.

E **isto não é geral da base**: `hr.employee` e `resource.calendar` devolvem exatamente os mesmos
números com e sem contexto, e o `res.support.partner` também. É deste modelo, e dos outros que
redefinam o `search` — como o `res.nutritional.line`, mais abaixo, que o faz ao contrário. Só se
descobrem um a um.

Para as apps isto é o comportamento certo e já é o que a TV faz — âmbito no domínio **e**
`allowed_company_ids` no contexto. Para o `scripts/explorar.ts` não é: o script não mete contexto
nenhum, por isso **mostra este modelo como se estivesse vazio**. Quem levantar `res.beneficiary`,
ou qualquer modelo que redefina o `search`, tem de o fazer por outro caminho.

---

## `res.beneficiary` — a ficha do beneficiário

Modelo **inteiramente da Refood**: dos 127 campos, 119 vêm do módulo `refood` e os restantes de
`refood_pos`, `refood_survey` e `refood_custom_tags`. Não há nada de standard por baixo — ao
contrário do voluntário, que é um `hr.employee` (ver [`voluntarios.md`](voluntarios.md)).

Só dois campos são obrigatórios: `name` e `company_id`. Tudo o resto pode vir vazio, e vem: o
preenchimento real anda entre os 90% e os 0%, conforme o campo.

Em staging (setembro de 2026): **11 786 registos, 6 233 ativos** — quase metade arquivada e fora
das pesquisas por omissão. Espalham-se por **44 das 84 empresas** visíveis; os restantes núcleos não
têm nenhum. A criação concentra-se em 2024 (5 675) e 2025 (4 565).

### Identidade

| Campo             | Tipo                     | Notas                                                                                    |
| ----------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `name`            | char                     | **Obrigatório**                                                                          |
| `number`          | char                     | O código da ficha: `sequence_prefix` + `sequence_number` a seis dígitos. **Não é único** |
| `sequence_prefix` | char                     | `PT` + as três letras do núcleo + `_BF`                                                  |
| `sequence_number` | integer                  | Contador dentro do prefixo                                                               |
| `company_id`      | many2one → `res.company` | **Obrigatório**; o núcleo                                                                |
| `partner_id`      | many2one → `res.partner` | Espelho no `res.partner`, quando existe                                                  | Ver o aviso a seguir |
| `active`          | boolean                  | Arquivamento                                                                             |

**O `company_id` está aqui e não no espelho.** Na ficha é obrigatório; no `res.partner` é opcional,
e **50 dos 3 853 espelhos de beneficiários têm-no vazio** — vazio quer dizer "contacto partilhado",
e a `ir.rule` do Odoo deixa-o passar de propósito. Uma consulta ao `res.partner` com
`['company_id', '=', empresa]` descarta-os em silêncio. Para ligar uma `pos.order` de Entregas ao
beneficiário, **entrar pelo `partner_id` da ficha**, não sair do `partner_id` da encomenda. Do lado
das fontes o mesmo defeito valia 47 em 68 num núcleo — ver
[`fontes-alimento.md`](fontes-alimento.md) e a convenção transversal no índice.

**E entrar pela ficha escolhe o universo.** Uma `pos.order` de Entregas aponta para beneficiários
**e para parceiros de apoio** — 367 e 19 parceiros distintos. Sair do `partner_id` da encomenda vê os
dois; entrar pelo `partner_id` da `res.beneficiary` vê só os BF, e as encomendas de PA deixam de
casar com nada. Para o painel da TV é o que se quer, e era já o efeito do caminho antigo — o espelho
de um parceiro de apoio tem o `beneficiary_id` vazio e a encomenda caía na mesma. Mas é agora uma
escolha implícita no modelo por onde se entra, e não um filtro visível, por isso fica escrita.

**Mostrar BF e PA na mesma grelha não é acrescentar uma leitura.** Cada cartão previsto nasce de uma
`res.delivery.route`, e é dela que vêm o dia e o turno; **os parceiros de apoio não têm rotas.**
Juntá-los é a grelha passar a ter **duas origens**, com o dia e o turno a deixarem de vir do mesmo
sítio — decisão de desenho do ecrã, não uma consulta a mais. Ver
[`parceiros-apoio.md`](parceiros-apoio.md).

> **Feito, em setembro de 2026, e a decisão foi a segunda origem.** O painel de entregas mostra os
> **extras**: encomendas do dia cujo parceiro não é destino de rota nenhuma desse dia — a um
> beneficiário sem rota hoje, ou a um parceiro de apoio, que nunca tem. Ganham cartão no fim da
> grelha, sem hora, e os quilos entram no total do turno.
>
> O que o modelo não dá, e teve de ser decidido: **uma `pos.order` não tem turno** — o extra é
> atribuído ao turno mais tardio que já tinha começado quando foi registado —, e **a comparação é
> contra as rotas do dia inteiro**, nunca contra o turno visível, ou os mesmos quilos apareciam em
> dois cabeçalhos do mesmo dia. Ver `apps/tv/src/entregas.ts` e
> [`../arquitetura.md`](../arquitetura.md).
>
> A leitura por `id` (rotas do dia) e por `partner_id` (parceiros das encomendas) faz-se numa
> consulta só, com um `|` no domínio, e pede seis campos: `partner_id`, `number`, `active` e as três
> contagens do agregado. **Nada de `name`.**

O formato é o mesmo dos voluntários — a numeração descrita em
[`voluntarios.md`](voluntarios.md#identidade-e-nome), aqui com o sufixo `_BF` — e o prefixo bate
certo com o `center_prefix` do núcleo (ver [`nucleos.md`](nucleos.md)) em 11 292 dos 11 297 que têm
prefixo.

**Mas o `number` identifica o agregado familiar, não a pessoa.** É a diferença que mais dá para o
torto entre este modelo e o `hr.employee`, onde o `barcode` é único por ficha.

O beneficiário é **um registo**; os restantes elementos da casa são **subcontactos** — fichas
próprias, penduradas nele pelo `parent_id` —, e ficam com o **mesmo número**. O agregado é o
principal mais os seus subcontactos. Em números:

- 11 297 fichas têm `number`, mas só **5 657 números distintos**.
- **5 617 dos 5 622 dependentes com número têm exatamente o número do titular.**
- Há grupos de até **15 fichas com o mesmo `number`**, e em 1 332 desses grupos há mais do que uma
  ficha ativa. A repetição nunca atravessa núcleos: todos os registos com o mesmo número estão na
  mesma empresa.

Procurar um beneficiário por `number` devolve, portanto, uma casa inteira. Para identificar uma
pessoa é preciso o `id`.

Duas sujidades a contar com, ambas confirmadas em staging: **489 fichas não têm `number` nenhum**
(488 delas são dependentes), e **5 têm um caráter de tabulação à cabeça do prefixo**, que passa
também para o `number` — um `=` exato falha nessas sem dar sinal.

### Agregado familiar

`parent_id` e `child_ids` ligam os membros da casa: 6 110 fichas apontam a um titular e 5 676 não
apontam a ninguém. São 2 502 titulares com dependentes, o maior com 14, e a mediana em 2.

A árvore é rasa mas **não é garantidamente de dois níveis**: há 7 fichas cujo titular tem, por sua
vez, titular. Nenhum dependente está num núcleo diferente do seu titular. Há 16 dependentes ativos
pendurados num titular arquivado — um agregado não se arquiva em bloco.

### A composição do agregado: `adult_count`, `child_count`, `beneficiary_count`

São estes os campos que contam hoje, e são **armazenados** — ao contrário do `beneficiary_type`,
que é a abordagem antiga (ver abaixo):

| Campo               | O que é                                              |
| ------------------- | ---------------------------------------------------- |
| `adult_count`       | Adultos do agregado — 18 anos ou mais                |
| `child_count`       | Crianças do agregado — **até aos 18 anos**           |
| `beneficiary_count` | Total de elementos: o principal mais os subcontactos |

Não são calculados na leitura. São escritos em dois momentos: **quando muda uma data de
nascimento**, e por uma **ação de servidor diária**. E — isto é o que mais importa a quem os lê —
essa manutenção **só corre em beneficiários ativos e com entregas definidas** (`delivery_ids`).
A regra do negócio por trás: um beneficiário sem entregas ainda não está integrado.

Fora desse conjunto os valores existem à mesma, mas são o que ficou da última vez. Estão
preenchidos em 4 062, 2 881 e 5 865 fichas das 11 786 — muito para lá dos 1 961 registos com
entregas.

Medido em staging, sobre os **1 620 titulares ativos com entregas**, que é o grupo que a ação
mantém:

- `adult_count + child_count == beneficiary_count` em **todos**, sem exceção. A soma é coerente.
- `beneficiary_count` igual ao número real de elementos (principal + subcontactos ativos) em
  **1 256**. Em 152 conta menos do que os subcontactos registados, em 5 conta mais, e em **207 está
  a zero**.
- A fronteira entre criança e adulto são os **18 anos**, confirmado com a Refood em setembro de 2026. Onde o total bate certo, a divisão observada corresponde a esse corte em 1 175 dos 1 256 —
  as restantes são contagens que ficaram para trás, não outra regra.

Ou seja: **a soma é de confiança, o total pode não corresponder ao número de fichas.** Quem quiser
o número de registos do agregado conta-os pelo `parent_id`; quem quiser a composição declarada lê
estes campos. São coisas diferentes e divergem em cerca de um quinto dos casos.

Os três campos também aparecem preenchidos em subcontactos (3 525 dos 6 110), e aí **não são os do
agregado**: só 45 têm o mesmo valor do respetivo titular. **Ler as contagens sempre pela ficha
principal.**

### `beneficiary_type` — a abordagem antiga

`beneficiary_type` (`baby`, `child`, `teen`, `adult`, `elderly`) é **calculado e não armazenado**:
sai do `birthday_date` e está vazio exatamente nas 1 918 fichas sem data de nascimento — nem uma a
mais, nem uma a menos. As faixas observadas são `baby` até ao primeiro ano, `child` 1–14, `teen`
15–17, `adult` 17–64, `elderly` 65 ou mais.

**Já não é o que se usa** — foi substituído pelas três contagens acima — e não se sabe se ainda
está atualizado. Fica documentado porque continua no modelo e continua a devolver valores a quem o
peça, o que é precisamente o risco. Nem serve para filtrar ou ordenar num `search_read`, por não
ser armazenado.

Há datas de nascimento fora de qualquer intervalo plausível — no futuro, e no primeiro milénio —,
que arrastam o tipo com elas. É erro de introdução, não de cálculo, mas quem contar por faixa
etária apanha-o.

### Entregas e turnos

| Campo                  | Tipo                            | Armazenado | Notas                                          |
| ---------------------- | ------------------------------- | ---------- | ---------------------------------------------- |
| `delivery_ids`         | one2many → `res.delivery.route` | sim        | As rotas de entrega da ficha                   |
| `shifts`               | many2many → `resource.calendar` | **não**    | Os turnos, derivados das rotas                 |
| `closest_shift`        | char                            | **não**    | Texto do turno mais próximo, ou `'N/A'`        |
| `closest_initial_hour` | char                            | **não**    | Hora desse turno como `'HH:MM:SS'`, ou `'N/A'` |
| `initial_hour`         | char                            | sim        | Hora como `'HH:MM:SS'`, ou `'N/A'`             |

`shifts` acompanha o `delivery_ids` registo a registo — mesmas 1 961 fichas, mesmo número de linhas
em todas as 11 786 —, o que o torna uma leitura das rotas e não um vínculo próprio. O ligado a
turnos é a ficha do titular: dos 1 961 com turnos, só 2 são dependentes.

`closest_shift` está calculado no momento da leitura e vem `'N/A'` em 11 204 das fichas; 1 379 têm
turnos e ainda assim `'N/A'`. **As horas aqui são strings `'HH:MM:SS'`**, não os floats das linhas
de horário do `resource.calendar` (ver [`turnos.md`](turnos.md)) nem datetimes UTC. O valor "sem
hora" é a string `'N/A'`, não `false` — a convenção transversal do `false` não se aplica a estes
três campos.

### Dados pessoais e RGPD

Esta é a ficha com dados pessoais mais sensíveis da base, e vale a pena dizer quais existem
justamente para que se saiba o que não sai daqui: `niss`, `identification_number` e o seu
`identification_type_id` e `validity`, `vat`, `birthday_date`, `nationality`, `gender`, morada
completa, `phone`, `mobile`, `email`, `profession`, `marital_status_id`, `education_id`,
`professional_situation_id`, além das linhas de rendimento, despesa, necessidades, avaliação
nutricional e competências (`income_line_ids`, `expense_line_ids`, `need_line_ids`,
`nutritional_line_ids`, `skill_line_ids`) e dos campos de comentário em HTML.

Três booleanos de consentimento — `privacy_policy`, `rgpd_data_policy` e `rgpd_beneficiary_rights` —
estão preenchidos em cerca de 2 700 fichas de 11 786. Num boolean, `false` é um valor legítimo: o
que não se pode é ler ausência de consentimento como consentimento, nem o contrário.

Nada disto entra neste documento em forma de valor, e não deve entrar em nenhum outro: documenta-se
que o campo existe.

### Campos vazios em toda a base

`date`, `title`, `lang`, `support_partner_ids`, `comment` e `website` estão a zero nos 11 786
registos — activos e arquivados. `date_localization` tem 4, `refood_tag_ids` 2 e `need_line_ids` 14.
Estão no modelo, não estão em uso.

**Vazio não é livre.** Um campo destes é a tentação óbvia para guardar uma coisa nova sem pedir nada
ao parceiro que gere o Odoo, e não é para isso que serve: nada o impede de passar a ser preenchido
por um módulo, por uma importação ou por alguém a quem a vista o apareça, e nada na base diria que
aquele `website` afinal queria dizer outra coisa. O estado que o Odoo não modela vive no D1 — ver o
[`CLAUDE.md`](../../CLAUDE.md) da raiz.

---

## `res.delivery.route` — as entregas

O modelo que decide se um beneficiário está integrado, e o que liga a ficha aos turnos. São 3 247
rotas, de 1 961 beneficiários — em média 1,66 por ficha, no máximo 7.

| Campo                                               | Tipo      | Relação                  | Notas                                                                           |
| --------------------------------------------------- | --------- | ------------------------ | ------------------------------------------------------------------------------- |
| `resource_calendar_id`                              | many2one  | `resource.calendar`      | **Obrigatório**; o turno da entrega                                             |
| `beneficiary_id`                                    | many2one  | `res.beneficiary`        | A ficha. Preenchido nas 3 247                                                   |
| `week_day`                                          | selection |                          | `'0'`–`'6'`, segunda a domingo, **como string**                                 |
| `start_date`                                        | datetime  |                          | **Obrigatório**; UTC, como todos os datetimes                                   |
| `start_hour` / `end_hour`                           | float     |                          | **Obrigatórios**; horas decimais — `9.5` são 9:30. **Indicativas** — ver abaixo |
| `company_id`                                        | many2one  | `res.company`            | O núcleo                                                                        |
| `is_route_ongoing`                                  | boolean   |                          | Armazenado e escrito à mão. **Obsoleto — não filtrar por ele**, ver abaixo      |
| `adult_count` / `child_count` / `beneficiary_count` | integer   |                          | Cópia das contagens da ficha                                                    |
| `related_beneficiary_number`                        | char      |                          | O `number` do beneficiário, copiado                                             |
| `related_beneficiary_food_type`                     | many2many | `res.food.type`          | Calculado, não armazenado                                                       |
| `related_beneficiary_food_delivery_type`            | many2one  | `res.delivery.food.type` | Calculado, não armazenado                                                       |
| `related_beneficiary_notes`                         | html      |                          | Calculado, não armazenado                                                       |

O que vale a pena saber antes de lhe tocar:

- **O `is_route_ongoing` está obsoleto e não serve de filtro.** É um boolean **armazenado e escrito
  à mão** — `store: true`, `compute: false`, módulo `refood` —, e marca-se a `false` quando se cria
  uma rota com data de início futura: das **391 a `false`, 390 tinham o `start_date` depois da data
  de criação**. Só que **nunca é corrigido**. Medido em setembro de 2026: **390 dessas 391 já
  arrancaram** — o `start_date` está no passado — e continuam marcadas como não decorrentes, mesmo
  as 218 que foram editadas depois. E não é sequer consistente: há rotas criadas com início futuro
  que ficaram a `true`.

  Quem filtrar por ele esconde 390 famílias que já são servidas. **Usar o `start_date` em vez dele**:
  faz o mesmo trabalho útil — excluir o que ainda não arrancou — com um dado que não envelhece.

  As `false` aparecem entre **dezembro de 2024 e novembro de 2025**, e há uma de setembro de 2026;
  não há nenhuma antes de 2024-12-02. O aparente fim em novembro de 2025 não é uma mudança de
  prática: é a tabela inteira a ficar quieta, porque as `true` param na mesma altura.

- **A hora de uma entrega é indicativa, e raramente cumprida.** Confirmado com a equipa em setembro
  de 2026: as famílias chegam por sua conta, e o `start_hour` é uma referência de organização, não
  um compromisso. Consequências para quem construir por cima: **não ordenar uma listagem pela hora**
  — a ordem que a operação usa é o número da ficha —, e **não contar atrasos nem alarmar** comparando
  o `start_hour` com o relógio, que daria avisos sobre uma hora que ninguém prometeu. É o contrário
  do `hour` das recolhas, que é a ordem real do trabalho (ver [`fontes-alimento.md`](fontes-alimento.md)).
- **Não há data de fim.** Uma rota vale a partir do `start_date` e não tem contraparte: quando a
  entrega termina, o registo é **apagado**. Quem filtrar por data precisa só do limite inferior — e
  compara-o com **o dia que está a mostrar**, não com hoje, porque uma rota combinada para começar
  daqui a três dias não deve aparecer hoje mas deve aparecer nesse dia. Confirmado com a equipa em
  setembro de 2026.
- **O `start_date` está a `00:00:00` nas 3 252 rotas.** É uma data escrita num campo datetime, e é
  o que permite comparar a data em UTC sem passar pelo fuso. Se algum dia aparecer com hora, a
  comparação passa a precisar da janela de Lisboa.
- **`week_day` e as horas seguem a convenção do `resource.calendar.attendance`**, não a dos
  datetimes: dia da semana como string com `'0'` na segunda-feira, e horas em float decimal sem
  fuso próprio (ver [`turnos.md`](turnos.md)). O `start_date`, esse, é um datetime UTC normal.
- **As três contagens são uma cópia**, não um cálculo próprio: batem certo com as da ficha nas
  3 247 rotas, incluindo as 943 em que estão a zero. Não são uma segunda fonte, são a mesma.
- **O `related_beneficiary_number` é o `number` da ficha**, com tudo o que isso implica — identifica
  o agregado, não a pessoa, e arrasta a mesma sujidade.
- **Só 185 calendários distintos** aparecem nas rotas, de 1 249 que existem. As entregas usam turnos
  a sério, não os calendários herdados.
- O `start_date` mais antigo é do ano 2000 e há um no futuro; a massa está em 2024 e 2025.

O campo `shifts` do beneficiário é uma leitura destas rotas: 3 247 ligações, exatamente o número de
rotas.

---

## As linhas do agregado

Cinco modelos com a mesma forma — `res.income.line`, `res.expense.line`, `res.nutritional.line`,
`res.need.line` e `res.skill.line`. Todos penduram na ficha por **dois** campos, e é aí que está o
que interessa:

- **`beneficiary_id`** — a ficha a que a linha pertence, sempre a **principal** do agregado.
- **`beneficiary_child_id`** — o elemento concreto a que a linha diz respeito: ou a própria ficha
  principal, ou um dos seus subcontactos.

Verificado nas 8 580 linhas das cinco tabelas: `beneficiary_child_id` ou é igual ao
`beneficiary_id`, ou é um subcontacto dele. **Nunca aponta para fora do agregado.** No
`res.expense.line`, por exemplo, 5 479 das 6 164 linhas são do próprio titular e 683 de um
subcontacto.

Consequência: para reunir as linhas de uma casa filtra-se por `beneficiary_id`; para as de uma
pessoa, por `beneficiary_child_id`. Filtrar pelo campo errado dá o agregado inteiro quando se queria
uma pessoa, sem erro nenhum pelo meio.

| Modelo                 | Linhas | O que tem além dos dois vínculos                                                                                     |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `res.expense.line`     | 6 164  | `expense_type_id` → `res.expense.type` (**obrigatório**), `value` (monetary, **obrigatório**), `user_relatedness_id` |
| `res.income.line`      | 2 100  | `income_type_id` → `res.income.type` (**obrigatório**), `value` (monetary, **obrigatório**), `user_relatedness_id`   |
| `res.nutritional.line` | 273    | `allergy_type` (char, **obrigatório**), `company_id` calculado                                                       |
| `res.skill.line`       | 23     | `skill_id` → many2many `res.skill.type` (**obrigatório**)                                                            |
| `res.need.line`        | 20     | `need` (char, **obrigatório**)                                                                                       |

O `currency_id` das linhas de rendimento e despesa é **calculado e não armazenado** — os totais
`total_income`, `total_expense` e `total_balance` da ficha também.

### `res.nutritional.line` avaria com o contexto

Este modelo está partido, e de uma maneira que engana ao contrário de tudo o resto neste ficheiro:

- `search_count` **com** `allowed_company_ids` no contexto rebenta com
  `'int' object has no attribute 'filtered'` — um erro do módulo, não da chamada.
- `search_read` funciona nos dois casos, mas devolve **291 linhas sem contexto e 273 com**. As 18 a
  mais aparecem sem contexto, e nenhuma linha aparece só com ele.

É exatamente o inverso do `res.beneficiary`, onde o contexto é que destranca os registos. Aqui o
contexto tira registos e parte a contagem. Contar linhas nutricionais fiavelmente exige medir os
dois caminhos e saber qual se quer — e é o único destes modelos onde isso acontece.

---

## As tabelas de referência

Dezoito modelos de lista, todos com a mesma forma mínima: `name` char obrigatório, `id`,
`display_name` calculado e os quatro campos de auditoria. **Nenhum tem `company_id` nem `active`.**

São, portanto, **listas globais partilhadas por todos os núcleos** — não há uma lista de profissões
por núcleo — e **não se arquivam**: uma entrada que deixe de servir tem de ser apagada ou fica lá.

| Modelo                              | Entradas | Usado em                                                    |
| ----------------------------------- | -------- | ----------------------------------------------------------- |
| `res.skill.type`                    | 25       | `res.skill.line.skill_id`                                   |
| `res.cooking.conditions`            | 13       | `cooking_conditions`                                        |
| `res.means.of.transport`            | 13       | `means_of_transport`                                        |
| `res.degree.relatedness`            | 12       | `user_relatedness_id`, e nas linhas de rendimento e despesa |
| `res.food.type`                     | 11       | `food_type_id`                                              |
| `res.expense.type`                  | 11       | `res.expense.line.expense_type_id`                          |
| `res.meal.support.type`             | 8        | `meal_support_type`                                         |
| `res.professional.situation`        | 7        | `professional_situation_id`                                 |
| `res.education.type`                | 6        | `education_id`                                              |
| `res.income.type`                   | 6        | `res.income.line.income_type_id`                            |
| `res.marital.status`                | 5        | `marital_status_id`                                         |
| `res.delivery.food.type`            | 5        | `food_delivery_type_id`                                     |
| `res.meal.support.frequency`        | 4        | `meal_support_frequency`                                    |
| `res.food.accommodation.conditions` | 3        | `food_accomodation_conditions`                              |

Duas exceções à forma mínima:

- **`res.identification.type`** (5 entradas) tem também um `code` char obrigatório — é o único destes
  com um código estável, e portanto o único em que se pode escrever uma condição sem depender do
  texto do `name`.
- **`res.support.partner.type`** (6 entradas) tem um boolean `is_social_service`, que separa os
  parceiros que são serviço social dos restantes.

Em todos os outros, **a única chave é o `name`**. Qualquer app que precise de reagir a um valor
específico depende do texto — que é editável, traduzível e não tem nada que o proteja.

---

## As duas ligações a `res.support.partner`

Os parceiros de apoio são ficha própria, em [`parceiros-apoio.md`](parceiros-apoio.md). Aqui
interessam só os dois campos da ficha do beneficiário que lhe apontam, porque são papéis diferentes:

- **`support_partner_id`** — o parceiro que **acompanha** o beneficiário. Tipicamente a assistente
  social.
- **`signaling_entity_partner_id`** — a entidade que **sinalizou** o beneficiário, ou seja, quem o
  encaminhou para a Refood.

A base trata-os mesmo como papéis distintos: dos 352 beneficiários com os dois campos preenchidos,
**só 3 têm o mesmo parceiro nos dois**. 349 parceiros aparecem como acompanhamento (em 621 fichas) e
195 como entidade sinalizadora (em 795).

### A restrição de Ação Social não está na base

Nos dois campos **só devem poder escolher-se parceiros de apoio cujo `type_support_partner` seja
_Ação Social_**. É restrição da **vista**, como o `shift_manager_id` dos turnos: nada no modelo a
impõe, e os dados não a cumprem.

O tipo em causa é o único dos 6 em `res.support.partner.type` com o boolean **`is_social_service` a
verdadeiro**. Atenção ao procurá-lo: **as etiquetas dos tipos estão em inglês na base** e a desse é
`Entity`, não _Ação Social_. Quem filtrar pelo texto do `name` não encontra o que procura; o campo
de confiança é o boolean.

O que lá está de facto:

|                               | `support_partner_id` | `signaling_entity_partner_id` |
| ----------------------------- | -------------------- | ----------------------------- |
| Fichas com o campo preenchido | 621                  | 795                           |
| Parceiros distintos usados    | 349                  | 195                           |
| Desses, de tipo Ação Social   | 103                  | 35                            |
| De outro tipo                 | 2                    | 1                             |
| **Sem tipo nenhum**           | **244**              | **159**                       |

Em fichas: **265 das 621** apontam a um parceiro sem tipo, e 2 a um parceiro de outro tipo. A causa
está a montante — **651 dos 1 014 parceiros de apoio não têm `type_support_partner` preenchido** —,
e é dados antigos, anteriores à regra, não corrupção.

Consequência para quem lê: **não se pode assumir que o parceiro apontado por estes campos é de Ação
Social**, nem usar o tipo como filtro sem perder mais de metade dos casos. Quem quiser mesmo só os
de Ação Social tem de aceitar que deixa de fora as fichas ainda por classificar, e sabê-lo.

---

## Consequências para quem lê estes dados

- **`allowed_company_ids` no contexto não é otimização, é condição de leitura.** Sem ele o modelo
  responde vazio.
- **O `number` não identifica uma pessoa.** Identifica a casa. Uma pesquisa por número devolve o
  agregado, e mais de metade dos registos partilha o número com outro.
- **`beneficiary_type`, `shifts`, `closest_shift`, `closest_initial_hour`, `total_income`,
  `total_expense`, `total_balance`, `currency_id`, `surveys_count` e `certifications_count` são
  calculados e não armazenados** — lêem-se, mas não entram em domínio nem em ordenação.
- **As contagens do agregado só são mantidas em fichas ativas com entregas.** Fora desse conjunto
  são um valor antigo, não uma leitura da base. E em subcontactos não são as do agregado.
- **Quase metade das fichas está arquivada** e `active = false` exclui-as por omissão. 4 824
  arquivadas não têm `termination_date`, e 162 ativas têm — o arquivamento e a data de saída são
  independentes, e nenhum dos dois é o estado do beneficiário.
- **Só 5 671 fichas têm `partner_id`**, e a correspondência é de um para um: são os mesmos 5 671
  `res.partner` cujo `beneficiary_id` aponta de volta. Metade dos beneficiários não tem contacto
  espelhado, portanto **partir do `res.partner` para chegar aos beneficiários perde metade deles** —
  e os que lá estão levam só o número, por desenho: o `res.partner` é transversal ao Odoo e o nome
  do beneficiário não podia aparecer onde não se controla. O mesmo padrão, mais bem medido, está em
  [`parceiros-apoio.md`](parceiros-apoio.md).
- **Só 44 dos 84 núcleos têm beneficiários.** Um núcleo sem nenhum não é anomalia.

---

## Pontos em aberto

- **Se o `is_route_ongoing` ainda serve para alguma coisa.** Está medido acima que é uma marca de
  criação que ninguém corrige, e as apps deixaram de a ler. Falta perguntar ao parceiro se o campo
  tem algum uso do lado do Odoo — uma vista, um relatório — ou se é resto que se pode ignorar de vez.
  **A pergunta vale para os dois modelos onde o campo existe**: aqui e na `res.collection.route`
  (ver [`fontes-alimento.md`](fontes-alimento.md)), onde 46 de 46 estão obsoletas.
- **O que mais faz o `search()` redefinido** em `refood/models/res_beneficiary.py`. Sabe-se que
  filtra pelas empresas ativas no contexto — é a medição acima —, não se sabe o que mais acrescenta.
  Vale a pena ler o módulo antes de assentar qualquer domínio complicado.
- **Não se sabe se a ação de servidor diária corre em staging.** Os dados sugerem que não: nos
  agregados cujo `beneficiary_count` bate certo, a divisão adulto/criança encaixa melhor no corte
  dos 18 anos avaliado a **meados de 2025** (1 240 em 1 256) do que a hoje (1 175), e se a ação
  corresse todos os dias o melhor encaixe seria hoje. O sinal é fraco — 65 agregados de diferença —
  mas aponta todo para o mesmo lado, e os 207 titulares ativos com entregas e `beneficiary_count` a
  zero acompanham-no. **Consequência para quem levanta dados aqui:** o desfasamento observado em
  staging pode ser da base de teste e não do modelo, e não se deve concluir daqui nada sobre
  produção.
- **O que distingue uma ficha ativa de um beneficiário a receber apoio.** `active`,
  `termination_date` e `admission_date` (esta vazia em 4 129 fichas ativas) não respondem sozinhos.
  As entregas dizem outra coisa ainda: sem `delivery_ids`, o beneficiário não está integrado.
- **`beneficiary_info`, `nut_value_beneficiary`, `income_beneficiary` e `expense_beneficiary`** —
  booleanos sem ajuda no Odoo, os três últimos calculados. Significado por confirmar com a Refood.
- **`initial_hour` armazenado ao lado de `closest_initial_hour` calculado** — qual é o que vale, e
  para quê.
- **O `search_count` do `res.nutritional.line` rebenta** quando o pedido leva `allowed_company_ids`.
  É um erro do módulo — o `search` faz `.filtered` sobre o resultado, que com `count=True` é um
  inteiro. Vale a pena reportar; até lá, contar linhas nutricionais pelo `search_read`.
- **Porque é que 651 dos 1 014 parceiros de apoio não têm tipo**, que é o que faz a restrição de
  Ação Social não valer nada nos dados. O modelo está em [`parceiros-apoio.md`](parceiros-apoio.md).
