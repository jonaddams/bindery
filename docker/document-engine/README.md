# Document Engine, locally

Brings up a real [Nutrient Document Engine](https://www.nutrient.io/guides/document-engine/)
so the Document Engine half of `lib/document-provider.ts` can be exercised
against a server rather than against mocks. See `TODO.md` §21 for why that
matters: the provider seam was built for two backends and has only ever been run
against one.

```bash
./up.sh                 # generates a keypair if needed, then `docker compose up -d`
./up.sh logs -f         # any other arguments pass through to `docker compose`
./up.sh down -v         # stop and discard the database
```

Then: engine on <http://localhost:5001>, dashboard on
<http://localhost:5001/dashboard> (`dashboard` / `dashboard`), including a JWT
validator at `/dashboard/jwt-validation`.

## What was surprising, and is worth knowing before you debug something

**No licence key is needed.** The engine starts in *evaluation mode*, which
allows every feature but stamps a watermark on output, caps input at 50 MB and
times processing out at 100 s. The `nutrient-document-engine` agent skill says
startup fails without `ACTIVATION_KEY`; against `pspdfkit/document-engine:latest`
(1.18.1) on 2026-09-16 it did not. Set `ACTIVATION_KEY` in the compose file to
drop the watermark. **Note the watermark before concluding a redaction went
wrong.**

**A 403 from `/api/documents` usually does not mean what it says.** Three
different conditions are distinguishable only by the body:

| Condition | Status | How to tell |
| --- | --- | --- |
| No `Authorization` header at all | **401** | — |
| Wrong token | **403** | empty body |
| Endpoint disabled: no database | **403** | body names `[:persistent_db_storage]` |

The third is the trap. Without `PGHOST` and friends the engine boots happily in
"processing-only mode", `/api/build` works fine, and every document-storage route
answers 403 as though the credentials were wrong. That is why this compose file
carries a PostgreSQL and not just the engine.

**Both auth header formats work.** `Authorization: Token token=<API_AUTH_TOKEN>`
is what the guides document, and `Authorization: Bearer <API_AUTH_TOKEN>` is also
accepted. Prefer the documented form — the undocumented one is not a promise.

**Ports dodge two collisions.** macOS AirPlay Receiver (ControlCenter) already
listens on 5000, so the engine is on **5001** — every Nutrient guide says 5000,
so translate as you read. Its PostgreSQL is on **5434**, clear of the app's own.

## Endpoints verified against this setup on 2026-09-16

Each was run for real, not read from documentation.

| Provider method | Document Engine | DWS equivalent |
| --- | --- | --- |
| `uploadDocument` | `POST /api/documents` (multipart `file`) → `{data:{document_id}}` | `POST /viewer/documents` |
| `downloadDocument` | `GET /api/documents/{id}/pdf` | `GET /viewer/documents/{id}/pdf` |
| `processDocument` | `POST /api/build` | `POST /build` |
| `deleteDocument` | `DELETE /api/documents/{id}` | `DELETE /viewer/documents/{id}` |
| `createViewerSession` | **no request** — sign a JWT locally | `POST /viewer/sessions` |

`GET /api/documents/{id}/pdf?source=true` returns the uploaded bytes exactly;
without the parameter the engine returns a rendered PDF a few hundred bytes
larger. Prefer `source=true` when feeding a processing job, so the job operates
on the original rather than on a re-render.

`/healthcheck` needs no authentication and is what the compose healthcheck uses.

**Redaction was verified to actually remove text, not cover it**, using the same
two-action shape the DWS path uses (`createRedactions` with the pattern under
`strategyOptions`, then `applyRedactions`). Extracting text from the output via
`{"output":{"type":"json-content","plainText":true}}` returned no match for an
address that the original contained. Output grew 17,167 → 19,010 bytes, which is
the reassuring direction.

## Keys

`generate-keys.sh` writes `secrets/jwt-private.pem` and `secrets/jwt-public.pem`;
`secrets/` is gitignored. The engine receives only the public half through
`JWT_PUBLIC_KEY`, so it can verify a viewer JWT but never mint one. The app holds
the private half and signs — which is why a Document Engine viewer session
involves no network call at all, unlike the DWS one.

A multi-line PEM cannot be carried in a `.env` file, which is why `up.sh` exports
it into the environment rather than compose reading it from a file.
