# Permissões — quem vê o quê

`res.users`, `res.groups`, `ir.module.category`, `ir.rule`, `ir.model.access`. Índice e convenções
transversais em [`../modelos-odoo.md`](../modelos-odoo.md).

> **Levantado em `en_US` — não confiar nos nomes.** O `explorar.ts` corria sem `lang` no contexto,
> e nesse caso o Odoo **não** usa a língua do utilizador: cai no `en_US`. As etiquetas de campo e os
> valores de campos traduzidos que aqui aparecem são portanto os ingleses — onde este documento diz
> *Center*, quem trabalha no Odoo vê *Núcleo*. **A estrutura, os tipos, as relações e as contagens
> não são afectados.** O `explorar.ts` passou a ler em `pt_PT` e a imprimir a língua no cabeçalho
> (`--lingua`); quando este levantamento for repetido, os nomes passam a ser os que as pessoas vêem.

---

## São duas perguntas, não uma

O acesso de um voluntário resolve-se em duas perguntas independentes, e confundi-las é a origem de
quase todos os enganos nesta área:

1. **A que núcleos tem acesso?** — o multi-empresa do Odoo, `company_ids` e `company_id` no
   `res.users`.
2. **Que dados desses núcleos é que pode ver?** — os **grupos funcionais**, que decidem, área a
   área, se o acesso vale para **todos** os núcleos permitidos ou **só para o núcleo por defeito**.

A segunda não é uma subdivisão da primeira. Um voluntário com acesso a cinco núcleos pode ver os
beneficiários dos cinco e os voluntários de um só.

---

## A que núcleos: `company_ids` e `company_id`

É o mecanismo standard do Odoo, sem alterações:

| Campo do `res.users` | O que é |
|---|---|
| `company_ids` | **Os núcleos a que tem acesso.** É o limite exterior de tudo |
| `company_id` | **O núcleo por defeito** — um só, e é sempre um dos `company_ids` |

Dos **453 utilizadores internos**, **420 têm um único núcleo** e 33 têm mais do que um (o máximo é
87, a base inteira). Ou seja: **para a esmagadora maioria dos voluntários, a distinção
Gestão/Utilizador não muda nada** — o núcleo por defeito é o único que têm. A distinção só morde
nesses 33, que são precisamente as pessoas com funções de coordenação.

Em nenhum dos 453 o `company_id` está fora dos `company_ids`.

**No pedido, quem manda é o `allowed_company_ids` do contexto**, e tem de ser um subconjunto dos
`company_ids`: pedir uma empresa fora deles devolve `AccessError: Access to unauthorized or invalid
companies` — não uma lista vazia, um erro. Vários modelos, além disso, devolvem **zero sem aviso**
quando o contexto vem vazio (ver a convenção no [índice](../modelos-odoo.md) e
[`beneficiarios.md`](beneficiarios.md)).

---

## As equipas funcionais são categorias de grupos

Cada área da operação é uma `ir.module.category` com **dois grupos: `Manager` e `User`** — na
interface, em português, **"Gestor"** e **"Utilizador"**. **Os nomes na base são em inglês**; o que
se vê no ecrã são traduções.

| Categoria (base) | Na interface | Gestor | Utilizador |
|---|---|---|---|
| `Management` | **Sistemas de Gestão** | **8** | — |
| `Coordination` | Coordenação | 12 | 108 |
| `Beneficiaries Management` | Gestão de Beneficiários | 35 | 258 |
| `Volunteers Management` | Gestão de Voluntários | 15 | 230 |
| `Shift Management` | Gestão de Turnos | 13 | 235 |
| `Food Source Management` | Gestão de Fontes de Alimentos | 14 | 179 |
| `Community Support Management` | Gestão de Apoio de Comunidade | 6 | 24 |
| `Operational Resources Management` | Gestão de Recursos Operacionais | 4 | 20 |
| `Training & Quality Management` | Gestão de Formação & Qualidade | 6 | 8 |
| `Communication Management` | Gestão de Comunicação | 1 | 5 |
| `Financial Management` | Gestão Financeira | 2 | 6 (+1 de validação) |

**O `Manager` implica sempre o `User` da mesma categoria**: Gestão é Utilizador mais alguma coisa,
nunca outra coisa. E um utilizador tem **um nível por área** — pode ser Gestor de Beneficiários e
Utilizador de Voluntários ao mesmo tempo, que é o caso do exemplo mais comum.

---

## Onde está, exatamente, a diferença entre Gestão e Utilizador

Está nas `ir.rule`, e o desenho repete-se modelo a modelo em **três camadas**:

