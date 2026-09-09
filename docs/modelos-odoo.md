# Modelos Odoo — índice

Inventário da base do Odoo, por área. **Só estrutura**: nomes de campos, tipos, relações e
proveniência. Sem dados, sem registos de exemplo.

Descreve **o que existe na base**, não o que cada app usa nem o que cada app pode mostrar. A TV
mostra uma fatia pequena disto, a PWA de voluntários outra, e haverá mais aplicações; nenhuma delas
vai precisar de tudo. As regras de cada app — que campos lê, o que apresenta, como restringe o
âmbito — vivem na app e não aqui.

A operação, porque explica metade dos campos: a Refood **recolhe alimentos que iriam para o lixo** e
ainda estão em condições, e distribui-os por **beneficiários** e por **parceiros** — instituições
que os recebem. Os **voluntários** fazem essa recolha e distribuição, organizados em **turnos**, a
partir de um **núcleo**. O POS do Odoo foi adaptado para registar as entradas e saídas de alimentos
em quilos.

Odoo v14 Community, levantado na base de staging (`refoodteste`) a partir de setembro de 2026.

## O vocabulário da operação

A equipa usa estas siglas e estes nomes indistintamente, em conversa e nos pedidos. **A tradução
para o modelo do Odoo é esta, e não muda:**

| Diz-se      | Também              | No Odoo                                                                   |
| ----------- | ------------------- | ------------------------------------------------------------------------- |
| **VL**      | Voluntários         | `hr.employee` — são os **funcionários**, e alguns são também utilizadores |
| **BF**      | Beneficiários       | `res.beneficiary`                                                         |
| **FA**      | Fontes de Alimentos | `res.food.source`                                                         |
| **PA**      | Parceiros de Apoio  | `res.support.partner`                                                     |
| **Núcleos** |                     | `res.company` — são as **empresas**                                       |

As duas que enganam: **um voluntário é um funcionário do Odoo**, não um utilizador (ter conta é
outra coisa, e nem todos têm), e **um núcleo é uma empresa**, que é por onde passa toda a separação
de dados da base.

---

## Onde está cada modelo

| Modelo                                                                                           | Área                          | Ficheiro                                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `resource.calendar`                                                                              | Turnos                        | [`modelos/turnos.md`](modelos/turnos.md)                                                       |
| `resource.calendar.attendance`                                                                   | Turnos                        | [`modelos/turnos.md`](modelos/turnos.md)                                                       |
| `res.calendar.availability`                                                                      | Turnos                        | [`modelos/turnos.md`](modelos/turnos.md)                                                       |
| `resource.calendar.leaves`                                                                       | Turnos                        | [`modelos/turnos.md`](modelos/turnos.md) — por documentar                                      |
| `hr.employee`                                                                                    | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md)                                             |
| `res.shift.log`                                                                                  | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md)                                             |
| `hr.attendance`                                                                                  | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md) — picagem standard, instalada e fora de uso |
| `hr.job`, `hr.employee.category`                                                                 | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md)                                             |
| `refood.custom.tags`                                                                             | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md)                                             |
| `res.functional.team`, `res.executive.team`                                                      | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md)                                             |
| `hr.employee.executive.line`                                                                     | Voluntários                   | [`modelos/voluntarios.md`](modelos/voluntarios.md)                                             |
| `res.company`                                                                                    | Núcleos                       | [`modelos/nucleos.md`](modelos/nucleos.md)                                                     |
| `res.partner`                                                                                    | Núcleos                       | por escrever — é lá que vive a morada e o NIF de cada núcleo                                   |
| `res.beneficiary`                                                                                | Beneficiários                 | [`modelos/beneficiarios.md`](modelos/beneficiarios.md)                                         |
| `res.delivery.route`                                                                             | Beneficiários                 | [`modelos/beneficiarios.md`](modelos/beneficiarios.md)                                         |
| `res.income.line`, `res.expense.line`, `res.nutritional.line`, `res.need.line`, `res.skill.line` | Beneficiários                 | [`modelos/beneficiarios.md`](modelos/beneficiarios.md)                                         |
| As 18 tabelas de referência do beneficiário (`res.food.type`, `res.marital.status`, …)           | Beneficiários                 | [`modelos/beneficiarios.md`](modelos/beneficiarios.md)                                         |
| `res.support.partner`, `res.support.partner.type`                                                | Parceiros de apoio            | [`modelos/parceiros-apoio.md`](modelos/parceiros-apoio.md)                                     |
| `res.food.source`                                                                                | Fontes de alimento            | [`modelos/fontes-alimento.md`](modelos/fontes-alimento.md)                                     |
| `res.collection.route`, `res.collection.line`, `res.establishment`, `res.surplus`                | Fontes de alimento            | [`modelos/fontes-alimento.md`](modelos/fontes-alimento.md)                                     |
| `pos.order`, `pos.order.line`                                                                    | POS — entradas e saídas em kg | [`modelos/pos.md`](modelos/pos.md)                                                             |
| `pos.config`, `pos.session`                                                                      | POS — entradas e saídas em kg | [`modelos/pos.md`](modelos/pos.md)                                                             |
| `res.partner.kg`, `res.partner.box.tracker`                                                      | POS — entradas e saídas em kg | [`modelos/pos.md`](modelos/pos.md)                                                             |
| `product.product`                                                                                | Catálogo (standard)           | os 24 produtos do POS em [`modelos/pos.md`](modelos/pos.md); o resto por escrever              |
| `res.users`, `res.groups`, `ir.module.category`, `ir.rule`, `ir.model.access`                    | Permissões                    | [`modelos/permissoes.md`](modelos/permissoes.md)                                               |
| `refood.financial.*`                                                                             | Financeiro                    | por escrever                                                                                   |
| `refood.vertical.assets`, `.lines`                                                               | Ativos                        | por escrever                                                                                   |

