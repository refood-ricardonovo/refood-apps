# POS — entradas e saídas em quilos

`pos.order`, `pos.order.line`, `pos.config`, `pos.session`. Índice e convenções transversais em
[`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> *Center*, quem trabalha no Odoo vê *Núcleo*. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## O POS não é um ponto de venda

O módulo Point of Sale do Odoo foi adaptado (`refood_pos`) para uma coisa que não vende nada: um
**ecrã tátil no núcleo onde se pesam os alimentos que entram e os que saem**. O que o operador
regista é uma linha por categoria de alimento e uns quilos; o que sai do outro lado é uma
`pos.order` sem dinheiro nenhum.

Não é figura de estilo. Nos **17 703 registos** de `pos.order`, `amount_total`, `amount_paid`,
`amount_tax`, `amount_return`, `tip_amount` e `price_unit` estão **todos a zero**, e a soma dos
17 822 `pos.payment` é zero também. Nenhuma encomenda tem fatura (`account_move`), posição fiscal ou
movimento de stock (`picking_ids`). **Qualquer campo monetário deste módulo é ruído** — ler um deles
não dá erro, dá zero, e é fácil confundir isso com "ainda não foi pago".

O número que interessa é um só: **`total_in_kg`**.

---

## Duas caixas por núcleo: Recolhas e Entregas

Cada núcleo tem **dois pontos de venda**, e a diferença entre eles é a diferença entre os dois lados
da operação:

| Caixa | `pos_type` | O que regista | Quem é o "cliente" |
|---|---|---|---|
| **Recolhas** | `collections` | Alimentos que **entram** | Uma **fonte de alimento** ([`fontes-alimento.md`](fontes-alimento.md)) |
| **Entregas** | `deliveries` | Alimentos que **saem** | Um **beneficiário** ([`beneficiarios.md`](beneficiarios.md)) ou um **parceiro de apoio** ([`parceiros-apoio.md`](parceiros-apoio.md)) |

São **167 `pos.config`**: **83 núcleos com o par exato** `Recolhas` + `Entregas`, mais uma config
`Shop` na empresa de topo, criada em 2023 e anterior ao módulo — a única sem `pos_type`, com uma
sessão e **zero encomendas**. Os nomes não variam: há **um** nome distinto para cada tipo. Três
empresas das 87 não têm config nenhuma.

**Configurar não é usar.** Dos 83 núcleos preparados, **20 chegaram a abrir sessões de Recolhas e 16
de Entregas**, e **só 9 de cada lado têm encomendas** — com a distribuição habitual destes dados:
5 608 e 1 544 encomendas nos dois primeiros de Recolhas, e uma cauda de núcleos com menos de uma
dúzia. Um núcleo sem encomendas de POS é o caso comum, não a exceção.

### `pos_type` é `refood_pos`, e é o único marcador

Dos 96 campos da `pos.config`, 10 são da Refood: `pos_type`, `box_control`,
`current_adjustment_state`, `default_payment_method_id`, `has_been_configured`, `ip_address`,
`is_properly_configured`, `quality_check_ids`, `scale_port`, `wants_scale`. O `pos_type` é uma
`selection` de duas chaves — `'collections'` e `'deliveries'` — e **é a única coisa na base que
distingue uma caixa da outra**. O nome da config diz o mesmo, mas o nome é texto editável.

`box_control` está ligado em 6 configs — é o que ativa o registo de caixas, ver
[`res.partner.box.tracker`](#respartnerkg-e-respartnerboxtracker).

### A balança não é a do Odoo

`iface_electronic_scale` está **desligado nas 167 configs, e é para continuar assim**: é a balança
por IoT do Odoo, que a Refood não usa. A balança real existe e é um **emulador feito à medida, que
lê a porta COM** do posto — fora dos campos standard do módulo. **Digitar o peso à mão é sempre
possível**, com ou sem balança ligada.

Os dois campos do `refood_pos` que sobram na config, `wants_scale` e `scale_port`, **não aparecem em
nenhuma vista** e são provavelmente desse emulador — se a balança está ativa e em que porta. Fica
por confirmar; o que não se deve é ler o `iface_electronic_scale` como resposta à pergunta "este
núcleo pesa?".

---

## Recolhas e Entregas nunca se somam

**As duas caixas registam tudo a positivo**, como se ambas fossem saídas. O sinal do `total_in_kg`
**não diz de que lado está o movimento** — diz apenas se é um registo normal ou um estorno.

Esta é a regra mais importante deste documento: **um quilo recolhido e um quilo entregue são
realidades distintas e não se somam.** Não há nenhum sinal, nenhum campo e nenhuma convenção na base
que impeça alguém de fazer `sum(total_in_kg)` sobre `pos.order` e obter um número — o número sai, e
não quer dizer nada. Todo o cálculo tem de separar primeiro pelo `pos_type` e reportar dois totais.

O mesmo vale para contagens, médias e séries temporais: **duas séries, nunca uma.**

---

## O tipo não está na encomenda

`pos.order.config_id` **não está armazenado** — é um relacionado que passa pela sessão. Consequência
prática, e é a armadilha desta área:

- **`read_group` por `config_id` rebenta**: `Fields in 'groupby' must be database-persisted fields`.
  Não há forma de agrupar encomendas por caixa diretamente.
- **O `search` funciona**, porque o Odoo sabe pesquisar relacionados não armazenados. O caminho é
  `['session_id.config_id.pos_type', '=', 'collections']`, e nas linhas
  `['order_id.session_id.config_id.pos_type', '=', …]`.
- Para **agrupar**, o caminho é ir buscar as sessões de cada tipo primeiro e filtrar por
  `['session_id', 'in', ids]`. Foi assim que se levantaram os números deste documento.

Os outros campos não armazenados da `pos.order` são `currency_id`, `invoice_group`, `picking_count`,
`failed_pickings`, `picking_type_id`, `session_move_id`, `is_invoiced` e `display_name`.

Na `pos.session`, atenção a **`company_id`, que também não está armazenado** — o núcleo de uma sessão
não se filtra nem se agrupa. Na `pos.order` o `company_id` **está** armazenado, é obrigatório, e
confere sempre com o da config (17 703 em 17 703).

### `pos.session.is_delivery` está partido

O `is_delivery` da sessão é um calculado do `refood_pos` que faz `self.config_id.pos_type` **sem
iterar o recordset**. Lê-se bem numa sessão de cada vez, e lê-se bem em várias **desde que sejam
todas da mesma config** — mas ler duas sessões de configs diferentes devolve
`ValueError: Expected singleton: pos.config(308, 309)`, HTTP 200 com `error` no corpo.

Ou seja: **um `search_read` que inclua `is_delivery` funciona em testes pequenos e rebenta em
produção**, porque basta o segundo núcleo aparecer no resultado. Não usar. O `pos_type` da config dá
a mesma informação e não tem o defeito.

---

## `pos.order`

49 campos: 38 do `point_of_sale` standard, 2 do `pos_hr` (`cashier`, `employee_id`) e **6 do
`refood_pos`** — `total_in_kg`, `client_name`, `customer_count`, `delivered_box`, `returned_box` e
`prepared`.

**17 703 encomendas: 7 488 de Recolhas e 10 215 de Entregas.** As datas vão de maio de 2024 a
setembro de 2026, mas 2025 é praticamente tudo (7 340 e 10 085); 2024 e 2026 são dezenas.

### Identidade e numeração

| Campo | Tipo | Notas |
|---|---|---|
| `name` | char | **Obrigatório**. `<R ou E><NUC> <AA>/<NNNNN>` |
| `pos_reference` | char | Igual ao `name` em 17 681 dos 17 703 |
| `sequence_number` | integer | Ordem dentro da sessão; 1 a 174 |
| `session_id` | many2one → `pos.session` | **Obrigatório**; o caminho para o tipo de caixa |
| `company_id` | many2one → `res.company` | **Obrigatório**; o núcleo |
| `date_order` | datetime | UTC, como todos |

O `name` codifica três coisas: **a letra `R` de Recolhas ou `E` de Entregas**, as **três letras do
núcleo** (as mesmas dos prefixos das fichas — ver [`voluntarios.md`](voluntarios.md)), e depois
`AA/NNNNN`, em que `AA` são os **dois dígitos do ano** do `date_order` (bate em 17 702 dos 17 703) e
`NNNNN` é um contador. A letra bate com o `pos_type` nas 17 703, e nenhum dos 18 prefixos aparece em
mais do que um núcleo — **o prefixo do `name` é, na prática, um segundo marcador do tipo e do
núcleo**.

O contador, esse, **não é fiável**: as 29 séries (config × ano) não começam em 1 nem são contíguas, e
4 delas têm números repetidos. Serve para ler, não para ordenar nem para usar como chave.

### Quem — e o problema de proteção de dados que isto levanta

| Campo | Tipo | Preenchido | Notas |
|---|---|---|---|
| `partner_id` | many2one → `res.partner` | **17 703 (100%)** | O espelho da ficha |
| `client_name` | char | **17 703 (100%)** | `refood_pos`. **O nome legível, em texto** |
| `user_id` | many2one → `res.users` | 17 703 | Quem estava no ecrã |
| `cashier` | char | 17 703 | `pos_hr`. O nome do `user_id` em 17 529 dos 17 703 |
| `employee_id` | many2one → `hr.employee` | **0** | O `pos_hr` está instalado mas não é usado |
| `note` | text | 207 | Notas internas |

O `partner_id` é o espelho no `res.partner`, e aponta exatamente para onde se espera:

- **Recolhas — 116 parceiros distintos, os 116 com `food_source_id`.** Todos fontes de alimento, sem
  exceção.
- **Entregas — 386 parceiros distintos: 367 com `beneficiary_id` e 19 com `support_partner_id`.**
  Nenhum de outra espécie.

Confirma-se assim, pelos dados, o que a operação diz: **a Recolha vem sempre de uma fonte, a Entrega
vai sempre para um beneficiário ou para um parceiro de apoio.** É também a prova de que uma fonte
nunca aparece do lado das entregas (ver o fim de [`fontes-alimento.md`](fontes-alimento.md)).

**82 desses parceiros estão arquivados** (3 nas Recolhas, 79 nas Entregas), e o Odoo esconde-os por
omissão: quem quiser resolver o `partner_id` de encomendas antigas tem de ler o `res.partner` com
`['active', 'in', [true, false]]`, ou fica sem o registo e sem aviso.

E agora o ponto que importa mais do que todos os outros deste documento:

> **O `client_name` é o nome legível, e nas Entregas é o nome do beneficiário.** Verificou-se em 100%
> dos registos: nas Recolhas coincide com o `name` da `res.food.source` (7 488 em 7 488), nas
> Entregas com o `name` da `res.beneficiary` (8 995 em 8 995) ou com o `support_partner_name`
> (1 220 em 1 220).

As convenções do índice dizem que o espelho no `res.partner` leva só o código, de propósito, para o
nome não andar por sítios que não se controlam. **O `refood_pos` copia o nome à mesma, para dentro
da `pos.order`.** Quem for buscar quilos ao POS traz nomes de pessoas com eles, sem os pedir. Numa
app como a TV — um ecrã por onde qualquer pessoa passa — o `client_name` das Entregas **não pode ser
lido**, e muito menos mostrado; o `partner_id` sozinho também não resolve, porque a ficha do outro
lado tem o nome. Isto é uma decisão a tomar em cada rota, não um detalhe de apresentação.

### Quanto

| Campo | Tipo | Notas |
|---|---|---|
| `total_in_kg` | float | `refood_pos`. **O único número com significado** |
| `state` | selection | Só aparecem `'done'` (17 646) e `'paid'` (57) |
| `customer_count` | integer | `refood_pos`, "N° meals". **Facultativo, e zero nas 17 703** |
| `delivered_box` / `returned_box` | integer | `refood_pos`. Diferentes de zero em 34 e 33, só nas Entregas |
| `prepared`, `to_invoice`, `is_tipped` | boolean | **Falsos nas 17 703** |
| `nb_print` | integer | Zero nas 17 703 |

Dos cinco estados possíveis (`draft`, `cancel`, `paid`, `done`, `invoiced`) só existem dois, e o
`'paid'` são 57 encomendas de sessões que ficaram por fechar — **20 sessões continuam abertas**, a
mais antiga desde outubro de 2025, com 56 encomendas lá dentro. Não há forma de cancelar um registo
mal feito: **um registo errado corrige-se com um estorno**, não com um `cancel`.

### Estornos, e o que eles fazem ao sinal

**22 encomendas trazem o sufixo `REEMBOLSAR`** no `name` (3 de Recolhas, 19 de Entregas, e uma delas
com o sufixo duas vezes — estorno de estorno). O sufixo é escrito pelo Odoo **na língua activa no
momento do estorno** e fica guardado: hoje são 22 com `REEMBOLSAR` e **0 com `REFUND`**, mas é um
valor gravado, não traduzido na leitura — um estorno feito com a interface em inglês não seria
reconhecido por quem procura `REEMBOLSAR`. São elas as que têm `total_in_kg` negativo: 5 nas
Recolhas e 18 nas Entregas, 23 no total.

O negativo é, portanto, **estorno e não sentido do movimento**. Somar quilos dentro de um tipo já faz
o estorno abater, que é o que se quer; o que não se pode é ler o sinal como "isto é uma entrada".

### Nada valida o que se escreve, e nota-se

A distribuição do `total_in_kg` por encomenda:

| | mín | p25 | mediana | p75 | p95 | p99 | máx |
|---|---|---|---|---|---|---|---|
| Recolhas | -64 358 | 5,9 | 15,8 | 54,1 | 125 | 231 | 111 111 |
| Entregas | -71 150 | 9,7 | 14,6 | 19,9 | 40 | 113 | 20 000 124 |

A mediana é um registo plausível de quem pesa comida; os extremos não são. **8 registos de Recolhas e
36 de Entregas passam os 1 000 kg**, e bastam para dominar qualquer soma: o total das Entregas é
20,4 milhões de kg, mas tirando as encomendas acima de 1 000 kg a soma fica **negativa**. Um único
núcleo, com 38 encomendas, responde por 20 000 613 desses quilos.

A balança existe, mas o peso pode sempre ser escrito à mão e **não há limite nenhum do lado do
Odoo**: um gralho de teclado entra na base tal como está. Isto é a base de staging e a produção pode
estar melhor, mas o desenho é o mesmo. Qualquer app que mostre totais tem de contar com isto — e uma
app que mostre uma média sem a proteger de outliers vai mostrar um número absurdo.

Há ainda **321 encomendas a zero quilos** (73 de Recolhas, 248 de Entregas), e nem todas são enganos:
ver as linhas de "Falta" a seguir.

---

## `pos.order.line` — as linhas

**40 903 linhas: 28 047 nas Recolhas e 12 856 nas Entregas** — 3,75 linhas por encomenda de Recolha
contra 1,26 por Entrega, que é a diferença entre pesar o que veio de um restaurante e entregar um
cabaz. Oito encomendas de Entregas não têm linhas nenhumas.

O modelo é o standard do Odoo. O `refood_pos` acrescenta um campo só (`pack_scrap_ids`), e nada dos
campos de preço é usado: `price_unit` e `discount` estão a zero em todas as linhas.

| Campo | Tipo | Notas |
|---|---|---|
| `order_id` | many2one → `pos.order` | **Obrigatório** |
| `product_id` | many2one → `product.product` | **Obrigatório**; a categoria de alimento |
| `qty` | float | A quantidade — **kg ou unidades, conforme o produto** |
| `product_uom_id` | many2one → `uom.uom` | **`kg` ou `Units`, e é o que decide tudo** |
| `full_product_name` | char | Cópia do nome do produto |
| `company_id` | many2one → `res.company` | O núcleo |
| `price_unit`, `price_subtotal`, `discount`, `tax_ids` | | Zero / vazios |

### `total_in_kg` = soma das linhas **em kg**

Verificado nos dois tipos, em 1 500 encomendas de cada, e bate em **todas**: o `total_in_kg` da
encomenda é a soma do `qty` **das linhas cuja unidade é `kg`**. As linhas em `Units` — 103 nas
Recolhas, 334 nas Entregas — **não entram no total**, e é por isso que a soma ingénua de todas as
linhas diverge em ~2% das encomendas.

Uma encomenda com `total_in_kg` a zero pode, portanto, **ter linhas**: é o caso de quem só registou
uma falta ou um cabaz. Zero quilos não quer dizer registo vazio.

---

## O catálogo — 24 produtos, e nenhum é um produto

`product.product` com `available_in_pos = true`: **24 registos, de um total de 36 na base inteira**.
São **globais — nenhum tem `company_id`** —, todos com `list_price` a zero, e o que está lá são
**categorias de alimento**, não artigos: pão, fruta, sopa, mercearia, carne e peixe (confecionado e
não confecionado), pratos combinados, acompanhamentos, bolos, ração animal, e um "Outros".

Quatro categorias de POS (`pos_categ_id`) organizam-nas, e a unidade separa-as em duas famílias que
não se misturam:

| `pos_categ_id` | Unidade | O que é |
|---|---|---|
| **Alimentos** | `kg` | As categorias de comida. Entram no `total_in_kg` |
| **Diversos** (*Outros* em `en_US`) | `kg` | Ração animal, orgânico para animais. Entram no `total_in_kg` |
| **Cabazes** | `Units` e `kg` | "Cabaz Parceiro" — existe **nas duas unidades**, em registos diferentes |
| **Observações** | `Units` | Três produtos, e **um deles não é uma falta** — ver a seguir |

**O nome da categoria 4 é o primeiro sítio onde a língua se nota:** é *Diversos* em `pt_PT` e
*Outros* em `en_US`. As restantes três têm o mesmo nome nas duas línguas. A app filtra pela
categoria *Observações*, e é por isso que funciona — mas é sorte, não desenho.

### Os três produtos de *Observações*, e a armadilha da tradução

**Um dos três não é uma falta.** Referências Internas (`default_code`) preenchidas em 2026-09-08,
precisamente para haver uma chave que não seja o id nem o nome:

| id | `default_code` | nome em `pt_PT` | nome em `en_US` | significa |
|---|---|---|---|---|
| 27 | `OBS-FALTA-INJ` | Falta Injustificada | Falta Injustificada | falta |
| 28 | `OBS-FALTA-JUST` | Falta Justificada | Falta Injustificada (cópia) | falta |
| 37 | `OBS-SEM-EXC` | **Sem excedente** | **Falta Justificada (cópia)** | **a fonte não tinha excedente** |

**O produto que significa "não havia nada para recolher" chama-se "Falta Justificada (cópia)" em
inglês.** Qualquer regra por nome — ou por substring `/falta/i` — classifica-o como falta em
silêncio. É o exemplo que fundamenta a regra transversal: **comparar ids e códigos, nunca nomes.**

O mesmo vale para o catálogo inteiro: **20 dos 24 produtos de POS têm nomes sem relação entre as
duas línguas**, porque os valores `en_US` ficaram com os "(cópia)" de duplicações antigas. O
produto 16 é *Bolos* em `pt_PT` e *Acompanhamentos (cópia)* em `en_US`.

**As observações aparecem nas duas caixas**, porque `limit_categories` é `false` nas 166 caixas e
os produtos são globais (sem `company_id`). Contagens em staging, sem estornos: **Recolhas** 25
faltas e 47 "sem excedente"; **Entregas** 166 faltas e 1 "sem excedente".

**A unidade é uma escolha deliberada, não um descuido de configuração:** o que está em `Units` está
lá precisamente **para não influenciar os quilos**. São duas coisas diferentes com a mesma forma:

- **Cabazes** — registo genérico, quando o que se entrega é um cabaz e não uma pesagem.
- **Observações** — **controlo interno**. Uma linha de "Falta" regista que **o beneficiário não veio**,
  e a escolha entre justificada e injustificada diz **se avisou ou não**. O terceiro produto,
  `OBS-SEM-EXC`, diz o contrário: a recolha foi feita e a fonte não tinha excedente.

A consequência é que uma encomenda de Entregas pode ser exatamente o contrário de uma entrega. Quem
contar encomendas está a contar entregas **e faltas juntas**; quem quiser entregas mesmo tem de
olhar às linhas.

O "Cabaz Parceiro" duplicado — um em `Units`, outro em `kg` — é a mesma ideia registada de duas
maneiras conforme o núcleo, e as duas contam de forma diferente. Nas Entregas é o produto mais usado
de longe.

Muitos nomes trazem o sufixo `(cópia)`, e há nomes repetidos em produtos diferentes
(`Acompanhamentos` aparece 3 vezes, `Sopa` e `Ração Animal` 2). **O nome do produto não é chave**; o
`id` é.

Nota para quem vier das fontes de alimento: as `res.collection.line` usam 13 produtos distintos e
**só 4 deles estão no catálogo do POS**. Os dois lados tocam-se, mas não são a mesma lista.

---

## `res.partner.kg` e `res.partner.box.tracker`

Dois modelos pequenos do `refood_pos`, pendurados no `res.partner`. Os volumes são baixos, mas **a
razão não é a de sempre**: aqui não é adoção parcial de um campo opcional, é que **muito poucos
núcleos avançaram para a pesagem**. Onde não se pesa, não há nada disto.

**`res.partner.kg` — 105 registos, 76 parceiros.** `total` (float), `date` (date), `partner_id` e um
**many2many `order_ids` para `pos.order`**. É o acumulado de quilos de um parceiro num dia, com as
encomendas que o compõem (1,2 em média). Do lado do `res.partner` corresponde-lhe o `kg_history_ids`
e o calculado `today_kg_total`.

**`res.partner.box.tracker` — 33 registos, 15 parceiros.** `partner_id`, `order_id` (many2one, uma
encomenda só), `date`, `delivered`, `returned`, `box_count_at_delivery`, `box_count_after_delivery`.
Do lado do `res.partner`, `box_ids` e `box_count`. Bate com os 6 `pos.config` que têm `box_control`
ligado e com os 34/33 registos de `delivered_box`/`returned_box` nas Entregas.

**As caixas são as caixas de plástico com os alimentos**, e são da Refood: o beneficiário leva-as e
**tem de as devolver na vez seguinte em que vem buscar comida**. Daí os quatro inteiros — quantas
foram, quantas voltaram, e o saldo em dívida antes e depois da entrega. Não é logística de
armazém; é o registo de um empréstimo que se espera de volta.

Os dois são **derivados do POS, não fonte**: o que lá está pode reconstruir-se a partir das
encomendas.

---

## Consequências para quem lê estes dados

- **Recolhas e Entregas não se somam.** Estão as duas a positivo, o sinal não as distingue, e a única
  separação é o `pos_type` da config. Dois totais, sempre.
- **O tipo não está na encomenda.** `config_id` não está armazenado: `read_group` por ele rebenta;
  filtra-se por `session_id.config_id.pos_type` ou por uma lista de sessões.
- **Não ler `pos.session.is_delivery`.** Rebenta assim que o resultado apanhe duas configs.
- **`client_name` traz o nome do beneficiário.** É o furo à regra do espelho anónimo. Numa app
  pública, não ler.
- **Parceiros arquivados**: 82 dos 502 parceiros referidos pelas encomendas. Ler o `res.partner` com
  `active in [true, false]`.
- **Todo o dinheiro é zero.** `amount_total` a zero não é "por pagar", é o desenho.
- **`total_in_kg` só conta as linhas em `kg`.** Zero quilos com linhas é normal — pode ser uma falta.
- **Os extremos são erros de digitação** e dominam qualquer soma. Há balança, mas o peso pode ser
  sempre escrito à mão e nada o valida.
- **Uma encomenda de Entregas pode ser uma falta**, registada em `Units` para não mexer nos quilos.
- **`state` é sempre `done` ou `paid`**, e a correção faz-se por estorno (`REEMBOLSAR`, quilos
  negativos), não por cancelamento.
- **A unidade de análise é a encomenda e a sua data, não a sessão.** Uma sessão pode ser um turno ou
  um dia inteiro, conforme o núcleo.
- **9 núcleos, não 87** — e aqui a razão é a pesagem, que poucos núcleos começaram, não a adoção
  parcial de um campo.
- **Ao contrário do `res.beneficiary` e do `res.food.source`, o `pos.order` lê-se sem
  `allowed_company_ids`** — 17 703 com contexto e sem ele. A separação por núcleo, aqui, tem de vir
  do domínio.
- **O POS ignora a distinção Gestão/Utilizador**: a `pos.order` tem só a regra global
  `company_id in company_ids`, e a `pos.order.line` **não tem regra nenhuma** — ler linhas
  diretamente contorna o filtro por núcleo da encomenda ([`permissoes.md`](permissoes.md)).

---

## Fechado com a equipa

Estas respostas não estão em lado nenhum da base — ficam aqui porque foram confirmadas por quem
opera o sistema.

- **A sessão não é o turno, e não tem de ser.** Não há ligação nenhuma entre `pos.session` e o
  `resource.calendar` dos turnos ([`turnos.md`](turnos.md)), **e isso é intencional**: cada núcleo
  decide se abre uma sessão por turno ou uma por dia. **O que conta é a encomenda e a data em que
  foi feita** — a sessão é um agrupamento de conveniência do núcleo, não uma unidade de análise. Não
  construir nada que assuma "uma sessão = um turno".
- **`customer_count` é facultativo, e ficou assim de propósito.** Chegou a ser obrigatório, e
  concluiu-se que não era viável exigi-lo. O zero nas 17 703 é o resultado dessa decisão, não um
  campo por estrear.
- **`quality_check_ids` é uma opção retirada.** Havia controlo de qualidade e o seu registo no Odoo
  foi cancelado. O campo é resto.
- **`pos_type` assume-se estável.** Nunca se testou mudá-lo com encomendas já registadas, e só
  administradores de POS o podem editar — cerca de cinco pessoas em produção. **Trabalhar como se
  não mudasse**, sabendo que, se mudasse, o histórico trocava de lado sem deixar rasto: o tipo não
  está copiado para a encomenda, e só o prefixo do `name` guardaria a memória.

## Pontos em aberto

- **`wants_scale` e `scale_port`**, por confirmar. Não aparecem em vista nenhuma, e a leitura mais
  provável é que sejam do emulador de balança — se está ativa e em que porta.
- **As 20 sessões abertas há meses** — se é hábito dos núcleos ou lixo de staging.
