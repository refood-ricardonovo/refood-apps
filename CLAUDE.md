# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

npm workspaces monorepo: deployable apps in `apps/*`, shared libraries in `packages/*`. Dependencies install from the **root** (`npm install`); there is a single root `package-lock.json` and no nested lockfiles.

- `apps/tv` — Cloudflare Worker `refood-tv`, the dashboard screens in each núcleo. **Has its own `CLAUDE.md`** with the app's authorization and data rules; read it before touching anything under `apps/tv`.
- `packages/odoo` — `@refood/odoo`, the Odoo JSON-RPC client shared by the apps.
- `docs/` — `arquitetura.md` (architecture and decisions) and `modelos-odoo.md`, the index of the Odoo database survey. The models themselves are documented per area under `docs/modelos/`; read the index before querying a model you haven't seen, and add to it when you survey a new one. Structure only — these documents never carry record data.
- `migrations/` — the D1 schema, **shared by both apps and owned by neither**. Not under `apps/*`. See "The D1 schema" below.

## Authorization

The Workers authorize in **different and incompatible ways**:

- **TV** — device tokens, no expiry, scoped to a single núcleo, read-only. Details in `apps/tv/CLAUDE.md`.
- **Volunteer PWA** — volunteer sessions, which expire, and which write to Odoo route by route, each with a written decision.

Do not share authentication code between them, and do not carry an assumption from one into the other. The differences are not accidents to be smoothed over: a screen that anyone can walk past and a volunteer acting on their own account are different threat models, and the shapes they need — a token that never expires versus a session that must — do not factor into a common abstraction without weakening one of them.

The one rule they do share: **the scope comes from the authenticated subject — the token or the session — and never from a request parameter, wherever such a subject exists.** No route that serves data takes the núcleo, company, or volunteer it should act on as input. Holding a token and still being told which núcleo to read is the failure this rule exists to prevent.

The qualifier is not a loophole, it is the rule saying what it does before there is a subject. **Pairing a screen is the one place where no subject exists yet** — the television has no token, because the token is precisely what is being issued — so the núcleo can only come from a human choosing it. That is `POST /api/admin/emparelhamentos/aprovar` in `apps/tv`, and it is the only route in either app that reads a company from a request body. It is allowed to because it is fenced, on three sides, and each fence is part of the rule and not an implementation detail of that app:

- it demands the sede's shared admin secret;
- it acts only on a pairing that is still pending and inside its expiry window;
- it refuses any `company_id` that is not in the list of companies **the integration user can actually read**, so neither a number invented in the request body nor a real company this Worker is blind to ever reaches the database.

Move that route elsewhere — to a backoffice of its own, when monitoring justifies one — and the three fences move with it. The reasoning, and the rest of what that surface must refuse, is in `apps/tv/CLAUDE.md`.

This rule carries the whole weight, because **Odoo provides no second line of defence**: the integration user has access to every núcleo — deliberately, and permanently, since the alternative is one account per núcleo — so every record rule in the database evaluates against a user that sees everything. A missing `company_id` in a domain is not a narrower result, it is the whole base. See `docs/modelos/permissoes.md`.

## Commands

```bash
npm install                              # from the root; links workspaces
npm test                                 # all workspaces (Vitest, in packages/odoo)
npm run typecheck                        # all workspaces
npm test --workspace=@refood/odoo        # one workspace; add -- -t 'nome' to filter
npm run test:watch --workspace=@refood/odoo
npm run dev      --workspace=tv          # wrangler dev
npm run deploy   --workspace=tv          # wrangler deploy
npm run cf-typegen --workspace=tv        # wrangler types — regenerates worker-configuration.d.ts

node --experimental-strip-types scripts/explorar.ts <modelo>   # inspect a model's fields + a sample
npx tsc -p scripts                       # typechecks scripts/ — not covered by `npm run typecheck`
```

