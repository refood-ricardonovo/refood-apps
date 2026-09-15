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

- **Closed is the default.** A missing secret closes; only the exact value `aberta` opens. A configuration that fails to load must never be the thing that opens the door — the same rule as the TV's `ADMIN_SECRET`. It is also what lets the app be deployed to production with no secrets at all and still serve the right page.
- **`/api/mural` obeys the same switch**, and returns empty when closed. Without that it would go on serving the list of who was there long after the room emptied, from a public URL.
- **It lives in `wrangler secret`, never in `vars`** — `vars` are public build-time constants baked into the generated types.
- **Ten attempts per minute per IP**, in the isolate's memory, nothing written. That is not protection: it stops a distracted script and a finger stuck on Enter. It runs **before** the switch check, because a route that is open to the world and always answers the same thing is still a route somebody can hammer — the throttle limits the rate in both states.
- **`/api/entrar` answers the same when closed as when open with no match.** Not to hide anything (see below) — because it is the same truth: with the door shut there is no ficha to return, and two code paths to say that in two ways serve nobody.

### The switch state is public, and that is a decision

**`GET /api/estado` tells anyone who asks whether the door is open**, because the entry page has to know which of its two versions to show, and the page is served as a static asset — the state has to come from somewhere. There is no way around it: a page that changes with the switch publishes the switch, whether through an API or by serving different HTML.

This replaces an earlier rule that said the closed response had to be byte-identical _so that nobody could tell whether the demo was running_. That rule is gone rather than quietly contradicted, and what replaces it is narrower and true:

**What is published is one bit — "the door is open".** It says nothing about any person: not who entered, not how many, not which núcleos are in the room. What still requires one question per NIF, and is still bounded by the throttle and by how long the switch stays on, is the only thing worth hiding: whether a given number belongs to a volunteer, and where.

**Turning the switch off is the only cleanup that matters, and it is not automatic. Do it, and empty `presencas_demo`.**

### The entry page is born closed

`public/index.html` ships the closed version — the logo and _"A app dos voluntários está a chegar."_ The NIF form is `hidden` and only appears if `/api/estado` says the door is open.

That direction is deliberate, and it buys three things: **the normal state does not flash** (closed is what it is on every day but one), **without JavaScript you see the correct page** instead of a form that could not work, and **if the API is down you see the same** rather than a broken form. The app is in production permanently; the demo is one afternoon.

## A NIF does not identify one ficha

Measured against staging in September 2026, over the 5 772 active `hr.employee` records:

**33 normalised values appear in more than one active ficha — up to three — and 14 of those cross núcleos.** So the route that resolves a NIF **always returns a list, and is never a `search_read` with `limit: 1`.** Taking the first row that comes back is not a simplification; it is picking a stranger, and for the 14 that cross núcleos it is picking the wrong núcleo too.

**Normalising means stripping everything that is not a digit and requiring nine.** The 317 fichas whose `vat` carries interior spaces only match a typed number that way. **Normalisation creates no new collision:** the 39 colliding pairs already collided with the values exactly as stored, so the cleanup is pure gain and costs nothing in ambiguity. Verified in staging, September 2026.

**The query is two passes, and the second one exists for those 317.** `vat` is stored (`store: true`, so it can sit in a domain), but a plain `['vat', '=', <typed digits>]` misses them — what is stored is not what was normalised. So:

1. equality on `vat` with the nine digits;
2. **only if that comes back empty**, `=ilike` with the digits separated by `%` — `1%2%3…%9`, no `%` at the ends, so the value must start and end on the right digit.

**The second pass brings false positives that the domain cannot filter**, because `%` matches anything: the equality is confirmed in the Worker, by normalising the `vat` that came back.

**There is no `barcode` filter, and its removal was a product decision.** The route used to require `_VL` at the end of the `barcode` and discard everything else. It no longer does: **finding an active ficha with that NIF is the answer, and the núcleo is that ficha's `company_id`.** Active fichas exist with no `barcode` at all, and those people could not get in; a ficha with another suffix is not, for this demo, a ficha of something else. If the filter ever comes back, it is checked **in the Worker and never in a domain** — **`_` is a single-character wildcard in SQL's `LIKE`**, so `['barcode', 'like', '%_VL']` would match `XVL` and anything else ending in three characters that finish in `VL`.

