# Choosing a backend: DWS or Document Engine

This app talks to one of two Nutrient backends, and which one is a matter of
configuration rather than of code. `NUTRIENT_TARGET` picks it:

| | `dws` (default) | `document-engine` |
| --- | --- | --- |
| What it is | Nutrient's hosted cloud API | a server you run yourself |
| Where documents go | Nutrient's infrastructure | your infrastructure |
| Credentials | **two** API keys | **one** token, plus a signing key |
| Viewer sessions | minted by the API | signed locally by this app |
| Billing | per operation | your own hardware |

Everything the app does works on both: upload, view, comment, @mention with
email and SMS notification, and redaction. That is verified rather than assumed
— see *Checking it works* below.

**If you only want to run the app, do nothing.** With `NUTRIENT_TARGET` unset it
uses DWS, which is what production does.

---

## DWS (the hosted API)

```bash
NUTRIENT_TARGET=dws          # or leave unset; dws is the default
NUTRIENT_VIEWER_API_KEY=pdf_live_...
NUTRIENT_PROCESSOR_API_KEY=pdf_live_...
```

`NUTRIENT_BASE_URL` is optional and defaults to `https://api.nutrient.io`.

**The two keys are different keys and are not interchangeable in either
direction.** Both start with `pdf_live_` and are the same length, so they are
easy to swap by mistake, and the symptom is always an opaque `403` that never
says which one it wanted:

- the **Viewer** key covers documents, viewer sessions and comments;
- the **Processor** key covers `POST /build`, which is redaction.

Send the wrong one and you get 403. Confirm which is which in the Nutrient
dashboard rather than by eye.

---

## Document Engine (self-hosted)

```bash
NUTRIENT_TARGET=document-engine
NUTRIENT_BASE_URL=https://document-engine.example.com
DOCUMENT_ENGINE_API_TOKEN=...            # the engine's API_AUTH_TOKEN
DOCUMENT_ENGINE_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

`NUTRIENT_BASE_URL` is **required** here and the app refuses to start without it:
a self-hosted engine has no well-known address, and defaulting to the hosted one
would silently send a customer's documents to the cloud.

**It must be the URL a browser can reach**, not merely one this server can. The
viewer talks to the engine directly from the page, so an engine addressed by a
container hostname works server-side and fails in the browser.

### The two credentials, and why they are shaped differently

**`DOCUMENT_ENGINE_API_TOKEN`** is the engine's own `API_AUTH_TOKEN`. Unlike DWS
there is exactly one: it opens the document routes *and* `/api/build`, so the
whole class of bug where the wrong key reaches the wrong surface cannot happen
here.

**`DOCUMENT_ENGINE_JWT_PRIVATE_KEY`** is the private half of an RSA keypair whose
public half the engine holds as `JWT_PUBLIC_KEY`. Viewer sessions are **signed
here** rather than requested from the engine, which is the one genuinely
different mechanism between the backends — so the engine can verify a session
and can never mint one, and without this key no document opens at all.

Generate a pair with:

```bash
docker/document-engine/generate-keys.sh
```

Being multi-line, the PEM is awkward in a `.env` file. Wrap it in double quotes
with real newlines (dotenv handles that), or set it in Vercel's environment,
which handles newlines natively.

### What the engine itself needs

Configure these on the engine, not on this app:

| Engine variable | Value |
| --- | --- |
| `API_AUTH_TOKEN` | must equal `DOCUMENT_ENGINE_API_TOKEN` |
| `JWT_PUBLIC_KEY` | the public half of the keypair above |
| `JWT_ALGORITHM` | `RS256` |
| `PGUSER` / `PGPASSWORD` / `PGDATABASE` / `PGHOST` / `PGPORT` | **required** |
| `ACTIVATION_KEY` | optional — see below |

**PostgreSQL is not optional.** Without it the engine starts perfectly happily in
"processing-only mode", where `/api/build` works and *every* document route
answers **403** — which is indistinguishable from a rejected token except by
reading the response body. This is the single most misleading failure on this
backend.

**A licence key is optional for evaluation.** Without `ACTIVATION_KEY` the engine
runs in evaluation mode: every feature, but a watermark on output, a 50 MB input
cap and a 100 s processing timeout. Fine for development. Notice the watermark
before concluding a redaction went wrong.

### Running one locally

`docker/document-engine/` has a compose file that brings up an engine and its
database together, already wired to the keypair:

```bash
docker/document-engine/up.sh
```

Then point the app at it:

```bash
NUTRIENT_TARGET=document-engine
NUTRIENT_BASE_URL=http://localhost:5001
DOCUMENT_ENGINE_API_TOKEN=secret
```

Port **5001**, not the 5000 every Nutrient guide uses, because macOS AirPlay
Receiver already listens on 5000. `docker/document-engine/README.md` has the
details, the verified endpoint table, and the failure modes worth recognising.

---

## Optional, and the same on both

```bash
NUTRIENT_MAX_UPLOAD_BYTES=      # default 100 MB
NUTRIENT_ALLOWED_MIME_TYPES=    # default: a built-in list
NUTRIENT_REQUEST_TIMEOUT_MS=    # default 120000
```

The timeout is long because the Processor API has no async mode — redaction
returns the finished document in the response body, so a large job holds the
connection open for tens of seconds.

`NUTRIENT_MAX_UPLOAD_BYTES` above 100 MB is **rejected at startup when the target
is `dws`**, because the hosted API answers `413` and raising it could only turn a
clear rejection into an opaque one. A self-hosted engine has no such cap.

---

## Switching an existing deployment

**Documents do not move.** A document's ID belongs to the backend that stored it,
so after switching, everything uploaded under the old backend answers 404. That
is expected, not a bug. There is no migration path today: to try the other
backend, upload fresh documents.

Nothing else needs changing. There is no schema change and no migration
associated with either target.

---

## Checking it works

Set the target, then open a document. The quickest honest check is the whole
chain rather than any one piece, because the pieces fail independently:

1. upload a document;
2. open it — proves viewer sessions, which is the mechanism that differs most;
3. @mention someone — proves the comment layer, which is what mention
   notifications are derived from;
4. redact it — proves the processing path and the job runner.

A green test suite is **not** sufficient evidence for the Document Engine path.
`lib/document-provider.integration.test.ts` exercises a real engine, but it
**skips when none is reachable**, so it passes silently in a checkout that has no
engine and no generated keypair. Confirm it reports `5 passed` rather than
`5 skipped` before believing it.

[testing-against-document-engine.md](testing-against-document-engine.md) is the
full procedure, including the second user a mention test requires and the
checklist for a change that touches the backend.

---

## Where the seam lives

Four files, if you need to change how a backend is reached:

| File | What it decides |
| --- | --- |
| `lib/nutrient-config.ts` | which target, which base URL, which limits |
| `lib/nutrient-key.ts` | which credential opens which API |
| `lib/document-provider.ts` | upload, download, process, delete, viewer session |
| `lib/comments.ts` | comment threads, which mentions are derived from |
| `lib/viewer-load-options.ts` | how the **browser** loads the viewer — the two backends need different `NutrientViewer.load()` calls, and this is the one part of the seam that is not server-side |