`scripts/` is developer tooling outside the workspaces: `explorar.ts` prints a model's `fields_get` and a sample of records, reading the credentials from `apps/tv/.dev.vars` and the URL/db from the `vars` in `apps/tv/wrangler.jsonc`. It authenticates as the integration user, which is **not** scoped to a núcleo — it reads the whole database, unlike anything the apps do. Run it with `--modelos=<filtro>` to find model names.

Tests are Vitest, and live in `packages/odoo/test/`; there is no linter. Prettier config (root `.prettierrc`: tabs, single quotes, semicolons, 140 print width) has no script — run `npx prettier --write <path>` directly.

## The D1 schema

**One database, one migrations folder, one ledger.** `migrations/` at the root holds the schema for both Workers. It is deliberately not under `apps/tv`: the TV and the volunteer PWA share a single D1, and D1 records what it has applied in a single `d1_migrations` table. Two folders against one database is mechanically possible — `migrations_table` gives each its own ledger — and is the wrong shape, because two ledgers have no ordering relative to each other, restart numbering at `0001` apiece, and leave "what is applied to this database?" with no single answer.

Each app reaches the folder from its own `wrangler.jsonc` with `migrations_dir`, set on **every** `d1_databases` entry — the top-level one and the one inside each `env`. That key is not inheritable: the array is replaced wholesale, never merged. An entry that omits it falls back to `./migrations` relative to that config file, and if such a folder exists but is empty Wrangler reports nothing to apply and the database is silently left behind.

**Migrations always go to `refood-db-staging` first. Only apply to `refood-db` (production) when explicitly asked to** — a migration being ready, reviewed, or already green on staging is not an instruction to apply it to production.

```bash
cd apps/tv                                                                  # run from an app: the config is what resolves the folder
npx wrangler d1 migrations list  refood-db-staging --remote --env staging   # dry run: what would apply
npx wrangler d1 migrations apply refood-db-staging --remote --env staging   # staging
```

**`--env staging` is what selects staging, not the database name.** Drop it and the name fails to resolve; the only name that resolves at the top level is `refood-db`, which is **production**. So a command that looks like it names staging can still land on production the moment the env flag is missing — always run the `list` first and read back the uuid it prints (`48465336…` is staging, `1756a0f6…` is production).

`wrangler d1 migrations apply` prompts for confirmation, and in a non-interactive shell it **auto-answers yes**. There is no dry-run flag on `apply`; `list` is the dry run.

**The ledger keys on the bare filename — no path, no checksum.** Wrangler decides what is outstanding by comparing those strings against the files it finds, which is why moving this folder out of `apps/tv` cost nothing and needed no reapplication. It is also why **renaming a migration that has already run will run it again**, against a schema that already has it. Never rename an applied migration; add the next one.

**The TV's tables are the TV's, and the folder no longer says so.** `dispositivos`, `emparelhamentos` and `tentativas_admin` belong to `apps/tv` alone — nothing else reads or writes them. They sit in a shared folder because the ledger is shared, not because the ownership is. Do not reach into them from another app: add a table.

## `packages/odoo` — Odoo JSON-RPC client

Zero-dependency, written against Web-standard `fetch`/`AbortSignal` so it runs unchanged in a Worker. Shipped as **TypeScript source** (`main`/`types` point at `src/index.ts`); there is no build step, because Wrangler's esbuild compiles it as part of the consuming Worker. A Node consumer would need its own transpile.

Facts about the protocol that the code encodes, and that any change must preserve:

- Odoo answers **HTTP 200 even for failures** — the error lives in the JSON body's `error` key, and the real exception type is in `error.data.name`. `faultToError` maps that name onto `OdooAuthError` / `OdooValidationError` / `OdooError`; `OdooTransportError` covers everything that never produced valid JSON-RPC (network, timeout, non-2xx, a proxy's HTML error page).
- `common.authenticate` returns `false` — not an error — when credentials are wrong. That is converted to `OdooAuthError`.
  **A wrong database name gives the same `false`, and this is measured, not assumed:** `erp.onrefood.com` answers `false` for a database that does not exist instead of raising, so a wrong `ODOO_DB` and a wrong password are indistinguishable from the response. The production base is `refood.flybyodoo.pt` — a name with dots that reads like a hostname, and not the `refood` the URL suggests. When authentication is refused, check the database name before hunting for a credential.
