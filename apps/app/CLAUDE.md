# apps/app — CLAUDE.md

Guidance for Claude Code when working in `apps/app`. The repo-wide file is at the root; this one adds what is specific to this app.

Worker `refood-app`, the volunteer PWA. **Today it is a demo: an entry screen that takes a NIF, and a mural projected in the room** — see the first section before assuming anything else about it.

## This page is disposable — and what goes is the shortcut, not the page

It exists for a presentation: a dark ground with the Refood logo in the middle, a manifest, and enough of a service worker to make a phone offer to install it. **Nothing here is a foundation**, and none of what it does today survives as a precedent.

**But the thing that gets removed is not the entry page — it is the shortcut.** The demo screen answers a NIF with the volunteer's núcleo, and it does that **without establishing that the person typing is who they say they are.** An entry page goes on existing long after the demo; what disappears is the path that returns data on the strength of a typed number alone.

It goes the day the real login lands, and the real login is three steps: **the NIF, a code sent to the ficha's `hr_email`, and a PIN the volunteer chooses.** Until all three exist the shortcut stays — fenced by the switch below, which is the only reason it is tolerable at all.

> **The real login is not written; the shortcut is.** As committed there is `POST /api/entrar`, `GET /api/mural`, and the `presencas_demo` table behind them. What is missing is everything that would make it a login: no code to an email, no PIN, no session, and nothing that proves the person typing is who they say they are.

Two consequences worth stating, because both are the kind of thing that gets read as a decision later:

- **The dark mode is this screen's choice, not the app's.** `#0f0f0f` was picked because it is the ground the TV already uses and the logo variant for dark backgrounds exists and is authorised by the brand guide. It says nothing about how the PWA should look. A volunteer's phone in daylight is not a television in a kitchen, and the appearance of the real app is an open decision that this file does not pre-empt.
- **The Odoo client and the D1 arrived with the shortcut, and neither authorises anything.** Resolving a NIF to a núcleo means reading `hr.employee`, so this app now has a client and a table — but nothing here authenticates a person. When the real login lands it brings the authorization decision with it: **volunteer sessions, which expire**, deliberately not the TV's device tokens. Read "Authorization" in the root `CLAUDE.md` first; the two apps must not share authentication code.

## `ENTRADA_ABERTA` — the switch, and why it replaced the allowlist

There was going to be an allowlist of NIFs. **It went, because the whole room has to be able to walk in** — a presentation where only a handful of pre-registered people can type their number is not the presentation. What stands in its place is a single `wrangler secret`, `ENTRADA_ABERTA`, whose value is `aberta` and nothing else.

**It is turned on the day and turned off straight after. That sentence is the fence.**

Because while it is open, the page **confirms to anyone who types a NIF that the person behind it is a Refood volunteer, and at which núcleo** — about a real person, from an unauthenticated page. A NIF is nine digits with a check digit: the space is not merely guessable, it is enumerable by anyone with a script. And a núcleo is a place, so the answer is roughly where that person spends their evenings. The allowlist bounded who could ask; the switch bounds **how long** anyone can. It is a weaker fence, deliberately, and the compensation is that the window is hours instead of open-ended.

What holds it up:

- **Closed is the default.** A missing secret closes; only the exact value `aberta` opens. A configuration that fails to load must never be the thing that opens the door — the same rule as the TV's `ADMIN_SECRET`.
- **Closed answers exactly like "no such ficha"** — same body, same status. If it answered differently, the response would tell anyone who asked whether the demo is running, and it exists precisely to confirm nothing.
- **`/api/mural` obeys the same switch**, and returns empty when closed. Without that it would go on serving the list of who was there long after the room emptied, from a public URL.
- **It lives in `wrangler secret`, never in `vars`** — `vars` are public build-time constants baked into the generated types.
- **Ten attempts per minute per IP**, in the isolate's memory, nothing written. That is not protection: it stops a distracted script and a finger stuck on Enter. What actually bounds this route is the switch, and the throttle runs **before** the switch check so that a `429` never reveals which state the switch is in.