| Camada | Domínio | A quem se aplica |
|---|---|---|
| **Regra global** | `company_id in company_ids` | A toda a gente. É o teto: **nunca se vê fora dos núcleos permitidos** |
| **Regra do Utilizador** | `company_id = user.company_id.id` | Ao `Internal User`, ou seja, a todos |
| **Regra do Gestor** | `(1, '=', 1)` | Só aos grupos `Manager` da área |

O Odoo junta-as assim: **as globais em `AND`, as de grupo em `OR`.** Daí sair exatamente o
comportamento descrito pela operação:

- **Sem grupo de Gestão** — vale só a regra do Utilizador: `company_ids` **e** núcleo por defeito →
  **só o núcleo por defeito**.
- **Com grupo de Gestão** — `(1,'=',1)` entra em `OR` e anula a restrição do defeito, mas a global
  continua a valer → **todos os núcleos permitidos, e mais nenhum**.

"Gestão" **não é acesso a tudo**; é acesso a tudo aquilo a que a pessoa já tinha acesso pela
`company_ids`.

Como está montado em cada modelo:

| Modelo | Regra do Utilizador | Grupos com `(1,'=',1)` |
|---|---|---|
| `res.beneficiary` | `company_id = user.company_id.id` | Gestão de Beneficiários / Gestor, **Sistemas de Gestão** |
| `res.food.source` | `company_id = user.company_id.id` | Coordenação / Gestor, Gestão de Fontes / Gestor, **Sistemas de Gestão** |
| `res.support.partner` | `company_id = user.company_id.id` | Recursos Operacionais / **Gestor e Utilizador**, Apoio de Comunidade / Gestor, **Sistemas de Gestão** |
| `res.functional.team` | `company_id = user.company_id.id` | `Read All / Funcional Team`, **Sistemas de Gestão** |
| `hr.employee` | `company_id = user.company_id.id` (grupo `Employees / Officer`) | `Read All / Employees` |

Todas estas regras aceitam também `company_id = False` — um registo sem núcleo é visível para todos.

---

## Os grupos `Read All (Avoid User Rule)`

Os voluntários não seguem a forma das outras áreas, e o nome do grupo diz porquê: a regra de
"vê tudo" do `hr.employee` **não está pendurada em `Gestão de Voluntários / Gestor`**, está num
grupo técnico à parte, `Read All (Avoid User Rule) / Employees` — literalmente, "ler tudo, evitar a
regra do utilizador".

São três, e são implicados pelos grupos de Gestão que precisam deles:

| Grupo | Utilizadores | Implicado por |
|---|---|---|
| `Read All / Employees` | 34 | Coordenação, Voluntários, Turnos, Formação & Qualidade, Sistemas de Gestão |
| `Read All / Funcional Team` | 71 | Quase todos os Gestores |
| `Read All / Resource Calendar` | 35 | Coordenação, Voluntários, Turnos, Recursos Operacionais, Formação & Qualidade, Sistemas de Gestão |

O efeito final é o mesmo — **Gestão de Voluntários / Gestor vê os voluntários de todos os núcleos
permitidos** —, mas a ligação é indireta. **Quem quiser saber se alguém vê os voluntários de outro
núcleo tem de olhar para o grupo implicado, não para o nome da equipa funcional.**

---

## `Sistemas de Gestão` é o utilizador master

`Management / Manager`, **8 utilizadores**. Está em **todas** as regras de Gestor de todos os
modelos, implica os três `Read All`, e tem ainda ACL direto de leitura e escrita nos modelos
principais.

**Vê e escreve tudo, em todos os núcleos permitidos, independentemente de qualquer outra
permissão.** Não há como restringi-lo por área: qualquer combinação de grupos que inclua este é
acesso total.

---

## Onde o desenho não é uniforme

Quatro coisas que fogem ao padrão, e que interessam mais do que o padrão:

**1. Um "Utilizador" que vê todos os núcleos.** `Operational Resources Management / User` está na
lista da regra `(1,'=',1)` dos parceiros de apoio, ao lado dos Gestores. São 20 pessoas que, na
interface, aparecem como Utilizador e que, nos parceiros de apoio, se comportam como Gestão. Não há
nada no ecrã que o revele.

**2. O POS ignora a distinção por completo.** A `pos.order` tem **uma regra só**, global,
`company_id in company_ids`, sem nenhuma regra de núcleo por defeito. Quem tem acesso ao POS vê as
encomendas de **todos** os núcleos permitidos, seja Gestão ou Utilizador. A `pos.session` faz o
mesmo por `config_id.company_id` (ver [`pos.md`](pos.md)).

**3. Modelos sem regra nenhuma.** Não têm uma única `ir.rule` — **nada os filtra por núcleo**:

`resource.calendar`, `resource.calendar.attendance`, `res.shift.log`, `pos.order.line`,
`res.partner.kg`, `res.partner.box.tracker`.

