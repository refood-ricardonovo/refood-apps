# apps/tv — CLAUDE.md

Guidance for Claude Code when working in `apps/tv`. The repo-wide file is at the root; this one adds the rules specific to the TV app.

Worker `refood-tv`: the dashboard screens standing in each ReFood núcleo. Roughly 65 televisions, each paired to one núcleo, each in a room where people walk past.

## Authorization — the rules that must not bend

Every request authenticates with a device token in `Authorization: Bearer <token>`. A screen is paired once, with a 6-digit code; after that it keeps the token.

- **Tokens do not expire.** The only way out is the `revogado` column on the device row in D1. Check it on **every** request, not only at pairing — a revoked screen that keeps serving until some cache or session lapses is the failure this design exists to prevent.
- **One token grants one núcleo, and nothing else.** There is no "all núcleos" token, no admin token, no fallback.
- **`company_id` always comes from the token, never from the request.** No route may accept a company as input — not in the query string, not in the path, not in the body, not in a header. When a new route seems to need a company parameter, the answer is the token. A route that takes a company is a route that lets any paired screen read every núcleo.
- **Every Odoo query carries both scopes:**
  - `['company_id', '=', empresaDoToken]` in the domain, and
  - `allowed_company_ids: [empresaDoToken]` in the context.

  Both, on every call, with no exceptions. They are not redundant: the domain filters the rows the query asks for, while `allowed_company_ids` binds Odoo's own multi-company record rules, so a domain clause that is forgotten, mistyped, or bypassed by a related field still cannot return another núcleo's records. Neither alone is enough.

- **Read-only against Odoo. The TV never writes to it.** Use `searchRead`, `read`, `readGroup`. `create` and `write` exist on `@refood/odoo` but must not be reachable from any TV route; the client deliberately has no `unlink` at all.
- **In D1 the TV writes only its own technical state** — the liveness signal, the pairing flow, the admin attempt buckets. The schema is shared with the volunteer PWA and will hold operational state (presences, notes, recados) that this app may _read_ and show. It may not write it: a screen in a kitchen has no identified person behind it, so anything it wrote would be attributable to whoever walked past.

## Pairing

A screen pairs by proving it holds a secret it generated itself. The 6-digit code is public — it is on a screen in a kitchen — and only tells the office _which_ screen is asking; it never grants anything on its own. The schema behind this is `0002`: the pairing row keeps `segredo_hash`, never the secret, and the token is minted at collection, after the proof, straight into `dispositivos`.

- **A new secret for every pairing attempt, and the old one thrown away.** When a code expires and the TV asks for another, it generates 32 fresh bytes — it does not resend the secret it already has. Reusing it collides with the unique index on `segredo_hash` while the abandoned row is still `pendente` or `aprovado`, so the INSERT fails; and more to the point, a secret whose pairing was abandoned should stop opening anything the moment the TV walks away from it.
- **A 401 from a revoked device wipes the client clean.** Clear the secret, clear the token, and go back to the pairing screen carrying nothing. The screen then pairs as a new device and gets a new row; the old one stays behind, revoked. That leftover row is not litter to be tidied away — it is the record of the revocation, and the reason `revogado_em` exists.
- **Expiry is lazy, and the start-pairing route owns it.** Before issuing a new code, that route flips the pairing rows past `expira_em` to `expirado`. There is no cron and there must not be one: the partial unique indexes key on `estado`, not on the clock — SQLite will not take `datetime('now')` in a partial index — so a code or a secret is only released by that state change. The route that needs free values is the route that frees them.
- **No constant-time comparison anywhere. Do not add one.** Neither the secret nor the token is ever compared in our code: both are hashed with SHA-256 and looked up through a unique index, so SQLite either finds the row or does not. There is no byte-by-byte comparison to leak a timing signal, and writing one would only invent the risk it claims to defend against.
- **There is no `aprovado_por`, because there is nobody to record.** The admin surface is held by a single shared secret with no identities behind it, so a column naming the approver could only ever be a guess dressed as an audit trail. It becomes worth having the moment the admin has real identities to authenticate — until then, `aprovado_em` says when, and nothing claims to say who.
- **The screen's label is núcleo plus ordinal, built when it is shown.** `dispositivos` holds no name: the núcleo comes from resolving `company_id` against Odoo, and the ordinal is the device's pairing order within that núcleo. The reason is not that free text is banned from D1 — the shared schema now carries volunteer notes and recados — but that **this app writes only its own technical state**, and a screen label is not operational state. It is also nobody’s to write: the admin surface has no identities behind it, so a name typed there could only ever be a guess. That is the boundary the `nome` column of `0002` crosses, and why it went. **Count the ordinal over every row of the núcleo ordered by `criado_em`, revoked ones included** — the obvious implementation counts only the rows on screen, and that is wrong: hiding a revoked device would renumber every screen after it. Stable numbers with gaps are the goal, and a gap is information — someone revoked a screen there. A screen number that changes by itself, because a different screen was revoked, is worse than no number at all.

