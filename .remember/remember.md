# Handoff

## State
Eight PRs merged (#34-#40), main `272b781`, 665 tests. Repo is now
`github.com/jonaddams/bindery`; the local directory is still `dws-crud`. DWS vs Document
Engine is one config switch, and OCR/watermark/PDF-A sit behind an operation registry
(`lib/operations/`) with a collapsed Tools menu. Migration applied to Neon; Jon confirmed all
four operations work in production. **PR #41 open** — corrects bad `opt_in_keywords` refiling
advice in `docs/a2p-campaign-refiling.md`; this handoff rides on that branch.

## Next
1. **Restyle to the sample site** — the last backlog item, and the point of the last one: there
   are now four operations and a Tools menu to design around. Memory `restyle-to-sample-site`
   has the token mapping. `PRODUCT_NAME` in `lib/product.ts` must stay `'Bindery'` (filed with
   the A2P campaign).
2. Merge #41 if it reads right.
3. Deferred from #40, both real: job history labels every redaction "Redact" rather than naming
   the pattern (honest fix is an operation-supplied `describe(parameters)` — a design decision
   for the restyle), and two duplicate tests in `app/api/documents/[id]/jobs/route.test.ts`.

## Context
- **A green gate proved nothing twice this session.** The Document Engine viewer wouldn't load
  with every test passing (SDK demands a trailing slash on `serverUrl`), and later every
  document page 500'd with 662 tests green (RSC cannot serialize the `parse` function). jsdom
  has no server/client boundary and `next build` never prerenders an authed page. **Load the page.**
- **Probe the Build API, never read about it.** The documented watermark shape omits
  `width`/`height` and is rejected; Document Engine's text extraction silently OCRs pages with
  no text layer, which nearly produced a false-green test. Verified shapes:
  `docs/superpowers/specs/2026-09-16-build-api-shapes.md`.
- **Document Engine needs no licence key** (evaluation = watermark, 50MB cap, 100s timeout), but
  `DOCUMENT_ENGINE_LICENSE_KEY` is already in `.env.local` and `up.sh` uses it. Without
  PostgreSQL it 403s every document route — indistinguishable from a bad token except by the body.
  Its native PDF worker dies occasionally: everything 500s while healthcheck stays 200; fix with
  `docker restart document-engine-document-engine-1`. Containers may still be up on :5001/:5434.
- Still true: permission checks are allowlists; the A2P filing is frozen once VERIFIED;
  `.env.production` blanks arrive as `''` so use falsiness not `??`; run `pnpm prisma generate`
  in the main checkout after merging schema work; migrations are manual; Jon's flow is
  branch → push → **offer** the PR, never open unasked.
