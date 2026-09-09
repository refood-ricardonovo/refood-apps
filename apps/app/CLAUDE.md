# apps/app — CLAUDE.md

Guidance for Claude Code when working in `apps/app`. The repo-wide file is at the root; this one adds what is specific to this app.

Worker `refood-app`, the volunteer PWA. **Today it is one page and a health probe** — see the first section before assuming anything else about it.

## This page is disposable — and what goes is the shortcut, not the page

It exists for a presentation: a dark ground with the Refood logo in the middle, a manifest, and enough of a service worker to make a phone offer to install it. **Nothing here is a foundation**, and none of what it does today survives as a precedent.

**But the thing that gets removed is not the entry page — it is the shortcut.** The demo screen answers a NIF with the volunteer's núcleo, and it does that **without establishing that the person typing is who they say they are.** An entry page goes on existing long after the demo; what disappears is the path that returns data on the strength of a typed number alone.

It goes the day the real login lands, and the real login is three steps: **the NIF, a code sent to the ficha's `hr_email`, and a PIN the volunteer chooses.** Until all three exist the shortcut stays — fenced by the allowlist below, which is the only reason it is tolerable at all.

> **None of that is written yet.** As committed, this app is one page and `/api/health`: no NIF field, no Odoo client, no allowlist. What follows is the decision the shortcut is bound by when it lands, recorded before the code so it is not re-derived from scratch by whoever writes it.

Two consequences worth stating, because both are the kind of thing that gets read as a decision later:

- **The dark mode is this screen's choice, not the app's.** `#0f0f0f` was picked because it is the ground the TV already uses and the logo variant for dark backgrounds exists and is authorised by the brand guide. It says nothing about how the PWA should look. A volunteer's phone in daylight is not a television in a kitchen, and the appearance of the real app is an open decision that this file does not pre-empt.
- **The absence of Odoo, D1 and KV is a phase, not a rule.** `Env` is empty and the Worker touches nothing. The NIF screen is what ends that: resolving a NIF to a núcleo means reading `hr.employee`, so **the shortcut is also the moment this app gains an Odoo client** — a bigger step than a page, and one that arrives with the authorization decision behind it. That decision is **volunteer sessions, which expire**, and which are deliberately not the TV's device tokens. Read "Authorization" in the root `CLAUDE.md` first; the two apps must not share authentication code.

## The allowlist is what stops this being a public oracle

While the shortcut lives, access is limited to **an allowlist of NIFs, held in `wrangler secret`** — never in `vars`, whose values are public build-time constants baked into the generated types.

**That allowlist is not throttling and it is not convenience. It is the whole fence.** Without it, a page that answers a NIF with a núcleo is a public oracle: anyone who types a number learns **whether that person is a Refood volunteer, and at which núcleo** — about a real person, from an unauthenticated page. A NIF is nine digits with a check digit, so the space is not merely guessable, it is enumerable by anyone with a script; and a núcleo is a place, so the answer is roughly where that person spends their evenings.

Two rules follow, and they are the same rule seen from both ends:

- **The shortcut cannot be removed before the real login exists** — not because it would break the demo, but because the allowlist is the only thing standing between it and the oracle above. Take out the fence and what remains is the thing the fence was for.
- **The allowlist cannot be widened while the shortcut lives.** Adding NIFs "just for this presentation", or turning it off to test, is not a smaller version of removing it — it is removing it, for as long as that lasts.

## A NIF does not identify one ficha

Measured against staging in September 2026, over the 5 772 active `hr.employee` records:

**33 normalised values appear in more than one active ficha — up to three — and 14 of those cross núcleos.** So the route that resolves a NIF **always returns a list, and is never a `search_read` with `limit: 1`.** Taking the first row that comes back is not a simplification; it is picking a stranger, and for the 14 that cross núcleos it is picking the wrong núcleo too.

**Normalising means stripping everything that is not a digit and requiring nine.** The 317 fichas whose `vat` carries interior spaces only match a typed number that way. **Normalisation creates no new collision:** the 39 colliding pairs already collided with the values exactly as stored, so the cleanup is pure gain and costs nothing in ambiguity. Verified in staging, September 2026.

> **How the query gets shaped is still open**, and it follows from the line above: `vat` is stored (`store: true`, so it can sit in a domain), but a plain `['vat', '=', <typed digits>]` misses those 317 — the stored value is not the normalised one. Whoever writes the route decides that, and does not discover it late.

**When the real login lands, the tie-break between fichas is the code sent to each one's `hr_email`:** whoever answers the code fixes both the ficha and the núcleo. **Never show the person the list of fichas or of núcleos that match a NIF** — that is the same oracle the allowlist exists to prevent, handed over one query at a time.

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
- `worker-configuration.d.ts` is **generated — never hand-edit it.** After changing any binding or var in `wrangler.jsonc`, run `npm run cf-typegen --workspace=app`.
- There is no `.prettierrc` or `.editorconfig` here: the ones at the root apply, and a third identical copy is a file that drifts.

`/api/health` answers `ok` and the time, and nothing else — no version, no addresses, nothing describing what is behind it. A test pins the shape of that body: the TV had a diagnostic route that grew until it was reading `res.users` with no scope, and this is the cheap way not to repeat it.