### The pairing routes — what each one refuses, and why

The shape of the endpoints is in `src/emparelhamento.ts` and will drift from any copy kept here. What follows is only the part that does not read off the code: the reason behind each choice that looks strange, so that nobody straightens it out.

**Starting a pairing.** Takes the SHA-256 of the secret, never the secret — the plaintext stays on the TV until collection, and that is the whole reason a code stuck to a kitchen wall is harmless. Refuses anything that is not 64 lowercase hex characters. Refuses (409) a secret that already holds a live pairing instead of duplicating it: either the request arrived twice or the TV reused a secret it should have thrown away, and in both cases the answer is a new secret, not a retry. This route also owns the expiry sweep, which runs before the draw — see the lazy-expiry rule above.

**Code collisions have a ceiling.** The draw can hit a code that is still live, and the unique partial index — not a prior read — is what says so. Retry a small number of times, then fail loudly. Never loop until it works: with the sweep running and 65 screens against a million codes, repeated collisions mean the sweep has stopped, and an unbounded loop turns that outage into latency, which is how it stays undiscovered for months.

**Polling makes two queries, and the second only when the first fails.** Happy path is one indexed lookup by `codigo` **and** `segredo_hash`; only if that returns nothing does a second query ask whether the code exists at all, with no state filter — a collected code with a wrong secret is the same signal and must not slip out through a `WHERE estado = ...`. That second query exists solely for the log line: a valid code with the wrong secret is someone trying to collect a token using the number on the wall.

**"No such code" and "wrong secret" share the body _and_ the status code.** Splitting them by status hands back through the front door exactly what the body is careful not to say. The difference lives in the log and nowhere else.

**A collected pairing answers `expirado` to polling.** Not because it expired, but because the only thing the TV can do next is ask for a new code. Whatever the client is told, the server logs the difference.

**Single-use is an atomic write, not a check.** The device insert and the pairing update go in one `batch`, and the insert is an `INSERT ... SELECT` conditioned on the same `WHERE` as the update, so nothing at all happens when the row is no longer collectable. Read-then-write leaves behind a device with a working token every time the race is lost. This was verified against the real D1 in September 2026: eight concurrent collections produced one token, one device row, and seven refusals. Do not rewrite it as a read followed by a write.

**The device's `company_id` comes from the `SELECT` inside the SQL**, never from the request body and never through JavaScript. A route that reads a company from anywhere else is a route that pairs a screen to another núcleo's data.

**The token is returned once and stored only as a hash.** There is no route that reads it back, and there must not be one: a screen that loses the response re-pairs, it does not ask again.

**The error text of a unique-index violation is load-bearing.** Recognising which index a collision hit is done by matching the message the D1 returns; the alternative — reading before inserting — trades an atomic guarantee for a race and is worse. Because the coupling would fail silently, turning a 409 into a 500 on a path rare enough to go unnoticed, a test pins both observed forms of that message against real SQLite. If the D1 ever changes the wording, that test goes red before an incident does.

