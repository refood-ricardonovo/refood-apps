# Fontes de alimento

`res.food.source`. Índice e convenções transversais em [`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> *Center*, quem trabalha no Odoo vê *Núcleo*. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## `res.food.source` — a ficha da fonte

O lado de onde vem a comida. A Refood recolhe alimentos que iriam para o lixo e ainda estão em
condições: **as fontes de alimento são quem os dá** — restaurantes, superfícies, produtores. Do
outro lado estão os beneficiários e os parceiros que os recebem
([`parceiros-apoio.md`](parceiros-apoio.md)).

É a quarta das fichas da operação, a par de voluntários, beneficiários e parceiros de apoio. Modelo
**inteiramente da Refood**: 76 campos do módulo `refood` e 1 do `refood_custom_tags`. Só `name` e
`company_id` são obrigatórios.

São **1 124 registos, 886 ativos** — mas atenção, porque **nem todos são fontes**: 125 deles são
**contactos** de fontes, guardados na mesma tabela (ver [as duas hierarquias](#duas-hierarquias-e-não-é-a-mesma-coisa)).
Fontes a sério são **999, das quais 762 ativas**.

A criação dá um salto em 2024 (708 das 1 124) — foi quando a maioria dos núcleos as começou a
registar.

### Só se lê com `allowed_company_ids` no contexto

**Este modelo comporta-se como o `res.beneficiary`**: sem `allowed_company_ids` no contexto do
pedido, o `search_read` e o `search_count` devolvem **zero**, HTTP 200, sem aviso nenhum. Com o
contexto, 1 124.

E, como lá, não é a `ir.rule`: um `read_group` sem contexto devolve os 1 124. É o `search()` que o
módulo redefine. O detalhe da mecânica, e a prova, estão em
[`beneficiarios.md`](beneficiarios.md#antes-de-tudo-este-modelo-não-se-lê-como-os-outros) — aqui
basta saber que **este é o segundo modelo confirmado com o mesmo comportamento**, e que os
parceiros de apoio, com a mesma regra de registo, não o têm.

### O âmbito

**32 dos 87 núcleos têm fontes de alimento.** O maior tem 173, a mediana são 23, e há núcleos com
uma só. São mais núcleos do que os que têm parceiros de apoio (27) e menos do que os que têm
beneficiários (44).

### Identidade e numeração

| Campo             | Tipo                     | Notas                                                |
| ----------------- | ------------------------ | ---------------------------------------------------- |
| `name`            | char                     | **Obrigatório**                                      |
| `number`          | char                     | `sequence_prefix` + `sequence_number` a seis dígitos |
| `sequence_prefix` | char                     | `PT` + as três letras do núcleo + `_FA`              |
| `sequence_number` | integer                  | Contador dentro do prefixo                           |
| `company_id`      | many2one → `res.company` | **Obrigatório**; o núcleo                            |
| `partner_id`      | many2one → `res.partner` | O espelho. Preenchido em 1 110 das 1 124             |
| `active`          | boolean                  | Arquivamento                                         |

Numeração igual à das outras fichas (ver [`voluntarios.md`](voluntarios.md#identidade-e-nome)), com
o sufixo `_FA`, e 32 prefixos distintos para os 32 núcleos.

**999 fichas têm número e o formato está certo nas 999** — não há aqui a sujidade de espaços que o
beneficiário tem. Mas **978 números distintos para 999 fichas: 21 estão repetidos.** Não é a
partilha deliberada do agregado familiar do beneficiário; são colisões. Quem usar o `number` como
chave tem de contar com elas.

**As 125 fichas sem número são exatamente os 125 contactos**, e a correspondência é perfeita nos
dois sentidos: nenhum contacto tem número, nenhuma fonte fica sem ele. Ter `number` é, portanto, um
critério tão bom como o `contact_parent_id` para separar uns dos outros — e ao contrário deste,
funciona também no `res.partner`, onde o nome do espelho é o número.

14 fichas não têm espelho no `res.partner`.

### O espelho no `res.partner`, outra vez só o código

Dos 1 124 registos, 1 110 têm um `res.partner`. E esse contacto é uma casca, como nos parceiros de
apoio: **nenhum tem email, morada ou telefone**, e o `name` é o número da ficha em 985 dos 1 110 —
uma única palavra em 1 006 deles. O nome legível está no `food_source_name` do `res.partner`, e o
`food_source_id` aponta de volta; ambos preenchidos nos 1 110.

É a decisão de privacidade descrita nas convenções do índice: o `res.partner` é transversal a todo
o Odoo e o nome não podia ir para lá. **Não é caminho para chegar a uma fonte de alimento.**

#### E o espelho não sabe de que núcleo é

**99 dos 1 028 espelhos de fontes têm o `company_id` vazio** — e num só núcleo eram **47 em 68**.
No `res.partner` o campo é opcional e o vazio significa "contacto partilhado", não "de nenhuma
empresa"; a `ir.rule` do Odoo deixa-o passar de propósito. Ver a convenção transversal no índice.

Consequência directa, e custou um bug em produção: **para ligar uma `pos.order` de Recolhas à fonte,
entrar pelo `partner_id` da `res.food.source`** — onde o `company_id` é obrigatório — e cruzar com o
`partner_id` da encomenda. O caminho inverso, ler o `res.partner` da encomenda com o âmbito do
núcleo no domínio, devolve menos linhas do que devia sem dar erro nenhum: a fonte fica por recolher
no televisor com a encomenda registada no Odoo.

### Aqui os dados de contacto estão preenchidos

Ao contrário dos parceiros de apoio, a ficha da fonte tem mesmo os dados — e faz sentido, porque
sem morada não há recolha. Nos 1 124 registos, contactos incluídos:

`city` 989, `country_id` 965, `street` 949, `zip` 776, `email` 562, `phone` 531, `mobile` 502,
`state_id` 389, `vat` 338, `image_1920` 324, `website` 77.

Continua a haver núcleos por preencher — é o estado normal —, mas o grosso está lá.

`partner_latitude` / `partner_longitude` só em 89, o que é pouco para quem quisesse desenhar rotas
num mapa.

**Vazios em toda a base:** `comment`, `date`, `title`, `lang`.

### Caracterização

| Campo                | Tipo                               | Preenchido | Notas                                                                       |
| -------------------- | ---------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `type_establishment` | many2one → `res.establishment`     | 897        | O tipo de estabelecimento. 10 entradas na tabela                            |
| `type_surplus`       | many2many → `res.surplus`          | 305        | O tipo de excedente. 10 entradas, e a tabela tem `color`                    |
| `food_source_html`   | html                               | 655        | Texto livre sobre a fonte                                                   |
| `notes`              | char                               | 250        | **É um `char`, não um `text`**                                              |
| `reference_point`    | char                               | 244        | Ponto de referência para chegar ao local                                    |
| `start_date`         | date                               | 201        | Data de início. É `date`, não `datetime`                                    |
| `donation_receipt`   | boolean                            | 72         | **A fonte exige recibo de doação.** As 72 são todas fontes, nenhum contacto |
| `tag_ids`            | many2many → `res.partner.category` | 234        | Etiquetas standard do Odoo                                                  |
| `refood_tag_ids`     | many2many → `refood.custom.tags`   | 4          | Praticamente por usar                                                       |

`type_establishment` é o único destes que está preenchido na maioria das fichas; num `many2many`
como o `type_surplus`, vazio é vazio e não "sem excedente".

### Duas hierarquias, e não é a mesma coisa

O modelo usa **dois pares de campos independentes**, e guardam coisas diferentes:

| Par                                       | O que liga                                               | Fichas com pai | Pais distintos | Netos |
| ----------------------------------------- | -------------------------------------------------------- | -------------- | -------------- | ----- |
| `parent_id` / `child_ids`                 | **Subfontes** — uma fonte principal e as suas delegações | 34             | 24             | 6     |
| `contact_parent_id` / `contact_child_ids` | **Contactos da fonte** — pessoas e outros contactos      | 125            | 104            | 0     |

**Nenhuma ficha usa os dois** — a interseção é zero —, e nenhuma das duas árvores atravessa
núcleos. A de subfontes tem três níveis; a de contactos, dois.

O segundo par é o que obriga a ter cuidado: **um contacto é um `res.food.source` como os outros**,
na mesma tabela, e não há nenhum campo a dizer "isto é um contacto e não uma fonte". Distinguem-se
por terem `contact_parent_id` preenchido — ou, o que dá exatamente o mesmo conjunto, por não terem
`number`.

E são mesmo contactos, não fontes: dos 125, **nenhum tem rotas de recolha nem linhas de recolha**,
e só 10 têm tipo de estabelecimento. Têm morada (117) e email (65), que é o que se espera de um
contacto.

**Consequência:** contar `res.food.source` dá 1 124 e a resposta certa é 999. Qualquer domínio que
queira fontes tem de excluir os contactos, e nada no modelo o faz por si.

### Recolhas e turnos

| Campo                  | Tipo                              | Armazenado | Notas                                    |
| ---------------------- | --------------------------------- | ---------- | ---------------------------------------- |
| `route_ids`            | one2many → `res.collection.route` | sim        | As rotas de recolha. 213 fontes têm      |
| `collection_line_ids`  | one2many → `res.collection.line`  | sim        | O que se recolhe. 94 fontes têm          |
| `initial_hour`         | char                              | sim        | `'HH:MM:SS'` ou `'N/A'` — `'N/A'` em 915 |
| `closest_shift`        | char                              | **não**    | `'N/A'` em 1 025                         |
| `closest_initial_hour` | char                              | **não**    | `'N/A'` em 1 025                         |

É a mesma mecânica do beneficiário, e com a mesma armadilha: **as horas são strings, e o valor
"sem hora" é a string `'N/A'`, não `false`.** A convenção transversal do `false` não se aplica a
estes três campos.

O `closest_shift` só tem valor real em 99 fichas, e **todas as 99 têm rotas** — nenhuma fonte sem
rotas tem turno próximo, o que confirma que sai delas.

---

## `res.collection.route` — as rotas de recolha

801 rotas, gémeas das `res.delivery.route` das entregas (ver
[`beneficiarios.md`](beneficiarios.md)), com os mesmos hábitos:

| Campo                                                                                      | Tipo      | Relação               | Notas                                                                      |
| ------------------------------------------------------------------------------------------ | --------- | --------------------- | -------------------------------------------------------------------------- |
| `resource_calendar_id`                                                                     | many2one  | `resource.calendar`   | **Obrigatório**; o turno                                                   |
| `source_food_id`                                                                           | many2one  | `res.food.source`     | A fonte                                                                    |
| `week_day`                                                                                 | selection |                       | `'0'`–`'6'`, segunda a domingo, **como string**                            |
| `start_date`                                                                               | datetime  |                       | **Obrigatório**; UTC                                                       |
| `hour`                                                                                     | float     |                       | **Obrigatório**                                                            |
| `start_hour` / `end_hour`                                                                  | float     |                       | **Obrigatórios**; horas decimais                                           |
| `company_id`                                                                               | many2one  | `res.company`         | O núcleo                                                                   |
| `is_route_ongoing`                                                                         | boolean   |                       | Armazenado e escrito à mão. **Obsoleto — não filtrar por ele**, ver abaixo |
| `source_food_name`, `address`, `related_reference_point`, `related_phone`, `related_notes` | char      |                       | Cópias vindas da fonte                                                     |
| `related_collection_line_ids`                                                              | one2many  | `res.collection.line` | As linhas da fonte                                                         |

### A etiqueta do `source_food_id` é o NOME, não o código

**É o contrário do `partner_id` das encomendas**, onde a etiqueta é o código (`PTBFC_BF000168`), e é
o contrário do que a convenção do espelho no `res.partner` faz esperar. Quem assumir simetria
engana-se, e o engano passa despercebido porque o valor parece plausível:

```
res.collection.route.source_food_id  →  [234, "Ribapão"]              ← o nome
pos.order.partner_id (Entregas)      →  [14753, "PTBFC_BF000168"]     ← o código
```

**A rota também não traz o número da fonte.** A `res.delivery.route` traz o
`related_beneficiary_number`; esta não tem equivalente, e os 22 campos do modelo não incluem
nenhum. Quem precisar do código tem de o ler da ficha — `res.food.source`, campo `number`, por
`id` a partir das rotas. É seguro por esse caminho: os contactos não têm rotas, portanto nunca
entram na lista de ids.

### Cinco campos da rota são calculados e não armazenados

`source_food_name`, `related_notes`, `related_phone`, `related_reference_point` e `address` têm
todos `store = false`. **Lêem-se bem, mas não entram num domínio nem num `order`** — o nome da
fonte não serve para ordenar uma listagem do lado do Odoo.

### O que há dentro dos nomes e das notas

Medido em setembro de 2026, sobre as **202 fontes que têm rotas** — as que aparecem num painel:

| Nomes                  |                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------- |
| Mais comprido          | **55 caracteres** — _"Supermercado Continente - Bom Dia - Gândara dos Olivais"_ |
| p95 / p75 / mediana    | 37 / 26 / 20                                                                    |
| Acima de 30 caracteres | 27 (13%)                                                                        |

**Cortar com reticências destrói o que distingue.** Sete fontes começam por _"Continente Bom Dia…"_
e três por _"Pingo Doce & GO / BP…"_: **23 nomes ficam ambíguos se cortados aos 18 caracteres**, e o
que os separa está sempre no fim.

| Notas (`related_notes`)                |                                                              |
| -------------------------------------- | ------------------------------------------------------------ |
| Rotas com nota                         | **365 de 801 (46%)** — não é minoria                         |
| Mais comprida                          | **501 caracteres**                                           |
| p95 / mediana                          | 149 / 45                                                     |
| Com `<` ou `&` lá dentro               | 3 — escrever sempre por `textContent`, nunca por `innerHTML` |
| Com "Sr.", "falar com", "procurar por" | **0**                                                        |

As notas dizem **como fazer a recolha** — _"Recolher nas traseiras, contornar o cemitério"_, _"Ligar
para verificar se há excedentes"_. São escritas por quem gere as fontes, sobre estabelecimentos, e
quem vai recolher precisa delas. A decisão de as mostrar num televisor, e a razão, estão escritas na
rota `/api/recolhas` do Worker da TV, como o `CLAUDE.md` da raiz exige.

Tem **três campos de hora** — `hour`, `start_hour` e `end_hour` —, todos obrigatórios e todos
float, onde a rota de entrega só tem dois. O `start_hour` e o `end_hour` são o **intervalo** em que
a recolha pode ser feita, e o `hour` é a **hora recomendada** lá dentro.

Os dados confirmam-no: nas 801 rotas o `hour` está sempre entre os outros dois, e o intervalo nunca
é degenerado (`start_hour` é sempre menor que `end_hour`). Em 396 a hora recomendada coincide com o
início do intervalo.

### As 19 com `hour` a zero são horário por preencher, e o critério é o par

Medido em setembro de 2026, e a medição corrige o que aqui estava escrito antes:

|                  |                                                  |
| ---------------- | ------------------------------------------------ |
| `hour = 0`       | **19**                                           |
| `start_hour = 0` | **as mesmas 19**, e nenhuma delas tem `hour > 0` |
| `end_hour = 0`   | **zero, em toda a base**                         |
| os três a zero   | **zero**                                         |

**O `end_hour` nunca está a zero**, portanto um critério que o inclua não apanha nada. As 19 têm
intervalos como `00:00–20:50`, `00:00–19:45`, `00:00–22:30` e `00:00–21:30` — vinte e uma horas de
janela não é uma janela de recolha, é a hora de fecho preenchida e o resto por preencher. E **as 19
são todas do mesmo núcleo**: é hábito de preenchimento de um sítio, não padrão da base.

**O critério é `hour = 0` e `start_hour = 0`.** Nesse caso mostra-se `—` e não `00:00`. Em toda a
base **não há uma única recolha com hora entre as 00:00 e as 06:00**, o que sustenta a leitura.

**O risco que isto aceita, escrito para não ser surpresa:** uma recolha genuína à meia-noite, com
janela `00:00–01:00`, seria apanhada por este critério e mostrada como `—`. **Não há forma de a
distinguir nos dados** — zero é também o valor por omissão de um float por preencher, e o modelo não
tem nada que diga "isto foi preenchido". Se um dia aparecer uma recolha nocturna a sério, é aqui que
se volta.

Como nas entregas, `week_day` e as horas seguem a convenção das linhas de horário
([`turnos.md`](turnos.md)) e não a dos datetimes.

### O `is_route_ongoing` está obsoleto aqui também — e a gémea é pior

O campo existe **em dois modelos da base e só nesses dois**: aqui e na `res.delivery.route`. É a
mesma armadilha nos dois, e mede-se igual. Levantado em setembro de 2026, a pedido de quem reparou
que o problema das entregas tinha de se repetir do lado das recolhas.

É um boolean **armazenado e escrito à mão** — `store: true`, `compute: false`, módulo `refood` —, e
marca-se a `false` quando se cria uma rota com data de início futura. Aqui o padrão é ainda mais
limpo do que nas entregas:

|                                                | Recolhas (`res.collection.route`) | Entregas (`res.delivery.route`) |
| ---------------------------------------------- | --------------------------------- | ------------------------------- |
| Rotas                                          | 801                               | 3 252                           |
| A `false`                                      | 46                                | 391                             |
| Dessas, com `start_date` **depois** da criação | **46 de 46**                      | 390 de 391                      |
| Dessas, que **já arrancaram**                  | **46 de 46**                      | 390 de 391                      |
| A `true` com início futuro                     | 0                                 | 268                             |

**Todas as 46 já arrancaram e continuam marcadas como não decorrentes**, incluindo 20 que foram
editadas depois de criadas. A marca é posta no momento da criação e nunca mais é corrigida.

As `false` foram criadas entre **agosto de 2024 e março de 2025**, em 6 núcleos; as `true` vão até
maio de 2025, altura em que a tabela deixa de ser escrita.

**Quem filtrar por ele esconde recolhas que existem.** Numa quinta-feira, com o filtro contra sem
ele: um núcleo passa de 1 para 3 rotas, e outro **de 0 para 1** — um ecrã vazio onde há uma recolha
combinada. O filtro certo é o `start_date <= dia que se está a mostrar`, que faz o trabalho útil da
marca com um dado que não envelhece, e não precisa de limite superior porque uma rota que termina é
apagada. O mesmo raciocínio, e a mesma medição, em [`beneficiarios.md`](beneficiarios.md).

## `res.collection.line` — o que se recolhe

167 linhas, e o único ponto de toda esta documentação que toca o catálogo standard do Odoo:

| Campo            | Tipo     | Relação               | Notas                               |
| ---------------- | -------- | --------------------- | ----------------------------------- |
| `food_source_id` | many2one | `res.food.source`     | A fonte                             |
| `product_id`     | many2one | **`product.product`** | **Obrigatório**                     |
| `quantity`       | integer  |                       | **Obrigatório**; inteiro, não float |
| `name`           | char     |                       |                                     |

**`product.product` é o catálogo de produtos do Odoo**, um modelo standard que nenhum outro destes
documentos usa. Fica por levantar, e é provável que se cruze com o POS, que é onde os quilos
entram e saem.

A `quantity` ser **inteiro** diz que estas linhas contam unidades, não pesos.

## `res.establishment` e `res.surplus`

Duas tabelas de referência, 10 entradas cada, com a forma mínima das outras: `name` char
obrigatório e nada mais — exceto o `res.surplus`, que tem também um `color` integer, o campo de cor
das etiquetas do Odoo.

Como todas as tabelas de referência da operação, **não têm `company_id` nem `active`**: são listas
globais partilhadas por todos os núcleos, não se arquivam, e **a única chave é o `name`**.

---

## Consequências para quem lê estes dados

- **Sem `allowed_company_ids` no contexto, este modelo responde vazio.** É o segundo confirmado, a
  par do `res.beneficiary`.
- **O `number` não é único**: 21 repetidos em 999. Menos mau que no beneficiário, onde a repetição é
  a regra, mas o suficiente para não servir de chave.
- **O `res.partner` não leva a lado nenhum** — código por nome, sem contactos.
- **`closest_shift`, `closest_initial_hour` e `initial_hour` usam a string `'N/A'`** para "sem
  valor", não `false`.
- **125 dos 1 124 registos são contactos, não fontes.** Contar sem os excluir dá 1 124 em vez de
  999, e não há campo que os marque: reconhecem-se pelo `contact_parent_id` preenchido, ou por não
  terem `number`.
- **Há duas hierarquias** — subfontes e contactos —, e usar a errada dá o conjunto errado sem
  nenhum sinal.
- **32 núcleos, não 87.** Um núcleo sem fontes é o caso comum.

---

## Uma fonte nunca recebe alimentos

Os dois modelos não se conhecem — não há campo nenhum a ligar uma fonte de alimento a um parceiro
de apoio, nem sequer pelo `res.partner` — e **é assim de propósito**, porque os papéis excluem-se:

- **A fonte dá alimentos. O parceiro de apoio recebe-os**, quando tem `is_food_item_accepted` (ver
  [`parceiros-apoio.md`](parceiros-apoio.md)). **Uma fonte de alimento não pode ser um parceiro que
  recebe alimentos.**
- Se a mesma entidade também tiver de existir como parceiro de apoio **de outro tipo** — só para
  registo e contacto —, **cria-se uma ficha nova do lado dos parceiros**. Não se reaproveita a
  fonte.

Consequência para quem lê: **a mesma entidade do mundo real pode ter duas fichas, uma em cada
modelo, e nada na base as liga.** Isso não é duplicação a corrigir, é o desenho. Quem cruzar os dois
modelos por nome ou por NIF para os juntar está a desfazer uma separação deliberada; quem contar
entidades somando os dois conta algumas duas vezes.

---

## Pontos em aberto

- **Se os 21 números repetidos são erro ou têm explicação.**
- **`product.product`**, alcançado pelas linhas de recolha, por levantar. Sabe-se agora que **não é
  a mesma lista do POS**: das 167 linhas de recolha saem 13 produtos distintos, e só 4 estão no
  catálogo de 24 do POS ([`pos.md`](pos.md)). São 36 produtos na base inteira.
