# Testing against a local Document Engine

This app supports two backends (see [backends.md](backends.md)). Only one of them
is exercised by default, and the other is the one a customer might be running.

**Anything that touches the backend should be checked against both.** This is how.

## Why bother, when the suite is green

Because a green suite is not evidence for the Document Engine path. Two reasons,
both learned rather than guessed:

**The unit tests mock `fetch`.** They prove the app sends what we believe the
backend wants, and nothing about whether it agrees. Every expensive surprise on
this project was invisible to a mocked test and obvious within seconds of a real
one: the DWS session token arriving as `jwt`, the undocumented `/pdf` download,
a redaction shape the vendor's own documentation got wrong, and — on Document
Engine — a viewer that would not load at all because the SDK requires a trailing
slash on `serverUrl`. In that last case a unit test was *asserting the wrong
thing*, so the suite was actively confirming a bug.

**The live tests skip when no engine is reachable.** That is deliberate, so the
suite passes in CI and in a fresh clone. It also means they prove nothing unless
you check they actually ran.

> Confirm `5 passed`, not `5 skipped`.

## The automated part

From a clean checkout, two commands:

```bash
docker/document-engine/generate-keys.sh   # once per checkout; secrets/ is gitignored
docker/document-engine/up.sh              # engine + its PostgreSQL
```

The engine is healthy in under ten seconds. Then:

```bash
pnpm test lib/document-provider.integration.test.ts
```

Expect **5 passed**. If you see 5 skipped, the engine is not reachable or the
keypair was never generated — the tests look for `docker/document-engine/secrets/`.

What that file covers, all against the real engine:

- a byte-identical upload → download → delete round trip;
- redaction that genuinely removes text, asserted by extracting the output's text
  rather than by looking at it;
- a viewer session signed here and verified with the key the engine holds;
- a comment thread round trip — create, reply, list roots, read back with author
  and `customData` intact — because that is the layer mentions are derived from;
- a 403 that is really a missing component being reported as such.

**When you add a backend operation, add it here too.** A mocked test alone is not
enough for anything that crosses the network.

## The part only a browser proves

The server-side seam is not the whole story: DWS and Document Engine need
different `NutrientViewer.load()` calls, so a complete provider can still leave
every document failing to open. Nothing but a browser catches that.

Point the app at the engine — in `.env.local`:

```bash
NUTRIENT_TARGET=document-engine
NUTRIENT_BASE_URL=http://localhost:5001
DOCUMENT_ENGINE_API_TOKEN=secret
DOCUMENT_ENGINE_JWT_PRIVATE_KEY="<contents of docker/document-engine/secrets/jwt-private.pem>"
```

Then `pnpm dev` and walk the chain. Each step proves a different thing, and they
fail independently:

| Step | What it proves |
| --- | --- |
| Upload a document | `uploadDocument`, and the engine has a database |
| Open it | viewer sessions and the client load shape — the biggest difference |
| @mention someone | the comment layer, which mentions are derived from |
| Check email / SMS arrives | sync, mention extraction, and notification |
| Redact it | the processing path and the job runner |

**Documents do not move between backends.** Anything uploaded while the target
was DWS answers 404 here. Upload something fresh rather than concluding it is
broken.

### Testing mentions needs a second user

Self-mentions are filtered — `lib/mentions.ts` drops any mentioned id equal to
`comment.authorUserId` — so you cannot test notifications by mentioning yourself.
You need another account in the directory, which `/api/mentionable-users` will
offer regardless of document.

Creating one directly in the database is enough; it never signs in.

```sql
insert into users (
  id, email, name, email_verified, role, current_impersonation_mode,
  phone, phone_verified_at, sms_opted_out_at, notification_channel,
  created_at, updated_at
) values (
  'cmtestuser000bindery0001',
  'you+bindery-test@your-domain',   -- a plus-address you actually receive at
  'Bindery Test User',
  true, 'USER', 'SELF',
  '+1...', now(), null,             -- a number you can receive SMS on
  'BOTH',                           -- EMAIL | SMS | BOTH
  now(), now()
);
```

Two constraints worth knowing before you fight them:

- **`users.phone` is `@unique`.** You cannot give the test user a number that is
  already on your own account. Moving yours across is the cheapest answer, since
  for this test you are the comment's *author* and the test user is the
  recipient — only the recipient needs a phone.
- **SMS needs `phone_verified_at` set and `sms_opted_out_at` null**, and
  `notification_channel` must be `SMS` or `BOTH`. Setting `phone_verified_at`
  by hand skips the real verification flow, which is fine here and is not a test
  of that flow.

Also set `NEXT_PUBLIC_APP_URL=http://localhost:3000`, or the link inside the
notification points at production, where a locally-uploaded document does not
exist.

**The messages are real.** Resend sends a real email and Twilio a real SMS, and
the SMS costs money and is subject to the A2P campaign. Use your own address and
number.

## Checklist for a change that touches the backend

- [ ] Unit tests for both targets — assert the path, the credential *and* the
      payload shape, since they differ.
- [ ] Added to `lib/document-provider.integration.test.ts` if it crosses the
      network, and confirmed it **passed rather than skipped**.
- [ ] Opened a document in a browser against the engine, if anything touches the
      viewer.
- [ ] `pnpm pre-commit` — the real gate. `pnpm test` alone misses a stale Prisma
      client and a dropped `@unique`; only `typecheck` sees those.
- [ ] Checked the DWS path still works, which is what production runs.

## When it misbehaves

**Every PDF operation suddenly 500s with an empty body**, while `/healthcheck`
stays 200 and the container stays `healthy`, and HTML-to-PDF still works. The
engine's native worker has died — `docker logs` shows
`Shared.PSPDFKit.Protocol` raising `{:error, :closed}`.
`docker restart document-engine-document-engine-1` fixes it. This once began
immediately after a refactor and looked exactly like the refactor's fault.

**403 on every document route**, while `/api/build` works. The engine has no
database. The response body names the missing component; the status alone is
indistinguishable from a bad token.

**A red "For Evaluation Purposes Only" watermark** is expected without a licence
key. Do not read it as a broken redaction.

`docker/document-engine/README.md` has the rest, including the verified endpoint
table.

## Finishing up

```bash
docker/document-engine/up.sh down -v      # -v also discards the engine's database
```

Then put `.env.local` back — remove the `DOCUMENT_ENGINE_*` and `NUTRIENT_TARGET`
lines and restore `NEXT_PUBLIC_APP_URL` — and restore any phone number you moved.