**A page reload is not a new pairing.** The screen resumes the pairing it already has, with the secret it already generated, and only generates a new secret when it actually starts a new pairing — a code expiring, a collection failing. Generating one on every load would look like the safer rule and would strand a live row on the database every time a television reboots, which they do nightly.

**Orphan devices are the heartbeat's job, not a hand-cleaning job.** A TV that collects a token and loses the response re-pairs and leaves behind a device row whose token nobody holds; it will never report in. Do not sweep it from the collection route — the fix belongs to the liveness signal, where a device that has never reported after N days can be revoked automatically. Until that exists, they are harmless and visible.

**The route tests run the real SQL.** `test/d1-falso.ts` puts a minimal D1 over `node:sqlite` and applies the actual migration files, because what is delicate in these routes lives in the schema — the partial unique index, the conditional insert, the sweep — and none of it survives being replaced by a stub. What that double cannot show is the D1's own transactional behaviour, which is why the concurrency check above was run against the real thing.

**It applies every migration in the root folder, including tables this app never touches, and that is deliberate.** A shared database tested against half its schema is worse than one not tested at all: a migration from the volunteer PWA that collides with what the TV reads has to come up here, in red, instead of in production. The price is that another app's migration can break this app's tests — that is the net doing its job, not a coupling to engineer away.

## The sede's routes — `/api/admin/*`

They live in this Worker on purpose: same D1, same origin, same deploy, and approving a pairing happens once per device. What will justify an application of its own is monitoring 65 screens, not this.

One shared secret, held in `wrangler secret`, no identities behind it. That is why there is no `aprovado_por` — see the pairing rules above — and why the whole surface is authenticated in one place, at the entry to `/api/admin/`, so that a new route is born protected instead of being born open until someone remembers the missing line.

**Two rules that hold everywhere else are broken here, deliberately. Both are fenced.**

- **The `company_id` arrives as a request parameter.** This is the one route where it must: someone at the sede is assigning a núcleo to a screen that has none, and there is no token to read it from — the token is precisely what is being issued. The fences are that the route demands the admin secret, acts only on a pairing that is still `pendente` and inside its window, and refuses a `company_id` that is not in the list of companies **the integration user can read** — which is narrower than the companies that exist. A number invented in the request body does not get written to the database, and neither does a real company this Worker is blind to. Nothing else in either app may copy this shape.
- **The list of companies comes from the user's own `company_ids`, never from reading `res.company`.** Staging has 87 companies and the integration user has 84; one of the three outside is named `PT Núcleo <name>` and hangs off the parent company, indistinguishable in a dropdown from a real núcleo. Approving a screen for it would mint a working token for a company no read here can ever resolve, and the failure would surface weeks later on the television as an Odoo error. `listarNucleos` reads `res.users` first for exactly this reason, and fails closed — no user, no list; empty `company_ids`, empty list — because the tempting fallback is "then show them all", which is the bug.
- **The Odoo query carries no company scope.** Listing the núcleos to choose between cannot be done from inside one of them. It is a catalogue read — `id`, `name`, `center_prefix`, nothing else — from a model with no personal data, and it is the only Odoo call in this app that is not scoped to a single núcleo.

**The admin secret is compared as a hash, not as a string.** Unlike the TV's token, which is looked up in a unique index, this really is two values compared in memory, and comparing them in the clear is the textbook timing leak. Comparing their SHA-256 digests means the timing tells an attacker how many characters of a _hash_ matched, which buys them nothing without inverting SHA-256 — and it costs less than a hand-written constant-time comparison and the argument about whether it is really constant-time.

**No secret, no entry.** An unset `ADMIN_SECRET` refuses everyone and logs it. A missing configuration must never be the thing that opens the door.