**When the real login lands, the tie-break between fichas is the code sent to each one's `hr_email`:** whoever answers the code fixes both the ficha and the núcleo. **Never show the person the list of fichas or of núcleos that match a NIF** — that is the same oracle the switch exists to bound, handed over one query at a time. `/api/entrar` keeps the first row and does not say there were others: the body has three keys and none of them is a count.

**418 active fichas have no usable NIF and cannot come in this way** — no `vat` at all, or a value that is not nine digits once cleaned. That is roughly one active volunteer in fourteen, and they need recovery through their núcleo. A login that has no answer for them is a login that excludes them.

### What "not found" says, and why it is white

That one in fourteen, plus everyone in the room who is not in the system at all, means this message is read **many times, at once, in a room, with the person next to you looking at your screen.** It is not an error message and it must not read as one:

> **Ainda não te encontrámos.**
> Há fichas por completar, e a tua pode ser uma delas. Diz ao teu núcleo e eles tratam disso.

Every part of it is load-bearing. **"Ainda"** removes the finality. **"Há fichas por completar"** puts the fault in the system, where it is, and not in the person. **"pode ser uma delas"** does not assert a cause this route cannot know — the ficha may have no NIF, a different one from what was typed, or the person may never have been registered, and from here the three are indistinguishable; a friendlier _"falta o NIF na tua ficha"_ would be more reassuring and could be wrong out loud. **"eles tratam disso"** ends on the next step, with it on the side of whoever can take it.

**It renders white, not in the red of the format error.** Red reads as refusal. The only thing on this screen that is genuinely a correction — and keeps the red — is _"o NIF são nove dígitos"_.

## The mural has two halves, and they are different kinds of thing

The room is around 300 people and the screen is read from ten metres. That forced the shape:

- **The left column is state.** Which núcleos are present, ordered by **when the first volunteer of each núcleo arrived** — the order the room filled, not the alphabet. It stays. **No counts:** there was a total in the header and a number per núcleo, and both went at the sede's request. They went from the response too and not just from the screen — a public endpoint publishing how many people from each núcleo are in a room, that nothing displays, is data with no reader. The column says **who is present**, not how many.
- **The cloud is event.** Each first name appears **once**, when that person walks in: fade in, **nine seconds**, fade out, gone. Nothing is recycled to fill the screen — a name on that wall means someone just arrived, and a name that came back would be a lie about the room.

**`GET /api/mural?desde=<iso>` reads a window, not a list.** The window is `(desde, agora]`, with `agora` fixed at the first instant of the request and returned as the next cursor, so two consecutive polls abut with no gap and no overlap.

### The first poll brings no names, and that is not a bug

**Write this down before someone "fixes" it in a year.** A poll without `desde` returns the list of núcleos and a cursor, and an empty list of names.

The reason is the split above: **the cloud is what is happening, the column is the state.** Someone who opens the mural halfway through the session gets every núcleo that is present, correct, and does not get a burst of two hundred names that arrived while nobody was projecting. **Whoever was not watching, did not see it.** The same applies to a mid-session reload: the board keeps its column and the cloud picks up from that moment.

### The column comes from the `GROUP BY`, never from Odoo

A `GROUP BY company_id` with `MIN(criado_em)` puts a núcleo on the column **as soon as anyone from it walks in, without exception** — including someone whose ficha returns no readable name. That person puts their núcleo on the board and simply does not appear in the cloud. The version before this one derived the column from the Odoo read and dropped such a person from both, silently.

It also makes the mural cheap. The old version read every present volunteer on every poll: at 300 people and five seconds, 3 600 fichas a minute against an on-premise database, to redraw a screen that barely changes. Now a poll where nobody arrived is **one SQL query and zero calls to Odoo**.

### What a millisecond cursor loses, and why that is the cheaper side

The window is open on the left (`criado_em > desde`). Two entries in the **same millisecond** on a poll boundary would drop one.

**The consequence is not a wrong column.** A name is lost from the cloud; the núcleo stays on the board, because the column comes from the `GROUP BY` and not from this window. Someone walks in and their name does not cross the screen.

**That is precisely why an `employee_id` does not go in the payload.** Breaking the tie would mean publishing a stable identifier for a real person on a public, unauthenticated page — permanently — to avoid, in a case that needs two people pressing the button in the same millisecond, one name not showing for nine seconds. The identifier is forever; the missed name lasts nine seconds.

### The queue tightens on a curve, not on a step