- The protocol is stateless: every `object.execute_kw` resends db + uid + password. The client caches the `uid` promise per instance (so concurrent first calls authenticate once) and retries a call once after re-authenticating if a cached uid stopped working — but only when the fresh uid actually differs, since an identical uid means a permissions problem that a retry would only repeat.
- The client's `context` is merged under any per-call `context`, so a call can override `tz` or a business flag without losing the defaults.
- **`lang` is a required parameter of every read, and it is refused in the client's config** — both in `OdooConfig.context` and inside a per-call `context`. Without `lang` Odoo does **not** fall back to the user's language: it reads `en_US`, and nothing about the response says so. It is a per-read parameter and not client state because the client is shared by the isolate: a language fixed at construction becomes a property of the process, which is harmless on the TV (always `pt_PT`) and wrong on the PWA, where two volunteers with different languages can be served by the same isolate. See `OdooLangOptions`.
- **Never compare or filter by a translated name — compare ids or codes.** 20 of the 24 POS products hold unrelated names across the two languages: the product meaning "no surplus" is called _Falta Justificada (cópia)_ in `en_US`. Field labels from `fields_get` are translated too (`company_id` is _Center_ in `en_US`, _Núcleo_ in `pt_PT`). Selection **values** are not translated; their labels are.
- There is deliberately **no `unlink` shortcut**: the apps do not delete Odoo records, and a public method would be easy to wire to a route by accident. `call(model, 'unlink', [ids])` still works, so the omission forces a decision rather than blocking one. A test asserts it stays off the prototype — do not "restore" it.

`createOdooClient(env)` builds a client from the Worker `Env` and throws naming any missing variable. Create one per request — `Env` only exists inside `fetch`, and construction is free since authentication is lazy.

`src/normalize.ts` holds the pure conversions between Odoo's serialization and idiomatic JS, and exists so those two conventions don't leak into business code:

- Odoo uses `false` — never `null` — for "no value" in **any** field type. Hence `nullable`, `many2one`, `many2oneId`. Do not use `nullable` on a boolean field, where `false` is a real value.
- Odoo serializes datetimes as `'2026-08-29 09:14:22'` and dates as `'2026-08-29'`, both **always UTC and with no timezone marker**. `odooDate` parses them with an explicit regex rather than `new Date(...)`, because JS engines read that space-separated format as _local_ time — which would silently shift every timestamp by the runtime's offset. Date-only values become midnight UTC. Out-of-range or malformed input returns `null` rather than a rolled-over date.
- `toOdooDate` is the exact inverse, for writing timestamps back. It formats from UTC components and truncates sub-second precision, so `odooDate(toOdooDate(d))` round-trips to the second.

## Conventions

- User-facing strings, code comments, and commit messages are in Portuguese (pt-PT); code identifiers are English. Match this when adding responses, comments, or commits.
- The team's shorthand, which shows up in requests: **VL** = voluntários (`hr.employee`), **BF** = beneficiários (`res.beneficiary`), **FA** = fontes de alimentos (`res.food.source`), **PA** = parceiros de apoio (`res.support.partner`), **núcleos** = the Odoo companies (`res.company`). The full table, and the two that mislead — a volunteer is an _employee_, not a user; a núcleo is a _company_ — are in `docs/modelos-odoo.md`.
- Secrets never go in `wrangler.jsonc` — its `vars` are public build-time values baked into the generated types. Use `.dev.vars` locally and `wrangler secret put` for deployed environments.

# Instruções de projeto — Refood

Regras a cumprir em todo o código destas apps. O detalhe, os números e a prova de cada uma
estão nos ficheiros de conhecimento (`arquitetura.md`, `modelos-odoo.md` e os documentos por
área). Aqui não se explica: exige-se.