**Failed authentications are rate-limited, and the limit is checked before the comparison.** Four people share one password, so without a brake the only defence is the length of the secret and the guesses are unlimited and silent. Ten failures within fifteen minutes shut that origin out for fifteen more, and while it is shut the presented secret is not compared at all — comparing anyway would hand back, in the difference between the answers, the guessing oracle the brake exists to close. A correct entry clears the count, and the window restarts from the first failure, so someone who mistypes today and again next week never approaches the limit. The state is a counter in D1 (), keyed by the SHA-256 of the IP **with the admin secret mixed in** — a bare hash of an IPv4 is brute-forced in seconds, and this way the database still holds nothing that identifies anyone. A locked-out person waits, or comes from another connection; there is no unlock button, and adding one means adding an identity to authenticate against.

**The ten-second refresh reconciles the pending list; it does not rebuild it.** Choosing a núcleo from 87 takes longer than ten seconds, so rebuilding the rows threw the choice away mid-selection. A row in use — a núcleo already chosen, or the dropdown focused — is left exactly as it is, contents and all; the rest refresh around it. While somebody is working a dropdown the whole refresh waits — no fetching, no drawing — up to a two-minute ceiling so that a field somebody walked away from cannot freeze the page silently. **There is no way to know whether a native select is open**: the menu is drawn by the operating system, outside the DOM, with no event and no property to ask. So two signals stand in for it, and either one is enough: focus on the select (verified in Chrome to survive while the menu is open) and a thirty-second window opened by a pointerdown or keypress on it, for browsers where opening the menu takes focus away from the page. The check runs twice per refresh — once before fetching and again before drawing — because the seconds between request and response are exactly when somebody reaches for the dropdown. A row whose pairing stops being pending while somebody holds it is not yanked away: it is marked for one cycle — ten seconds to read what happened, saying only that it is no longer waiting, since expiry and a colleague approving first are indistinguishable from here — and then it goes, because what is worth protecting is a choice in progress, not the remains of one. Do not simplify this back into a `replaceChildren`.

**Approving does not extend the window.** `expira_em` stays exactly as it was, and a pairing approved with two minutes left has two minutes left. The `WHERE` of the approval repeats both the state and the deadline, because minutes pass between the sede seeing the list and clicking the button.

**The list of pendentes hides what has expired but does not mark it.** Expiry is lazy and its owner is the start-pairing route; a second sweep here would only spread that ownership around. This page filters what it shows with the same `hasExpired` the rest of the app uses.

**Revoking fills `revogado_em`, and only the first one counts.** A second click does not rewrite the date to the time of the second click — the moment of the first revocation is the record.

**The núcleos list is cached for ten minutes.** `res.company` has **no `active` field**: companies are never archived, and nothing in the database says a núcleo stopped operating. So all of them are listed and the choice is human — no app here infers a company's role from its hierarchy, its name, or its NIF. **The query asks for no ordering, and nothing reorders the list afterwards.** The companies are ordered by hand in Odoo — that is what the model `sequence` is for — and that is the order the people at the sede already know from working there. An alphabetical sort of our own, in the query or in the page, produces a list that does not match the one they see in Odoo, and undoes an arrangement somebody made deliberately. `center_prefix` is still fetched: it is the núcleo readable identifier, distinct across all of them, and monitoring will want it.

## Data routes — the middleware makes the scope rule structural

Every data route goes through `servirRotaTv` in `src/sessao.ts`, which resolves the token and hands the route a `ContextoTv`. The point is not that the token gets validated — it is that a route **has no way** to read a núcleo from anywhere else.