**Turning the switch off is the only cleanup that matters, and it is not automatic. Do it, and empty `presencas_demo`.**

## A NIF does not identify one ficha

Measured against staging in September 2026, over the 5 772 active `hr.employee` records:

**33 normalised values appear in more than one active ficha — up to three — and 14 of those cross núcleos.** So the route that resolves a NIF **always returns a list, and is never a `search_read` with `limit: 1`.** Taking the first row that comes back is not a simplification; it is picking a stranger, and for the 14 that cross núcleos it is picking the wrong núcleo too.

**Normalising means stripping everything that is not a digit and requiring nine.** The 317 fichas whose `vat` carries interior spaces only match a typed number that way. **Normalisation creates no new collision:** the 39 colliding pairs already collided with the values exactly as stored, so the cleanup is pure gain and costs nothing in ambiguity. Verified in staging, September 2026.

**The query is two passes, and the second one exists for those 317.** `vat` is stored (`store: true`, so it can sit in a domain), but a plain `['vat', '=', <typed digits>]` misses them — what is stored is not what was normalised. So:

1. equality on `vat` with the nine digits;
2. **only if that comes back empty**, `=ilike` with the digits separated by `%` — `1%2%3…%9`, no `%` at the ends, so the value must start and end on the right digit.

**The second pass brings false positives that the domain cannot filter**, because `%` matches anything: the equality is confirmed in the Worker, by normalising the `vat` that came back. And `barcode` ending in `_VL` is checked in the Worker too, never in a domain — **`_` is a single-character wildcard in SQL's `LIKE`**, so `['barcode', 'like', '%_VL']` would match `XVL` and anything else ending in three characters that finish in `VL`.

**When the real login lands, the tie-break between fichas is the code sent to each one's `hr_email`:** whoever answers the code fixes both the ficha and the núcleo. **Never show the person the list of fichas or of núcleos that match a NIF** — that is the same oracle the switch exists to bound, handed over one query at a time. `/api/entrar` keeps the first row and does not say there were others: the body has three keys and none of them is a count.

**418 active fichas have no usable NIF and cannot come in this way** — no `vat` at all, or a value that is not nine digits once cleaned. That is roughly one active volunteer in fourteen, and they need recovery through their núcleo. A login that has no answer for them is a login that excludes them.

## The manifest declares `id` explicitly

`"id": "/"`, and it is not the default it looks like. **When `id` is absent the system derives the app's identity from `start_url`** — so the day the app starts somewhere else (`/turnos`, say, or a start_url carrying a parameter) the phone stops recognising the installed app and treats the new one as a different app: a second icon, a second set of storage, and no way to migrate the person who had it installed.

Declaring it pins the identity to something that does not have to move when the entry point does. `id` is resolved against the origin, so `"/"` is `https://<host>/` — and **it must never change once anything is installed in the field.**

## The Inter font is duplicated on purpose

`public/fonts/inter-latin-wght-normal.woff2` is byte-for-byte the copy in `apps/tv/public/fonts/`, and so is the `OFL.txt` beside it, which the licence requires travel with the file. `public/tokens.css` is a cut-down copy of the TV's.

**The two apps cannot share `public/`**: each Worker serves its own asset directory, and there is no mechanism for one to reach into the other's. The place to share would be `packages/`, and at two consumers a package costs more than the copy — a workspace, a build story for a binary asset, and an import path in two Workers, to avoid duplicating 48 KiB that changes approximately never.

**The trigger is written down so this is not re-argued from memory: at the third consumer, create `packages/tokens`.** Until then, an Inter upgrade is two places, and this paragraph is the reminder that the second one exists.

## The icons come from the isolated symbol

`icone-192.png`, `icone-512.png`, `icone-512-maskable.png` and `apple-touch-icon.png` are all rendered from `apps/tv/public/img/refood_simbolo_fundo_escuro.svg` on the `#0f0f0f` ground.

