# Bindery

A document collaboration app built on Nutrient: upload a document, read it in an
embedded viewer, comment on it, @mention a colleague — who is notified by email
or SMS and can reply straight from either — and redact it.

It runs against **either** Nutrient backend, chosen by one environment variable:
the hosted **DWS** cloud API, or a **Document Engine** you host yourself. See
[docs/backends.md](docs/backends.md), which is the place to start if you are
configuring this.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript in strict mode ·
Prisma 7 + PostgreSQL · Tailwind CSS v4 · BetterAuth (Google and Microsoft
OAuth) · Vitest · Biome.

## Getting started

```bash
pnpm install
pnpm dev                 # http://localhost:3000
```

You will need `.env.local`. At minimum: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, OAuth credentials, and the backend credentials described in
[docs/backends.md](docs/backends.md). `.env.production` documents every variable
the app reads, including the secrets, which are listed there as comments rather
than as values.

To develop against a local Document Engine instead of the hosted API:

```bash
docker/document-engine/up.sh
```

and set the three variables in [docs/backends.md](docs/backends.md#document-engine-self-hosted).

## Commands

```bash
pnpm dev              # dev server
pnpm test             # vitest, single run
pnpm test:watch       # vitest, watch mode
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check
pnpm pre-commit       # biome --write, typecheck, test, build — the real gate
pnpm db:status        # prisma migrate status
pnpm db:migrate       # prisma migrate deploy
```

`pnpm pre-commit` is the gate that matters. `pnpm test` alone will not catch a
stale Prisma client or a dropped `@unique`, because the tests mock the database;
only `typecheck` sees those.

## Two things that will bite you

**Migrations are not applied by deploying.** `postinstall` runs `prisma generate`,
not `prisma migrate deploy`, and the Vercel build never touches the database. A
schema change therefore needs a separate, manual migration step — and skipping it
has broken production sign-in before, invisibly, because the health endpoints
keep answering `200`. CLAUDE.md has the recipe under *Deploying a schema change*.

**Documents belong to the backend that stored them.** Switching `NUTRIENT_TARGET`
does not move them, so anything uploaded under the other backend answers 404.

## Testing

```bash
pnpm test
```

Tests live beside the code they exercise. `jsdom` is the default environment;
server-side tests opt into node with `// @vitest-environment node` on the first
line.

`lib/document-provider.integration.test.ts` runs against a **real** Document
Engine and **skips when none is reachable** — so it passes silently in a checkout
with no engine running. If you are relying on it, confirm it reports passes
rather than skips.

## Further reading

- [docs/backends.md](docs/backends.md) — configuring DWS or Document Engine
- [docker/document-engine/README.md](docker/document-engine/README.md) — running
  an engine locally, with the verified endpoint table and its failure modes
- `CLAUDE.md` — accumulated behaviour of the Nutrient, Resend and Twilio APIs
  that is either undocumented or documented wrongly upstream, plus the
  deployment recipes