Ten names appearing at once is unreadable, so arrivals queue and enter spaced out. But a fixed half-second sustains two names a second, and 300 people arriving over two minutes build a queue that only drains after the room has sat down.

The interval shortens with the queue — `min + (max - min) / (1 + n / 4)`, between **900 ms and a floor of 400 ms**. Empty queue, 900 ms; four waiting, 650; twenty, 483; never below 400. It is a curve and it is recomputed before each name, so **there is no visible jump** the way a threshold would give one.

**Those numbers went up when the name went up.** At nine seconds on screen and the old 500 ms, more than twenty big names lived on the wall at once, in twenty cells — that is not a cloud, it is a wall of text. The grid went from six columns to five for the same reason. The queue drains slower, and that is the right trade: what was asked for was the name bigger and on screen longer.

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
- **There is no bare `deploy` script, deliberately.** With production living in a named environment, `wrangler deploy` with no `--env` would push the top-level config — which has no routes — onto the production worker. `npm run deploy:staging` and `npm run deploy:producao` each carry their own `--env`. It is the same class of mistake the root `CLAUDE.md` documents for `d1 migrations apply`, and it deserved the same treatment.

**On the day, this app reads the production Odoo with an account that should not be the one it is using.** It should be a dedicated integration user, `apps@re-food.org`, which **does not exist yet**; what is in use is a personal account. **The debt bites for exactly as long as `env.production` is pointed at the production Odoo** — it costs nothing while the config is resting on staging, and the deploy having happened is not what settles it. The account has to be created with the full `company_ids`, or núcleos appear that no app can read. Tracked in [`docs/arquitetura.md`](../../docs/arquitetura.md).

`/api/health` answers `ok` and the time, and nothing else — no version, no addresses, nothing describing what is behind it. A test pins the shape of that body: the TV had a diagnostic route that grew until it was reading `res.users` with no scope, and this is the cheap way not to repeat it.

**This app reads across every núcleo, and it is the second route in the project to do so.** The scope rule says `company_id` comes from the authenticated subject and never from the request — _wherever such a subject exists_. Here none does: the NIF is the input, not a credential, and the question the route asks is exactly _which núcleo is this ficha in?_

**So neither route builds `allowed_company_ids` at all — and this is the one app where that is right.** There used to be a list here, read from the integration user's `company_ids`, passed in the context of every read. It protected nothing in this app and it hid fichas: a route whose whole purpose is to discover a núcleo cannot restrict itself to a list before it knows which one it wants. What replaced it is nothing — the ficha's own `company_id` is the answer, and its name arrives inside the many2one.

**The ceiling did not go away, because it was never ours.** Odoo's multi-company `ir.rule`s evaluate against the authenticated account's `company_ids`, and a context could only ever **narrow** inside that — never widen it. The consequence is worth having written down: a ficha in a núcleo the account does not hold answers exactly like a ficha that does not exist. If the demo cannot find anyone from a whole núcleo, what is missing is that núcleo on the account — the `apps@re-food.org` debt — and not a line of code. See `src/odoo.ts`.

**None of this transfers to `apps/tv`**, where there is a token, there is one núcleo, and the root rule applies whole: `company_id` in the domain **and** `allowed_company_ids` in the context.

**`POST /api/mural/reiniciar` is a POST because it deletes a table.** A GET that destroys is a GET that a probe, a prefetch or an `<img>` fires on its own. The `/mural` page calls it only when the address carries `?reiniciar`, and then strips the parameter — the plain `/mural` never clears, so a reload mid-session does not wipe the board with the room watching.

## The two environments, and the order the first production deploy runs in

`env.staging` serves `app-staging.myrefood.pt` against the staging Odoo (`refoodteste`). `env.production` serves the **apex `myrefood.pt`**, and the Odoo it reads is **a temporary state and not a property of the environment**: the production one — `https://erp.onrefood.com`, database **`refood.flybyodoo.pt`** — for the day of the presentation, and staging every other day. The note below says why, and step 4 is where it is put back. Both are named environments, and there is no top-level route: the top-level config exists only so `wrangler dev` and `d1 migrations` resolve, and deploying it would push a routeless config onto whichever worker was named.

**In development both apps read staging, and that is the resting state.** The TV reads `staging.onrefood.com` / `refoodteste` in every one of its environments, and so does this app at the top level and in `env.staging`. **The production Odoo in `env.production` is for the day of the presentation and not a day longer.** It is there because the room is real volunteers, and an out-of-date staging database would turn _"ainda não te encontrámos"_ into a third of the people present. **Afterwards it goes back to staging — that is step 4 below, beside the switch and the table**, because the three are one act and not three things to be remembered separately. The cost while it is pointed there is written above: it reads real fichas with a personal account, and the `apps@re-food.org` debt is not free for as long as that lasts.