- **A route receives no `Request`.** There is no body and no query string in scope, so reading a `company_id` from the request is not a rule to remember, it is a compile error. When a route genuinely needs the request — a POST carrying data — it is added to the context deliberately, and that route becomes the one to read carefully.
- **A route receives no `Env`.** Without it there is no way to build an unscoped Odoo client, which is the other way the scope could have been lost.
- **The only path to Odoo is the `LeitorDoNucleo`**, built from the token's company. Every read carries both halves of the scope — the domain clause and `allowed_company_ids` in the context — and there is no method that accepts a company, so nothing can point it at another núcleo.
- **`fields` and `limit` are required by the type.** The two rules most easily forgotten — never read a whole record, never list without a ceiling — are now enforced by the compiler rather than by review.
- **The caller cannot pass a `context`, nor a `lang`.** Letting a context through would let a route override `allowed_company_ids`, which is half of the separation. The language lives on the leitor, which receives it from `servirRotaTv` — `LINGUA_DA_TV`, `'pt_PT'` — for the same reason the company does: a route neither chooses it nor can swap it. It is also in the cache key, in clear, right after the núcleo.
- **`res.company` is scoped by `id`, not `company_id`** — it _is_ the company, and a `company_id` clause on it fails rather than filtering. That mapping lives in one place in `sessao.ts`; do not work around it in a route.

**Revocation is checked on every request, and the answer to a revoked token is identical to the answer to an unknown one.** The distinction exists only in the log — a screen that was ours and keeps knocking is worth a line; telling the caller which of the two it was is worth nothing to anyone but an attacker.

## The liveness signal

The TV posts to `/api/sinal` every five minutes, and the middleware writes `visto_em` on any authenticated request — but only when the previous mark is older than four minutes. Two consequences worth keeping:

- **The number of writes depends on the clock, not on traffic.** When the dashboards start polling every 25 seconds, this still writes once every few minutes per screen instead of once per request.
- **Five minutes is what bounds two different things**: how long a revoked screen keeps showing what it had — the revocation arrives as the 401 on the next signal — and how long monitoring takes to notice a screen that went dark. At 65 screens running about five hours a day it comes to roughly 3,900 requests a day, a fraction of what the dashboards will ask for on their own.

A revoked device is never given a fresh `visto_em`: insisting must not make a screen look alive again.

## Diagnostics

`/api/teste` is gone — it read `res.users` with no scope at all and was never going to production. `/api/version` moved to `/api/admin/version`, behind the sede's secret: still the quickest way to tell whether the Odoo link is up, but somebody else's server version is not a conversation for anyone who happens to pass by. `/api/health` answers `ok` and the time, and nothing else — no version, no addresses, nothing describing what is behind it. It is the only open route, and it exists so an external probe can call it.

## Data and caching

- **One request returns every dashboard.** Switching is then instant and local, with no round-trip.
- **Dashboards change only when someone presses the remote (`o comando`).** No auto-rotation, no carousel, no timed cycling — that is a product decision, not an omission to be helpfully filled in.
- **Cache API, TTL ~25s, shared across all screens.** The point is that 65 televisions asking at once cost roughly one Odoo query, not 65.
- **Key the cache by núcleo — never by token, never globally.** Per-token keys give 65 separate entries and destroy the sharing the cache exists for; a global key serves one núcleo's data to another. The payload is company-scoped, so the key must be too.
- **Never render full names — first name and initial only.** These screens face a room that anyone can walk through, so the privacy boundary is the screen itself, not the login. **This is about natural persons.** An _entity_ — a food source, a support partner — is not personal data and its name appears; it comes from the ficha's own `name`, never from a `pos.order`'s `client_name` and never from `res.partner`. A support partner's name is cut to **the first two words — three when the second is a dash**, because nothing in `res.support.partner` forces a partner to be an institution — 651 of 1 014 have no type at all, and the field a beneficiary uses to point at the partner who accompanies them says "typically the social worker". Two words identify _Centro Paroquial_ and do not spell anybody's full name; the dash exception costs nothing, because a person's name does not carry a lone dash in second position, so the third word is only ever won by a name that was already an entity's.

### The panels have two origins, and the second one is a POS order