## Âmbito e segurança

- O `company_id` vem do sujeito autenticado — token ou sessão — e **nunca de um parâmetro do pedido**,
  sempre que esse sujeito exista. Nenhuma rota que sirva dados aceita o núcleo como entrada: quem tem
  token não é informado de que núcleo há-de ler.
- **A única rota sem sujeito é a aprovação de um emparelhamento**, em `apps/tv`, porque o ecrã ainda
  não tem token — o token é o que ali está a ser emitido — e o núcleo só pode vir de uma escolha
  humana. Vale por ter três cercas, que acompanham a rota se ela mudar de casa: exige o segredo do
  admin, só actua sobre um pendente dentro do prazo, e recusa um `company_id` que não esteja na lista
  das empresas que o utilizador de integração consegue ler. Fora daí, nada copia esta forma.
- Toda a consulta leva `["company_id", "=", empresa]` no domínio **e** `allowed_company_ids: [empresa]`
  no contexto — inclusive nos modelos que respondem bem sem ele.
- **Toda a chave de cache leva o núcleo e a língua, e leva-os em claro.** A língua não é higiene:
  uma resposta guardada numa língua continuaria a ser servida depois de a língua mudar, e na PWA
  duas pessoas de línguas diferentes partilhariam a mesma entrada.
- **A regra do núcleo na chave, escrita por extenso.** A Cache API de um Worker é partilhada
  pelos televisores do mesmo POP: dois ecrãs de núcleos diferentes na mesma cidade batem na mesma
  cache. Uma chave sem empresa não devolve dados a mais — devolve **os do outro núcleo**. Vai no
  caminho e não dentro de um hash, para um erro se ver à vista desarmada.
- **A lista de empresas permitidas vem do `company_ids` do próprio utilizador, nunca de uma leitura de
  `res.company`.** Vale para qualquer construção de `allowed_company_ids` e para qualquer sítio onde se
  ofereça um núcleo a escolher — não é uma regra do dropdown da sede. Em staging a base tem 87 empresas
  e o utilizador tem 84: as três de fora são legíveis em `res.company`, uma delas com nome de núcleo e
  pendurada na empresa-mãe, e pedi-las em `allowed_company_ids` devolve
  `AccessError: Access to unauthorized or invalid companies`. Uma lista que saia de `res.company`
  oferece o que a app não consegue ler, e a falha aparece longe daqui — num televisor, semanas depois.
- Não contar com o Odoo para filtrar. O utilizador de integração vê **todos os núcleos em operação**,
  e por isso as `ir.rule` não separam nada: a separação por núcleo é inteiramente trabalho do Worker.
  Mas "vê tudo" não é literal — o teto é o `company_ids`, e o que estiver fora dele responde como
  responderia uma empresa vazia, sem maneira de distinguir as duas coisas.
- Não replicar os grupos e regras do Odoo como se fossem a especificação da app. Servem para responder
  a "quem, na operação, pode ver isto?" antes de expor um dado novo.
- Não inferir o papel de uma empresa a partir da hierarquia, do nome ou do NIF.
- A app TV nunca escreve no Odoo; no D1 escreve só o seu próprio estado técnico. Qualquer escrita da
  PWA no Odoo é decisão explícita, tomada rota a rota.
- Falar com o Odoo só através do cliente de `packages/odoo`. Nunca `fetch` direto ao `/jsonrpc`.

## O D1 e o Odoo — quem guarda o quê

- **O D1 guarda estado técnico e estado operacional que não existe no Odoo** — presenças, notas,
  recados. **Nunca duplica o que o Odoo já tem:** o que lá está lê-se de lá, e não há segunda fonte
  de verdade. O cache é cópia com prazo e sem autoridade, e não conta como duplicação.