**The apex uses `custom_domain: true` because the apex is empty** — the zone holds one record, `tv-staging` — so the wrangler creates the DNS record and the certificate on the first deploy. The two forms are not interchangeable: `custom_domain` **fails** if a record already exists at the apex, and `zone_name` requires one to exist already, proxied. If anybody adds an `A` or `CNAME` at the apex before the first deploy, that block has to change shape.

The order matters, and each step is the user's to run — **never against production without being asked**:

1. **`0004_presencas_demo` to staging first**, then production only when asked. `list` before every `apply`, reading back the uuid it prints (`48465336…` staging, `1756a0f6…` production). There is no dry run on `apply`, and in a non-interactive shell it auto-answers yes.
2. **`npm run deploy:producao` before the secrets.** `wrangler secret put` needs the worker to exist. A worker deployed with no secrets is not a broken state: with `ENTRADA_ABERTA` absent the switch is closed, and the closed page is the correct thing to serve on every day but one.
3. `ODOO_USERNAME` and `ODOO_PASSWORD`, then `ENTRADA_ABERTA=aberta` **on the day only**.
4. **Afterwards, and it is one act and not three: turn the switch off, empty the table, and point production back at staging.** `wrangler secret delete ENTRADA_ABERTA`, `DELETE FROM presencas_demo`, and `env.production`'s `vars` back to `https://staging.onrefood.com` / `refoodteste`, carried by a `npm run deploy:producao`. **None of it is automatic**, and leaving any one of the three undone leaves the demo running: an open switch answers NIFs about real people, a full table publishes who was in the room, and a production `ODOO_URL` goes on reading real fichas with the personal account. The fences in the sections above are exactly this step being taken.

## The top bar and the footer carry the address, and the QR is a committed file

The bar is the logo on the left, **`myrefood.pt` in yellow in the middle**, and a **QR code** on the right that resolves to the same address. The footer is low on purpose — it steals the least from the cloud — with _10º ENC Nacional | Viseu_ on the left and _Equipa Executiva Odoo_ on the right.

**The QR is `public/img/qr-myrefood.svg`, generated once and committed.** It was produced with `npx qrcode` — level Q, a 4-module quiet zone, dark modules on white — and **nothing about it exists at runtime**: no library on the page, no generation, no fetch. Same pattern as the icons, which came out of `sharp` without `sharp` being a dependency of this app. Regenerate it only if the address changes:

```bash
npx --yes qrcode -t svg -e Q -q 4 -d 0f0f0f -l ffffff -o public/img/qr-myrefood.svg "https://myrefood.pt"
```

**The logo grew with the bar, and 88 px is a limit and not a maximum.** The QR makes the bar 160 px tall, and the 46 px logo that used to sit in a 74 px bar was lost in it. What caps the logo is the protection margin `docs/design.md` fixes — the height of the "F" in FOOD, all around, which at this size is ~34 px and is exactly what is left between the logo, the 20 px padding and the 120 px QR. Filling the bar to 120 px would gain presence and lose the margin.

**The resting "Obrigado" is translucent, at 35%.** At full strength a yellow that size pulled the room towards a word that is background rather than event — the names are the screen. It is `opacity` and not a darker yellow, so that the day the ground changes there is no second yellow to reconcile.

**Dark modules on white, never inverted and never in the brand yellow.** Some readers will not read an inverted QR, and a QR that fails on a projected screen gets no second attempt. The quiet zone is inside the file, so no CSS decision can eat it.

**A QR in a header bar is close-range, and the address next to it is why.** The rule of thumb is a readable distance of about ten times the side of the code: at 120 px on a 1080p projection about 2.2 m wide, the code is ~14 cm across, so it reads from a metre or two, or with a phone's zoom. Whoever is at the back of the room types the address — that is what it is doing there. If it ever has to be scannable from the back rows, that is a slide of its own, not a bar.

**The Odoo purple in the footer is lightened, and that is deliberate.** The brand `#714b67` on `#0f0f0f` is dark on dark and unreadable at ten metres; `#c79bc0` is the same hue with enough light to survive a projector. An exact purple nobody can see is not the purple.