E os ACL de três deles — `res.shift.log`, `res.partner.kg` e `res.partner.box.tracker` — dão
**leitura e escrita ao `Internal User`**, isto é, a qualquer voluntário com conta. Nos turnos
(`resource.calendar`) o `Internal User` tem leitura. **Um voluntário de um núcleo lê os registos de
todos os outros nestes modelos**, e nos três primeiros também os escreve.

O `pos.order.line` é o caso a lembrar quando se escrever código: a **encomenda** está filtrada por
núcleo, a **linha** não. Ler linhas diretamente contorna a regra da encomenda.

**4. `res.partner` é largo por natureza.** A regra global deixa passar tudo o que não seja
`partner_share`, mais o que não tem empresa. É mais uma razão para o espelho anónimo descrito nas
convenções do índice — e mais uma razão para o `client_name` do POS ser um problema
([`pos.md`](pos.md)).

---

## O que isto significa para as apps

**O utilizador de integração das apps tem `Management / Manager`** — é master — **e 84 das 87
empresas** em `company_ids`.

**As três de fora foram apuradas em setembro de 2026, e uma delas engana.** Nenhuma tem turnos
(só o calendário `Standard 40 hours/week` que o Odoo cria com qualquer empresa, sem linhas de
horário) nem uma única linha de `res.shift.log` — e estes são dois dos modelos **sem `ir.rule`**,
listados mais abaixo, portanto a leitura não está a ser filtrada e o vazio é real. Duas não são
núcleos: uma é um artefacto de teste assumido, outra tem nome de estabelecimento e não está
pendurada na empresa-mãe. **A terceira segue a convenção `PT Núcleo <nome>` e tem `parent_id` para
a empresa-mãe** — num dropdown é indistinguível de um núcleo a sério. É uma casca provisionada e
nunca operada, ou operada noutro sítio; a razão está por apurar com o parceiro.

Para tudo o que não seja `resource.calendar` e companhia, a diferença entre "esta empresa está
vazia" e "esta empresa está fora do `company_ids`" **não é observável** a partir da app: a regra
global é `company_id in company_ids`, e o que está fora responde zero registos, sem erro. Daí a
regra do `CLAUDE.md`: a lista de empresas permitidas vem sempre do `company_ids` do utilizador,
nunca de uma leitura de `res.company`.

**Isto é desenho, não acidente, e não vai mudar.** A conta em uso vai ser substituída por uma
dedicada, mas essa terá igualmente acesso a **todos** os núcleos: a alternativa seria uma conta por
núcleo, com 87 credenciais a gerir e a escolher por pedido. A troca muda a titularidade da conta,
não o seu âmbito — e por isso nenhuma app pode ser escrita a contar que um dia o Odoo passe a
filtrar. Ver [`../arquitetura.md`](../arquitetura.md).

Consequência, e é a única que interessa reter:

> **O modelo de permissões do Odoo não protege as apps de nada.** Todas as regras deste documento
> se avaliam contra o utilizador autenticado, e esse utilizador vê tudo. A separação por núcleo de
> um Worker é **inteiramente** trabalho do Worker: o `company_id` no domínio e o
> `allowed_company_ids` no contexto, **vindos sempre do token ou da sessão, nunca de um parâmetro do
> pedido** (ver o `CLAUDE.md` da raiz e o de `apps/tv`).

Duas leituras erradas a evitar:

- **"O Odoo já filtra, basta pedir"** — não filtra, porque quem pede é master.
- **"Basta replicar os grupos"** — replicar não chega e não é o mesmo problema. Uma app tem os seus
  próprios sujeitos (um ecrã de TV não é uma pessoa) e as suas próprias regras. Estes grupos são
  **contexto para perceber o que a operação considera legítimo**, não uma especificação a copiar.

Onde eles são mesmo úteis é a responder a "quem é que, na operação, pode ver isto?" antes de expor
um dado novo: se a resposta na base é "só o Gestor de Beneficiários", uma app que mostre o mesmo a
qualquer voluntário está a alargar o acesso, mesmo que ninguém tenha reparado.

---

## Pontos em aberto

- **Se o `Operational Resources Management / User` na regra dos parceiros de apoio é intencional.**
  Parece engano de configuração; se for, corrigi-lo muda o que 20 pessoas veem.
- **Os modelos sem `ir.rule`** — se é decisão consciente (turnos são informação partilhada entre
  núcleos, o que é plausível) ou esquecimento. Nos três com escrita para `Internal User`, o mais
  provável é esquecimento.
- **O grupo `Volunteer Refood`, sem categoria**, com leitura em `hr.employee`. Por levantar.
- **`Point of Sale / Utilizador (cópia)`** — um grupo duplicado do POS com 48 utilizadores, a par do
  `Point of Sale / User` com 31. Saber qual é o bom.
