# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

npm workspaces monorepo: deployable apps in `apps/*`, shared libraries in `packages/*`. Dependencies install from the **root** (`npm install`); there is a single root `package-lock.json` and no nested lockfiles.

- `apps/tv` — Cloudflare Worker `refood-tv`.
- `packages/odoo` — `@refood/odoo`, the Odoo JSON-RPC client shared by the apps.

## Commands

```bash
npm install                              # from the root; links workspaces
npm run typecheck --workspace=tv         # tsc --noEmit (also: --workspace=@refood/odoo)
npm run dev      --workspace=tv          # wrangler dev
npm run deploy   --workspace=tv          # wrangler deploy
npm run cf-typegen --workspace=tv        # wrangler types — regenerates worker-configuration.d.ts
```

No test runner and no linter are configured. Prettier config (root `.prettierrc`: tabs, single quotes, semicolons, 140 print width) has no script — run `npx prettier --write <path>` directly.

## Architecture

### `packages/odoo` — Odoo JSON-RPC client

Zero-dependency, written against Web-standard `fetch`/`AbortSignal` so it runs unchanged in a Worker. Shipped as **TypeScript source** (`main`/`types` point at `src/index.ts`); there is no build step, because Wrangler's esbuild compiles it as part of the consuming Worker. A Node consumer would need its own transpile.

Key facts about the protocol that the code encodes, and that any change must preserve:

- Odoo answers **HTTP 200 even for failures** — the error lives in the JSON body's `error` key, and the real exception type is in `error.data.name`. `faultToError` maps that name onto `OdooAuthError` / `OdooValidationError` / `OdooError`; `OdooTransportError` covers everything that never produced valid JSON-RPC (network, timeout, non-2xx, a proxy's HTML error page).
- `common.authenticate` returns `false` — not an error — when credentials are wrong. That is converted to `OdooAuthError`.
- The protocol is stateless: every `object.execute_kw` resends db + uid + password. The client caches the `uid` promise per instance (so concurrent first calls authenticate once) and retries a call once after re-authenticating if a cached uid stopped working — but only when the fresh uid actually differs, since an identical uid means a permissions problem that a retry would only repeat.
- The client's `context` is merged under any per-call `context`, so a call can override `lang`/`tz` without losing the defaults.

`createOdooClient(env)` builds a client from the Worker `Env` and throws naming any missing variable. Create one per request — `Env` only exists inside `fetch`, and construction is free since authentication is lazy.

### `apps/tv` — Cloudflare Worker

- `src/index.ts` — sole entry point, a `satisfies ExportedHandler<Env>` default export. Routing is hand-rolled `URL.pathname` matching; unmatched requests 404. No router library.
- `public/` — static assets served via Wrangler's `assets` binding. Assets are matched **before** the Worker's `fetch`, so a Worker route can never shadow a file in `public/`.
- `wrangler.jsonc` — source of truth for runtime config: the D1 binding `DB` and the vars `ODOO_URL` / `ODOO_DB`.
- `worker-configuration.d.ts` — **generated, never hand-edit.** It defines the global `Env` that `src/index.ts` types against, and `tsconfig.json` lists it in `compilerOptions.types`. After changing any binding or var in `wrangler.jsonc` — or after creating `.dev.vars` — run `npm run cf-typegen --workspace=tv`, or the types silently drift from config.

### Unfinished setup to be aware of

- `wrangler.jsonc` still holds placeholders that must be filled before deploy or before D1 works: `database_id`, `preview_database_id`, and `ODOO_DB`.
- The Odoo credentials (`ODOO_USERNAME`, `ODOO_PASSWORD`) are not yet set. Copy `apps/tv/.dev.vars.example` to `.dev.vars` locally; use `wrangler secret put` for production.
- `public/index.html` is still the Wrangler starter page; it fetches `/message`, a route the Worker does not implement.
- The only implemented route is `GET /api/health`, and nothing imports `@refood/odoo` yet.

## Conventions

- User-facing strings, code comments, and commit messages are in Portuguese (pt-PT); code identifiers are English. Match this when adding responses, comments, or commits.
- API routes live under `/api/*`; the 404 fallback message assumes that prefix.
- Secrets never go in `wrangler.jsonc` — its `vars` are public build-time values baked into the generated types.