A card used to be born from a route — `res.delivery.route` or `res.collection.route` — with the POS only painting state on top. **An "extra" is born from a `pos.order` with no route behind it**: a delivery to a beneficiary with no route today, a delivery to a support partner (who never has one), a collection to a source outside the day's schedule. Nothing in Odoo marks an order as extra; not matching a route is the whole definition.

Three things about that shape are load-bearing, and each is written where it happens:

- **What counts as extra is decided against the whole day's routes, never the visible shift.** Against the shift, a family served in the 18:00 shift shows green there _and_ as an extra in the 20:00 one — the same kilos in two headers of the same day.
- **An order has no shift.** It is attributed to the latest shift already started at its `date_order`, compared in Lisbon wall-clock. That is a heuristic and must stay labelled as one; the alternative — showing the day's extras in every shift — breaks the rule that a panel's total is the exact sum of what is on screen.
- **An extra is not a state.** It is always _entregue_/_recolhido_ or _falta_, never _por entregar_ — the order is what makes it exist. It travels as its own field on the card, keeps the state's colour, and is marked on screen by the **dotted left bar** — the same bar every card already has, with a different texture, which distinguishes without spending colour or space. It carries no hour, and the line that frees up is the one a support partner's name occupies. Do not fold it into `estado`: that slot is reserved for the fourth state (_à espera_, when the PWA records who arrived).

**An order that resolves to nobody — almost always an archived ficha, which a television never shows — is counted and said in the header**, by the same rule as an out-of-scale weight. Kilos that vanish quietly are an error nobody corrects.

## Worker structure

- `src/index.ts` is the sole entry point, a `satisfies ExportedHandler<Env>` default export. Routing is hand-rolled `URL.pathname` matching; unmatched requests 404. No router library. API routes live under `/api/*`, which the 404 fallback message assumes.
- `public/` is served through Wrangler's `assets` binding. Assets are matched **before** the Worker's `fetch`, so a Worker route can never shadow a file in `public/`.
- `wrangler.jsonc` is the source of truth for runtime config: the D1 binding `DB` (device tokens, with the `revogado` column), its `migrations_dir` pointing out of the workspace at the root `migrations/`, and the vars `ODOO_URL` / `ODOO_DB`.
- `worker-configuration.d.ts` is **generated — never hand-edit it.** It defines the global `Env` that `src/index.ts` types against, and `tsconfig.json` lists it in `compilerOptions.types`. After changing any binding or var in `wrangler.jsonc` — or after creating `.dev.vars` — run `npm run cf-typegen --workspace=tv`, or the types silently drift from the config.

The Odoo credentials are secrets, not vars: copy `.dev.vars.example` to `.dev.vars` for local work, and use `wrangler secret put` for deployed environments.

## D1 migrations

**The schema is not in this workspace.** It lives in `migrations/` at the **root of the monorepo**, because the D1 is shared with the volunteer PWA and `d1_migrations` is a single ledger. The commands, the staging-first rule, and the two traps that go with them — the `--env` flag, and `apply`'s auto-yes in a non-interactive shell — are in the root `CLAUDE.md`, under "The D1 schema". Read it before touching the schema; nothing about it is repeated here.

**What that costs, and this pointer is the whole mitigation:** `npm run deploy --workspace=tv` no longer describes a complete deployment of this app. The Worker ships from here, the schema it runs against ships from the root, in a separate step that cannot be inferred from anything inside `apps/tv`. That is the price paid for a shared database with one ledger, and it was paid deliberately. Do not let this paragraph rot.

`wrangler.jsonc` reaches the folder with `"migrations_dir": "../../migrations"`, set on the top-level `d1_databases` entry **and** again inside `env.staging` — the key is not inheritable, and an entry without it falls back to a `./migrations` that no longer exists here.

**`dispositivos`, `emparelhamentos` and `tentativas_admin` are this app's tables.** Nothing outside `apps/tv` reads or writes them, and nothing should. They live in the shared folder because the ledger is shared, not because the ownership is — the path used to carry that fact for free, and no longer does, so it is written down instead.