- **Nunca nomes, emails ou moradas.** Uma pessoa ou entidade referencia-se pelo identificador da
  ficha, **por modelo** — e os dois campos que parecem servir de chave não servem:

  |                   | Chave no D1 | Porquê                                                            |
  | ----------------- | ----------- | ----------------------------------------------------------------- |
  | Voluntário        | `barcode`   | O código único da ficha                                           |
  | Beneficiário      | `id`        | O `number` identifica o **agregado**, não a pessoa, e não é único |
  | Fonte de alimento | `id`        | O `number` tem repetições                                         |

- **Toda a tabela operacional leva `company_id`.** Sem ele não há filtro por núcleo — é a mesma
  armadilha do `pos.order.line` e do `res.shift.log`, que não o têm. E o núcleo **nunca** se infere
  das três letras do `barcode`: isso é inferir estrutura a partir de uma string.
- **A proibição de texto livre é sobre colunas, não sobre conteúdo.** Nenhuma coluna existe para
  guardar um nome. Alguém vai escrever "a Maria não vem" numa nota e não há como o impedir — fingir
  que há é pior do que admiti-lo. A consequência é de exposição, e está na secção respectiva: texto
  livre escrito por voluntários não vai para um televisor sem decisão escrita na rota.
- **A TV nunca escreve no Odoo**, e no D1 escreve só o seu próprio estado técnico — sinal de vida,
  emparelhamento, trava de tentativas. Um ecrã de cozinha não tem pessoa identificada atrás, e um
  ecrã por onde qualquer um passa não marca presenças. **A PWA pode escrever no Odoo**, rota a rota,
  com decisão escrita.
- **"O Odoo não pode ser alterado" é sobre estrutura** — módulos, modelos, campos —, porque é gerido
  por um parceiro externo e não se quer vários intervenientes a mexer-lhe. **Não é sobre registos.**

**O risco que esta regra aceita, escrito para não ser surpresa.** O `hr.attendance` existe, está
instalado e **não está em uso** — é onde uma presença naturalmente cairia se alguém do lado do Odoo
decidisse usá-lo. Ver [`docs/modelos/voluntarios.md`](docs/modelos/voluntarios.md). Se isso vier a
acontecer, ficam **duas verdades sobre a mesma coisa**, e a reconciliação não terá chave limpa: o
`hr.attendance` não tem `company_id` e liga-se pelo `employee_id`. É decisão consciente, tomada com
o levantamento à frente, não um descuido.

**Por decidir, e nomeado para não se perder:**

- **Retenção e apagamento das presenças, notas e recados.** Quanto tempo vivem, quem os apaga, e o
  que acontece quando a ficha do voluntário passa a `active = false` no Odoo. Com a regra antiga
  isto não era pergunta — o D1 não guardava nada sobre ninguém.
- **O que fazer com um voluntário sem `barcode`.** Está preenchido em praticamente todas as fichas,
  não em todas, e é por ele que a regra manda referenciar uma pessoa.

## Ler o Odoo

- `fields` sempre explícito. Um registo completo traz dados pessoais e imagens em base64.
- Domínio apertado e `limit` em qualquer listagem.
- `false` é "sem valor", nunca `null` — exceto em booleans, onde `false` é um valor legítimo e não
  passa pelo `nullable`.
- **Exceção ao `false`:** `initial_hour`, `closest_shift` e `closest_initial_hour` usam a string `'N/A'`.
- Datas e datetimes são UTC sem marca de fuso. Passar sempre pelo `odooDate`, nunca ao `new Date`.
- Campos `selection` são strings, mesmo quando parecem números: comparar com `'0'`, não com `0`.
- Não filtrar nem ordenar por campos calculados e não armazenados. Ler, sim; entrar num domínio ou
  num `order`, não.
- `read_group` com mais do que um `groupby` leva `lazy: false`.
- `active = false` exclui registos das pesquisas por omissão, sem aviso. Decidir em cada rota se se
  quer o arquivado, e pedir `['active', 'in', [true, false]]` quando se quer.