Um ficheiro por **conjunto de modelos que se leem em conjunto**, não um por modelo: o
`resource.calendar` sem as suas linhas de horário não se percebe. Abre-se ficheiro novo quando o
conteúdo pesa, não à partida.

---

## Convenções da base, válidas em todos os modelos

Isto vale para tudo o que está documentado nos ficheiros por área, e não se repete lá.

- **`false` é "sem valor", nunca `null`** — em qualquer tipo de campo. Num campo boolean, `false`
  é um valor legítimo e não quer dizer "vazio". O `packages/odoo` trata disto em `normalize.ts`
  (`nullable`, `many2one`, `many2oneId`).
- **Datas e datetimes vêm em UTC, sem marca de fuso**, como `'2026-08-29 09:14:22'`. Nunca passar
  a string ao `new Date(...)`, que a lê como hora local; usar o `odooDate` do `packages/odoo`.
  **Exceção que não é datetime:** as horas de `resource.calendar.attendance` são floats
  interpretados no fuso do calendário.
- **Campos `selection` são strings**, mesmo quando as chaves parecem números (`'0'`, `'1'`). O
  **valor** não é traduzido; o **rótulo** é.
- **Há campos traduzidos, e sem `lang` no contexto o Odoo lê-os em `en_US`** — não na língua do
  utilizador. Vale para as etiquetas de campo do `fields_get` e para o `name` de vários modelos,
  incluindo `product.product` e `pos.category`. **Nunca comparar nem filtrar por um nome
  traduzido: comparar ids ou códigos.** No catálogo de POS, 20 dos 24 produtos têm nomes sem
  relação entre as duas línguas — o produto que significa "sem excedente" chama-se _Falta
  Justificada (cópia)_ em inglês. Ver [`modelos/pos.md`](modelos/pos.md).
- **Campos calculados e não armazenados** (`store = false`) podem ser lidos, mas não servem para
  filtrar nem ordenar num `search_read`. `display_name` é sempre um deles.
- **`active = false` é arquivamento**: esses registos ficam fora das pesquisas por omissão, sem
  aviso. Para os incluir, `['active', 'in', [true, false]]`.
- **`company_id` é o núcleo**, e é por ele que passa a separação entre núcleos em toda a base. No
  `res.users` há dois: `company_ids` são os núcleos a que a pessoa tem acesso e `company_id` é o
  **núcleo por defeito** — e a diferença entre eles é o que separa um acesso de "Gestão" de um de
  "Utilizador" ([`modelos/permissoes.md`](modelos/permissoes.md)).
- **O espelho no `res.partner` leva só o número, por desenho.** Beneficiários e parceiros de apoio
  têm um contacto correspondente na lista geral, e esse contacto é deliberadamente vazio: o `name`
  é o código da ficha e não há email, telefone nem morada. O `res.partner` é transversal a todo o
  Odoo e aparece em sítios que não se controlam — o POS à cabeça —, por isso os nomes não foram
  para lá. Consequência: **o `res.partner` não é caminho para chegar a nenhuma destas fichas.**
  Ressalva importante: **o POS fura esta regra** — o `client_name` da `pos.order` guarda o nome
  legível, o do beneficiário incluído (ver [`modelos/pos.md`](modelos/pos.md)).
