# Parceiros de apoio

`res.support.partner` e `res.support.partner.type`. Índice e convenções transversais em
[`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> _Center_, quem trabalha no Odoo vê _Núcleo_. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## `res.support.partner` — a ficha do parceiro

A terceira das quatro fichas da operação, a par de voluntários ([`voluntarios.md`](voluntarios.md))
e beneficiários ([`beneficiarios.md`](beneficiarios.md)). Modelo **inteiramente da Refood**: dos 71
campos, 66 vêm do módulo `refood` e 2 do `refood_custom_tags`.

São **1 014 registos, 969 ativos**, e ao contrário do beneficiário quase nada está arquivado. A
criação está a acelerar: 40 em 2022, 330 em 2024, 413 em 2025 e já 192 em 2026.

Só `name` e `company_id` são obrigatórios.

### O âmbito é estreito

**27 dos 87 núcleos têm parceiros de apoio**, e a distribuição é muito desigual: o maior tem 204, a
mediana são 10, e há núcleos com um só. Um núcleo sem nenhum é o caso normal, não uma falha.

### Identidade e numeração

| Campo             | Tipo                     | Notas                                                |
| ----------------- | ------------------------ | ---------------------------------------------------- |
| `name`            | char                     | **Obrigatório**                                      |
| `number`          | char                     | `sequence_prefix` + `sequence_number` a seis dígitos |
| `sequence_prefix` | char                     | `PT` + as três letras do núcleo + `_PA`              |
| `sequence_number` | integer                  | Contador dentro do prefixo                           |
| `company_id`      | many2one → `res.company` | **Obrigatório**; o núcleo                            |
| `partner_id`      | many2one → `res.partner` | O espelho. Preenchido nos 1 014                      |
| `active`          | boolean                  | Arquivamento                                         |

É a mesma numeração das outras fichas (ver [`voluntarios.md`](voluntarios.md#identidade-e-nome)),
aqui com o sufixo `_PA`, e os 27 prefixos distintos correspondem aos 27 núcleos.

Ao contrário do beneficiário, **aqui o número é praticamente único** — 794 fichas com número, 792
números distintos, dois repetidos em pares. Não há a partilha de número do agregado familiar: cada
parceiro é um registo com o seu código.

Mas **220 dos 1 014 não têm número nenhum**, e um dos que têm não segue o formato. Portanto o
`number` serve para identificar, não para procurar às cegas: um quinto das fichas não responde.

### O espelho no `res.partner` só leva o número, e isso é de propósito

Todos os 1 014 parceiros têm um `res.partner`, um para um, e todos esses apontam de volta pelo
`support_partner_id`. O espelho **não tem dados nenhuns**: email, telefone, morada e NIF estão
vazios nos 1 014.

E o `name` do espelho não é o nome do parceiro — só coincide em 196 casos. **É o `number`**: em 793
dos 1 014, o nome do `res.partner` é o código `PTXXX_PA000000`, uma única palavra. Os que não têm
número é que ficam com o nome legível. O nome a sério está no `support_partner_name` do
`res.partner`, que bate certo com o `name` do parceiro nos 1 014.

**Não é descuido, é uma decisão de privacidade.** O `res.partner` é transversal a todo o Odoo, e um
contacto lá dentro aparece em sítios que não se controlam — o POS à cabeça. Para que o nome de um
beneficiário ou de um parceiro não saísse por aí, o contacto na lista geral foi feito **só com o
número**. Hoje já há mais lugares onde o nome pode aparecer, mas a regra mantém-se: **o contacto no
`res.partner` não leva mais informação do que o código.**

Consequência para quem lê: **o `res.partner` não é caminho para chegar a um parceiro de apoio.** Dá
um código por nome e nenhum contacto. Os dados estão do lado do `res.support.partner`, e é de lá
que se lêem.

### Os contactos, e o pouco que está preenchido

O modelo tem morada e contactos próprios — `street`, `street2`, `zip`, `city`, `state_id`,
`country_id`, `phone`, `mobile`, `email`, `vat`, `website`, `comment`, `partner_latitude` /
`partner_longitude`, `date_localization`, e as cinco resoluções de `image_*`.

Estão quase todos por preencher, nas 1 014 fichas: `email` 196, `mobile` 108, `city` 88,
`country_id` 83, `phone` 77, `street` 76, `zip` 66, `vat` 35, `image_1920` 12, `comment` 1.

**Isto é o esperado, não um problema de dados.** São poucos os núcleos que já usam tudo — a maioria
ainda não preencheu, e há campos que só ganham uso quando o núcleo avança na implementação. Uma app
que precise de um destes campos tem de funcionar sem ele.

**Vazios em toda a base:** `title`, `date`, `lang`, `website` e `default_tag_domain`. Quase vazios:
`refood_tag_ids` (5), `tag_ids` (2), a geolocalização (1).

### `function` e `x_function` — dois campos para a mesma coisa

`function` (o cargo, campo do módulo) tem 14 fichas preenchidas; **`x_function`, 75**. O prefixo
`x_` é a marca de um campo criado pelo Odoo Studio, por fora do módulo.

Coexistem, e o que está em uso é o segundo. Só 4 fichas têm os dois. Quem ler o `function` por ser
o nome óbvio apanha um quinto do que existe.

### Hierarquia

`parent_id` e `child_ids` ligam parceiros entre si: 221 fichas têm pai, distribuídas por 108 pais.
A árvore é de dois níveis — **não há netos** — e **nunca atravessa núcleos**: pai e filho estão
sempre na mesma empresa.

### `is_food_item_accepted` — quem recebe alimentos

Boolean, verdadeiro em **50 dos 1 014**. Marca os parceiros que **aceitam receber alimentos**, e
serve o POS: **só estes aparecem lá** como destino possível de uma saída.

É o campo que liga este modelo à operação. A Refood recolhe alimentos que iriam para o lixo e
ainda estão em condições, e distribui-os por beneficiários **e por outros parceiros** —
instituições que os recebem. O POS do Odoo foi adaptado para registar essas entradas e saídas em
quilos. Esse módulo fica para levantamento próprio.

Um parceiro de apoio, portanto, pode estar em dois papéis independentes: acompanhar ou sinalizar
beneficiários, e receber alimentos. **Só 50 fazem o segundo**, e nada obriga a que sejam os mesmos
que fazem o primeiro.

### O nome de um parceiro no televisor — a única excepção, e o que a limita

O painel de entregas da TV mostra as entregas a parceiros de apoio como **cartões de extra**, e nesse
cartão aparece o nome. É a única coisa daquele ecrã que sai de um campo `name`, e vale por uma razão
de espécie: **um parceiro que recebe alimentos é uma instituição, não uma pessoa** — a mesma espécie
da fonte de alimento cujo nome o painel das recolhas já mostra. A regra do "primeiro nome e inicial
do apelido" é sobre pessoas singulares.

O que a limita, e porque não é um cheque em branco:

- Sai do **`name` da ficha**, nunca do `client_name` da encomenda (que é o nome do beneficiário em
  100% das Entregas a BF) nem do `res.partner` (que só tem o código).
- Vão **as duas primeiras palavras e mais nada**. Não é só para caber: **nada neste modelo obriga a
  que um parceiro seja uma instituição** — 651 dos 1 014 não têm tipo, e o `support_partner_id` do
  beneficiário aponta "tipicamente a assistente social". Duas palavras chegam para _Centro
  Paroquial_ e não chegam para o nome completo de ninguém.
- Vai **ao lado do número** `P12`, porque duas palavras colidem: dois "Centro Social" no mesmo ecrã
  lêem-se como um cartão repetido. Um quinto das fichas não tem número, e nessas fica o nome
  sozinho.

Nada mais da ficha atravessa a leitura: são três campos, `partner_id`, `number` e `name`.

---

## `res.support.partner.type` — o tipo

Tabela de lista com **6 entradas**, e a única das tabelas de referência da operação que tem mais do
que um `name`: um boolean **`is_social_service`**, verdadeiro em exatamente uma delas.

**As etiquetas estão em inglês na base.** A entrada com `is_social_service` a verdadeiro chama-se
`Entity`, e não _Ação Social_ como é conhecida na operação. **O campo de confiança é o boolean, não
o texto** — quem filtrar pelo `name` não encontra o que procura.

Distribuição das 1 014 fichas pelos tipos: 253 na de serviço social, 50 + 35 + 10 + 9 + 6 nas
outras cinco, e **651 sem tipo nenhum**.

Esse é o número que mais importa: **quase dois terços dos parceiros de apoio não estão
classificados.** São dados anteriores à regra, não corrupção — mas qualquer filtro por tipo deixa
de fora a maioria da tabela.

---

## Quem aponta para aqui

| Origem            | Campo                                                                                     | Fichas |
| ----------------- | ----------------------------------------------------------------------------------------- | ------ |
| `res.beneficiary` | `support_partner_id` — quem **acompanha** o beneficiário, tipicamente a assistente social | 621    |
| `res.beneficiary` | `signaling_entity_partner_id` — quem **sinalizou** o beneficiário                         | 795    |
| `res.partner`     | `support_partner_id` — o espelho, um por parceiro                                         | 1 014  |

Os dois campos do beneficiário são papéis distintos e a base trata-os como tal: dos 352
beneficiários com ambos preenchidos, só 3 têm o mesmo parceiro nos dois.

Em qualquer deles **só deviam poder escolher-se parceiros de serviço social**, mas isso é restrição
da vista e os dados não a cumprem — 265 das 621 fichas apontam a um parceiro sem tipo. Os números
estão em [`beneficiarios.md`](beneficiarios.md).

---

## Consequências para quem lê estes dados

- **Este modelo lê-se normalmente.** Tem a mesma `ir.rule` global do `res.beneficiary`, mas devolve
  os mesmos 1 014 registos com e sem `allowed_company_ids` no contexto. O que fecha o beneficiário
  é o `search()` redefinido desse modelo, não a regra — ver
  [`beneficiarios.md`](beneficiarios.md). Ainda assim, **mandar o contexto é o correto**: é o que a
  regra espera e o que protege de uma mudança do lado do Odoo.
- **O `res.partner` associado não serve para nada além de existir.** Sem contactos, e com o código
  por nome.
- **O tipo não é de confiança como filtro**, e o texto do tipo muito menos do que o
  `is_social_service`.
- **Ler `x_function`, não `function`.**
- **Um quinto das fichas não tem `number`.**
- **27 núcleos, não 87.** Contar parceiros por núcleo dá zero na maioria, e isso é o esperado.

---

## Pontos em aberto

- ~~**O POS, por levantar**~~ — feito, em [`pos.md`](pos.md). Do lado deste modelo o que dali saiu
  são **19 parceiros distintos e 1 220 encomendas de Entregas**, e a confirmação de que o
  `partner_id` de uma encomenda de Entregas aponta sempre a um beneficiário ou a um parceiro de
  apoio, nunca a outra espécie.
- **`default_tag_domain`**, do `refood_custom_tags`, está vazio nos 1 014. Serve presumivelmente
  para restringir as `refood_tag_ids`, que só 5 fichas usam.
- ~~Se a mesma entidade pode ser parceiro de apoio e fonte de alimento.~~ **Não pode**, no papel de
  receber alimentos: uma fonte dá, um parceiro recebe, e os papéis excluem-se. Se a entidade tiver
  de existir dos dois lados por outra razão — registo e contacto —, cria-se ficha nova no parceiro.
  Por isso os modelos não se conhecem, e por isso a mesma entidade pode ter duas fichas sem que nada
  as ligue. Ver [`fontes-alimento.md`](fontes-alimento.md#uma-fonte-nunca-recebe-alimentos).
- **Porque é que só 794 têm número.** Se é ordem de criação, se é o núcleo que não gerou, ou se há
  fichas criadas por outra via.