- **Num televisor, nunca se apresenta um registo arquivado.** Informação histórica não é para
  aparecer ali. E **o filtro vai no domínio de quem faz o cartão, não na ficha lida depois**: as
  rotas (`res.delivery.route`, `res.collection.route`) **não têm `active`** — não são arquiváveis,
  são apagadas —, portanto a cláusula é a travessia `['<ficha>_id.active', '=', true]`. Filtrar
  depois de ler deixa o cartão no ecrã sem a ficha por trás: nas fontes viu-se como um cartão com
  nome e sem número, e nas famílias **não se via de maneira nenhuma**, porque o número vem da rota.
  Medido: 544 rotas de 3 252 (16,7%) apontavam para beneficiários arquivados, até 37 num só turno.
- **A `res.food.source` e a `res.beneficiary` devolvem ZERO sem `allowed_company_ids` no contexto** —
  não "menos linhas": nenhuma. É outra razão para a regra do âmbito não ter excepções, e é o que
  faz um levantamento pelo `explorar.ts` parecer uma tabela vazia.
- Uma resposta vazia não prova uma tabela vazia. Antes de concluir, confirmar com contexto.

## Identidade

- O `res.partner` não é caminho para chegar a um beneficiário, a um parceiro de apoio nem a uma fonte
  de alimento. Ler sempre do lado da ficha.
- O `barcode` identifica o voluntário. O `id` é interno e o nome não é único.
- O `number` do beneficiário identifica o **agregado**, não a pessoa. Para uma pessoa, o `id`.
- O `number` das fontes de alimento tem repetições. Não serve de chave.
- Nas fontes de alimento, excluir sempre os contactos — os que têm `contact_parent_id`, ou os que não
  têm `number`. Nada no modelo os marca.
- Não assumir que o `name` do voluntário já vem abreviado. Derivar o nome curto, de preferência do
  `full_name`.
- Nas tabelas de referência a única chave é o `name`, que é editável. Preferir sempre um boolean ou um
  `code` quando existir — `is_social_service`, não o texto do tipo.
- Ler `hr_email`, não `work_email`. Ler `x_function`, não `function`. Ler `marital_status_id`, não `marital`.

## Turnos

- Um turno é um `resource.calendar`, mas o horário vive nas `attendance_ids`.
- As horas das linhas são floats no `tz` do calendário, não UTC.
- Descartar as linhas com `display_type` preenchido: são separadores, não horário.
- Um turno que passa da meia-noite são duas linhas em dias consecutivos. Voltar a juntá-las ao mostrar.
- Os calendários standard herdados não são turnos, e `shift_name` não serve para os excluir num domínio.
- `resource_calendar_id` no singular, na ficha do voluntário, não é um turno. Ignorar.
- Zero em `ideal_volunteers`, `min_volunteers` e `max_volunteers` significa "sem limite".
- `res.shift.log` não tem `company_id`: restringir pelo voluntário ou pelo turno.
- Nunca usar o histórico de turnos para decidir se alguém ainda é voluntário. Isso é o `active` da ficha.

## POS

- Recolhas e Entregas são duas séries. **Nunca somar, nunca contar juntas, nunca uma só linha no gráfico.**
- O sinal do `total_in_kg` marca estorno, não sentido do movimento.
- O tipo de caixa não está na encomenda. Filtrar por `session_id.config_id.pos_type` ou por lista de
  sessões; nunca agrupar por `config_id`.
- Não ler `pos.session.is_delivery`. Rebenta assim que o resultado apanhe dois núcleos.
- Não ler `pos.session.company_id`, que não está armazenado.
- Nunca ler `pos.order.line` sem restringir pela encomenda: a linha não tem filtro por núcleo.
- Todo o campo monetário do POS é ruído. O único número com significado é o `total_in_kg`.
- Proteger qualquer total, média ou série de outliers. Nada valida o peso do lado do Odoo. **O tecto
  é por superfície e simétrico em `|kg|`** — 300 kg num cartão de entrega, 1 500 kg num de recolha —,
  e **o que passa dele não desaparece em silêncio:** não entra na soma e é contado à parte, para ser
  dito. Um valor absurdo escondido é um erro que ninguém corrige.