- **O `company_id` do `res.partner` é opcional, e não serve de âmbito.** Ao contrário das fichas
  — `res.beneficiary`, `res.food.source`, `pos.order` —, onde o campo é obrigatório, no
  `res.partner` o vazio quer dizer **"contacto partilhado por todas as empresas"**, não "de nenhuma".
  O próprio Odoo trata o vazio assim: a `ir.rule` do modelo é
  `['|', ('company_id','=',False), ('company_id','in',company_ids)]`, e deixa-o passar de propósito.
  Uma consulta com `['company_id', '=', empresa]` é portanto **mais apertada do que a regra da base**
  e descarta espelhos legítimos — em silêncio, com HTTP 200 e uma lista mais curta. Medido em
  setembro de 2026: **99 dos 1 028 espelhos de fontes** e **50 dos 3 853 de beneficiários** têm o
  campo vazio, e num núcleo eram **47 em 68**. Regra prática: **para saber a que núcleo pertence uma
  entidade, ler o `company_id` da ficha, nunca o do espelho** — e para ligar uma `pos.order` a uma
  ficha, entrar pelo `partner_id` da ficha em vez de sair do `partner_id` da encomenda.
  **Entrar pela ficha escolhe também o universo, e isso é uma decisão e não um detalhe:** uma
  `pos.order` de Entregas aponta para beneficiários **e** para parceiros de apoio, e entrar pela
  `res.beneficiary` deixa os segundos sem par. Ver
  [`modelos/beneficiarios.md`](modelos/beneficiarios.md).
- **Preenchimento baixo é o estado normal, não um defeito.** São poucos os núcleos que já usam tudo,
  e muitos campos só ganham uso quando o núcleo avança na implementação. Nenhuma app pode contar
  com um campo opcional estar preenchido, e as contagens destes documentos medem adoção tanto como
  estrutura.
- **E as contagens não medem o tamanho da operação.** Isto é uma base de **staging com alguns meses**,
  e **o Odoo ainda está por implementar numa grande parte dos núcleos**. Quando um destes documentos
  diz "9 núcleos" ou "32 dos 87", está a descrever quem já lá chegou — não quantos núcleos a Refood
  tem, nem quantos virão a usar aquilo. Servem para saber **com que formas de dados contar**, e para
  comparar áreas entre si; não servem para dimensionar nada.
- **Há modelos que só respondem com `allowed_company_ids` no contexto.** O `res.beneficiary`
  redefine o `search()` e filtra pelas empresas **ativas no contexto do pedido** — que não são as
  empresas a que o utilizador tem acesso. Sem esse contexto devolve lista vazia, HTTP 200, sem aviso
  nenhum; com um id de empresa a que o utilizador não tem acesso devolve `AccessError`. Só morde no
  `search`: o `read` e o `read_group` respondem à mesma, o que faz o problema aparecer num sítio e
  não noutro. Não é a `ir.rule` — outros modelos têm a mesma regra e respondem normalmente —, é o
  módulo, e por isso descobre-se modelo a modelo. Um modelo que pareça vazio pode estar só fechado.
- **Estes documentos não levam valores.** Entram nomes de campos, tipos, relações, proveniência e,
  quando ajuda, quantos registos estão preenchidos. Nunca entram nomes de pessoas, emails,
  telefones, moradas, identificadores ou qualquer outro dado de um registo. Vários modelos guardam
  dados pessoais, `hr.employee` à cabeça: o que se documenta é que o campo existe, não o que está
  lá dentro.

---

## Como levantar um modelo

```bash
node --experimental-strip-types scripts/explorar.ts <modelo> --todos --limite=0
node --experimental-strip-types scripts/explorar.ts ir.model.fields \
  --dominio='[["model","=","<modelo>"]]' --campos=name,ttype,modules,relation,store,required --limite=200
```

O primeiro dá os campos, tipos e relações; o `--limite=0` salta a amostra de registos, que aqui
não interessa. O segundo é o que distingue **campo standard de campo acrescentado pela Refood**:
a coluna `modules` nomeia o módulo que o declara (`resource`, `hr`, … = Odoo de origem; `refood`
e `refood_custom_views` = customizações).

**O `explorar.ts` não mete `allowed_company_ids` nos pedidos**, e por isso mostra vazios os
modelos fechados por regra de registo (ver as convenções acima). Se um modelo aparecer sem
registos, confirmar com uma leitura que passe `allowed_company_ids` antes de concluir que a tabela
está vazia.

**Lê em `pt_PT` e imprime a língua no cabeçalho** — `--lingua=en_US` para comparar. Isto mudou em
2026-09-08: **os oito documentos por área foram levantados antes, sem `lang`, portanto em
`en_US`**, e cada um leva a nota no topo. A estrutura, os tipos, as relações e as contagens não são
afectados pela língua; os nomes, sim. Ao repetir um levantamento, dizer sempre em que língua se
leu — senão os documentos deixam de ser comparáveis entre si.

O `help` dos campos costuma vir vazio nos campos acrescentados pela Refood — o significado desses
tem de ser confirmado com a equipa, e é registado aqui porque não existe em mais lado nenhum.

Vale a pena repetir o levantamento depois de qualquer atualização do Odoo: a arquitetura assenta
em não lhe tocar, mas o que lá está pode mudar sem nós.