**Using the symbol without the lettering is a deviation from the brand guide, and it is not a new one.** The guide describes only the vertical and horizontal lockups, with and without the signature, plus the partner seal — the symbol alone is not in it. That decision was already taken and written up in [`docs/design.md`](../../docs/design.md) for the TV's panel header; this app reuses it rather than opening a second one. If the sede ever rules on the isolated symbol, both places change together, and `docs/design.md` is where the ruling gets recorded.

The two `purpose` values are two files and not one: **`maskable` has to survive Android cropping a circle out of it**, so the symbol sits at ~56% of the side, inside the 80% safe zone; `any` fills more, because nothing is cut from it. Generated once with `sharp` — a transitive dependency of wrangler, not something this app depends on — and the PNGs are committed. There is no generation step in the build.

## The page uses the logo, never a wordmark

The screen shows `refood_logo_horizontal_fundo_escuro.svg`, not the word "Refood" set in type. **The brand guide does not provide for a wordmark written by hand**, and typing the name in Inter would be inventing one. The SVG is the dark-background variant the guide authorises — the black strokes chosen white, which is picking a variant, not recolouring.

`docs/design.md` fixes a **96 px minimum width** for the horizontal version on the PWA and a protection margin equal to the height of the "F" in FOOD, all around. The page's `min(70vw, 420px)` clears both with room to spare; a layout that tightens has to be checked against those two numbers.

## Worker structure

- `src/index.ts` is the sole entry point, a `satisfies ExportedHandler<Env>` default export, with hand-rolled `URL.pathname` matching and no router — same shape as `apps/tv`.
- **Assets are matched before the Worker's `fetch`**, so an API route can never shadow a file in `public/`, and what reaches the Worker is `/api/*` and what does not exist.
- `wrangler.jsonc` deliberately leaves `not_found_handling` at its default. Setting `single-page-application` makes the asset server answer `index.html` for everything, and **the Worker stops running at all** — `/api/health` included. If the page ever needs client-side routes, what that calls for is `run_worker_first` for `/api/*`, not that shortcut.
- `worker-configuration.d.ts` is **generated — never hand-edit it.** After changing any binding or var in `wrangler.jsonc`, run `npm run cf-typegen --workspace=app`. It only knows the secrets it finds in `.dev.vars`, so a new secret has to be there before the types will mention it.
- There is no `.prettierrc` or `.editorconfig` here: the ones at the root apply, and a third identical copy is a file that drifts.
- `test/d1-falso.ts` is the **second** copy of the TV's — the tests run against the real migrations over `node:sqlite`. **At the third, extract `packages/d1-falso`**, the same trigger written above for the font.

`/api/health` answers `ok` and the time, and nothing else — no version, no addresses, nothing describing what is behind it. A test pins the shape of that body: the TV had a diagnostic route that grew until it was reading `res.users` with no scope, and this is the cheap way not to repeat it.

**This app reads across every núcleo, and it is the second route in the project to do so.** The scope rule says `company_id` comes from the authenticated subject and never from the request — _wherever such a subject exists_. Here none does: the NIF is the input, not a credential, and the question the route asks is exactly _which núcleo is this ficha in?_ So `allowed_company_ids` is the integration user's whole `company_ids`, read from `res.users` and **never from `res.company`** — staging has 87 companies and the user has 84, and asking for one of the other three throws `AccessError` and takes the whole request with it. It fails closed: no user, no list; empty `company_ids`, empty list. See `src/odoo.ts`.

**`POST /api/mural/reiniciar` is a POST because it deletes a table.** A GET that destroys is a GET that a probe, a prefetch or an `<img>` fires on its own. The `/mural` page calls it only when the address carries `?reiniciar`, and then strips the parameter — the plain `/mural` never clears, so a reload mid-session does not wipe the board with the room watching.