- Uma encomenda de Entregas pode ser uma falta. Contar encomendas não é contar entregas.
- **Uma encomenda não tem turno.** Tem `date_order` e mais nada — não é campo em falta, é ligação que
  o modelo não tem. Quem precise de a pôr num turno atribui-a pela hora **de Lisboa**, ao turno mais
  tardio já começado, e escreve que é heurística.
- **Uma encomenda sem rota é um "extra", e é a única forma de o saber.** Nada na base o marca. A
  comparação faz-se contra as rotas do **dia inteiro**, nunca contra o turno visível — senão os
  mesmos quilos aparecem em dois cabeçalhos do mesmo dia.
- **O estado nunca vem dos quilos.** Uma entrega registada como cabaz em unidades tem zero quilos e é
  uma entrega — 51 casos na base. Os quilos são etiqueta ao lado do estado, nunca o que o decide.
- **A soma leva os estornos com o sinal; o estado ignora-os.** A marca `REEMBOLSAR` diz que não houve
  acontecimento, não que não houve quantidade: excluir o estorno e contar o original é contar quilos
  anulados. E **os estornos não abatem no mesmo dia** — há pares separados por 16 dias.
- **Uma observação sobrepõe-se aos pesos**, e ao nível do cartão: um cartão com falta não mostra peso
  e contribui zero para o total, mesmo que a mesma entidade tenha uma entrega real no mesmo dia.
- **As três observações não são todas faltas.** O `OBS-SEM-EXC` significa _tratado_. Classificar
  pelo `default_code`, nunca pelo nome — que é traduzido e engana — nem pelo id, que não é portável
  entre bases. **Ler a categoria toda e tratar o desconhecido como falta:** errar para o lado
  visível.
- **Um total mostrado tem de ser a soma exacta do que está no ecrã.** Arredondar cada valor primeiro
  e somar depois, nunca o contrário: quem somar os cartões à mão tem de obter o cabeçalho.
- Não tratar uma sessão como um turno nem como um dia. A unidade é a encomenda e a sua data.

## Exposição de dados

- Nunca ler o `client_name` de uma encomenda de Entregas numa superfície pública. O `partner_id`
  também não resolve.
- Nos televisores, primeiro nome e inicial do apelido. Nada mais. **Isto é sobre pessoas
  singulares:** o nome de uma **entidade** — uma fonte de alimento, um parceiro de apoio — não é
  dado pessoal e aparece. Sai sempre do `name` da ficha, nunca do `client_name` nem do
  `res.partner`, e **num parceiro de apoio vão só as duas primeiras palavras** — três quando a
  segunda é um traço, que é a forma `SIGLA - Nome` —, porque nada no modelo obriga a que um
  parceiro seja uma instituição. Ver
  [`docs/modelos/parceiros-apoio.md`](docs/modelos/parceiros-apoio.md).
- Não ler dados pessoais sensíveis sem razão escrita na rota. Estão na mesma tabela que o resto.
- Os consentimentos da ficha não são um interruptor de permissões. Não os consultar como tal.
- O D1 nunca guarda nomes, emails nem moradas — ver "O D1 e o Odoo". Texto livre escrito por
  voluntários não vai para um televisor sem decisão escrita na rota.
- Credenciais nunca entram em ficheiros do repositório.

## Documentação

- Os documentos de modelos levam estrutura, tipos, relações e proveniência. **Nunca valores de registos.**
- As contagens desses documentos descrevem staging e adoção parcial. Não dimensionar nada com elas, e
  não escrever código que assuma um campo opcional preenchido.
- Uma armadilha nova do Odoo descobre-se modelo a modelo. Ao encontrar uma, registá-la no documento da
  área antes de contornar.
- Repetir o levantamento depois de qualquer atualização do Odoo.

## Design

O amarelo
#F5B72F nunca é cor de texto sobre fundo claro. É fundo, ou é acento sobre escuro.
