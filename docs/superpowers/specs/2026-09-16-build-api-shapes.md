# Build API shapes: OCR, watermark, PDF/A — verified behaviour

**Date:** 2026-09-17
**Method:** live probing against a local Document Engine (`pspdfkit/document-engine:latest`,
reported as version 1.18.1), started via `docker/document-engine/up.sh` with no
`DOCUMENT_ENGINE_LICENSE_KEY` set (evaluation mode: watermark on output, 50 MB input cap,
100 s timeout). Every claim below was produced by an actual request to
`http://localhost:5001/api/build` and is quoted from the real response, not inferred from
documentation.

**Why this document exists, and why it does not cite the vendor docs as fact:** redaction's
documented shape (`{"type":"redaction","strategy":"preset","preset":...}`) was rejected
outright by the live API, and the real shape (`createRedactions` + `applyRedactions`, pattern
nested under `strategyOptions`) had to be found by probing. The reference documentation
available to this session (`nutrient-dws:document-processor-api` skill) **still shows the
rejected flat `redaction` shape** as of this writing — direct confirmation that this
documentation source cannot be trusted for shape, and everything below was checked against
the live engine regardless of what any doc said. Where a documented value or spelling was
used as a *candidate* to probe, that is called out explicitly; nothing here is asserted
because a doc said so.

**Auth used:** `Authorization: Token token=secret` (this compose file's default
`API_AUTH_TOKEN`), `Accept: application/json` on every JSON request — the engine answers a
wildcard `Accept` with 406.

**Free-probe technique used throughout:** omitting `parts[0].file`'s actual multipart
attachment causes the API to validate every action/output and return every failing path in
one `400`, at no processing cost. A field that produces no failing path in that response is
accepted; a field that does is named directly, usually with the specific reason.

**One general finding that qualifies every "accepted" claim below:** the engine silently
ignores completely unrecognised field names rather than rejecting them. Verified by adding
`"totallyBogusField":"xyz"` to both an `ocr` action and a `watermark` action — neither
produced a failing path. So "no failing path" proves a field name is not rejected as
malformed; it does not by itself prove the field is read and used. Where that distinction
matters below, it is called out and resolved by Step 4 (running the shape for real and
inspecting output), not left as an assumption.

---

## OCR — is an **action**

### Exact accepted shape

```json
{"type": "ocr", "language": "english"}
```

Confirmed as fully valid (no failing path other than the unrelated missing-file one) with a
single action in the instructions. No other field was found to be required.

### Enumerated values — `language`

The API does **not** enumerate the valid set in its error message; the only wording produced
was: `` `not-a-language` is not a supported language for OCR ``. So the valid set below was
established by probing individual candidate spellings (candidates drawn from the
`document-processor-api` skill's OCR reference, but every one of them was independently
verified accepted or rejected against the live engine — none is taken on the doc's word).

**Accepted, verified against the live engine:**

| Full English name | Also accepted as (3-letter code) |
| --- | --- |
| `english` | `eng` |
| `german` | `deu` |
| `french` | `fra` |
| `spanish` | *(full word only tested; 3-letter not probed)* |
| `italian` | `ita` |
| `portuguese` | `por` |
| `dutch` | `nld` |
| `swedish` | `swe` |
| `polish` | `pol` |
| `czech` | `ces` |
| `turkish` | `tur` |
| *(no full-word form found — see below)* | `jpn` |
| *(no full-word form found — see below)* | `kor` |
| *(no full-word form found — see below)* | `chi_sim` |
| *(no full-word form found — see below)* | `chi_tra` |
| *(no full-word form found — see below)* | `ara` |
| *(no full-word form found — see below)* | `heb` |
| *(no full-word form found — see below)* | `hin` |
| *(no full-word form found — see below)* | `rus` |

**Rejected, verified against the live engine:**

- 2-letter ISO 639-1 codes: `en`, `de`, `fr`, `es` — each produced
  `` `<code>` is not a supported language for OCR ``.
- Full English names for non-Latin-script languages: `japanese`, `korean`,
  `chinese-simplified`, `chinese-traditional`, `arabic`, `hebrew`, `hindi`, `russian` — each
  rejected by that same message, **even though the 3-letter code for the same language
  (`jpn`, `kor`, `chi_sim`, `chi_tra`, `ara`, `heb`, `hin`, `rus`) is accepted.**

**The genuinely surprising finding:** the full-English-word alias only exists for
Latin-script European languages. Every language whose Tesseract code was tested and accepted
has a 3-letter code that works; only the Latin-script subset also accepts a full English word.
This is very likely a property of this specific evaluation image's bundled Tesseract language
packs and/or its alias table, not a documented API contract — **do not assume the DWS-hosted
API matches this list**, and do not assume it is complete even for this engine (only the
candidates above were tried; there may be other valid codes, e.g. `spa` for Spanish, that were
never tested).

**`language` also accepts an array** — `{"type":"ocr","language":["english","german","french"]}`
was accepted with no failing path. Not run end-to-end with multiple languages against a real
mixed-language document; only confirmed as an accepted shape.

### Confirmed to run for real (Step 4)

```bash
curl -s -o /tmp/probe-ocr.pdf -w '%{http_code} %{size_download}\n' -X POST http://localhost:5001/api/build \
  -H 'Authorization: Token token=secret' \
  -F 'instructions={"parts":[{"file":"document"}],"actions":[{"type":"ocr","language":"english"}]}' \
  -F 'document=@/tmp/probe.pdf;type=application/pdf'
```

Result: `200`, 13652-byte PDF body (input was 15144 bytes; a born-digital PDF, not an
image-only one, going through OCR is not expected to grow the way redaction does — this only
confirms the shape is accepted and executes without a processing error, not that a text layer
was added). **Unknown, explicitly:** whether OCR actually adds a text layer on an image-only
source. The design doc itself notes this needs an image-only PDF fixture (generated by
converting an image through `/build`) that this task did not create — verifying the OCR
*effect* (not just the shape) is left to the task that builds `lib/operations/ocr.ts` and its
tests, per the design's own verification section.

---

## Watermark — is an **action**

### Exact accepted shape (text)

```json
{"type": "watermark", "text": "CONFIDENTIAL-PROBE", "width": "50%", "height": "50%"}
```

Confirmed fully valid, and confirmed to actually appear in the output (see Step 4 below).

### Exact accepted shape (image)

```json
{"type": "watermark", "image": "logo.png", "width": "50%"}
```

`image` is a **part reference**, exactly like `parts[0].file` — it must name a file actually
attached to the multipart request, or the API answers
`` `logo.png` must be included in the request ``, the identical error shape used for a missing
main document. This was **not run for real** (no image fixture was created); the shape is
confirmed accepted by the validator but not confirmed to visibly watermark an output. Marked
explicitly as unknown-in-practice.

### Rejected shapes / fields — including one the documentation suggested

- **`imagePath` (the field name the `document-processor-api` skill's docs use) is not a
  recognised field at all.** Sending only `{"type":"watermark","imagePath":"logo.png"}`
  produced `` one of `text` or `image` is required `` — i.e. `imagePath` was silently ignored,
  and the actual field name is **`image`**. This is the second confirmed case (after
  redaction) of this documentation source naming a field that the live API does not use.
- **`watermarkType` (also from the docs) produced no error when present**, but per the general
  finding above that only proves it isn't rejected as malformed, not that it does anything —
  the action worked identically without it. Left as an unresolved question: it may be a
  legitimate optional discriminator the API tolerates being redundant, or it may be dead
  weight. Not worth resolving further since the confirmed shape doesn't need it.
- `text` and `image` are **mutually exclusive**: supplying both produces
  `` only one of `text` or `image` is allowed ``.
- Supplying neither produces `` one of `text` or `image` is required ``.

### `width` / `height` — required, and required differently per watermark type

- **Text watermark requires both `width` and `height`.** Supplying `text` alone gives two
  failing paths, `width` and `height` both `` can't be blank ``. Supplying only one of the two
  still leaves the other flagged as blank. Both are mandatory for a text watermark.
- **Image watermark requires only one of `width` or `height`** — the error text is literally
  `` One of `width` or `height` is required `` (singular "One of"), a different message from
  the text-watermark case, and consistent with the other dimension being derived from the
  image's aspect ratio. Not run for real to confirm the derivation.
- Both a JSON object form (`{"value": 50, "unit": "%"}`) and a bare percentage string
  (`"50%"`) were tried for `width`/`height` and **both were accepted** with no failing path.
  Only the string form (`"50%"`) was carried through to an actual run (Step 4); the object
  form was confirmed accepted by the validator only.
- An invalid unit was rejected: `{"value": 100, "unit": "bogus"}` produced
  `` must be a positive integer or percentage `` at `$.actions[0].width`.

### Other fields — not enumerated, not verified

`fontSize`, `fontColor`, `opacity`, `rotation` appear in the vendor documentation's watermark
example but were **not probed at all** in this task. The design doc's UI schema needs only a
`text` field for watermark, so these were out of scope for what this task needed to confirm.
Marked explicitly as unknown — do not assume they exist or use the documented names without
probing them the same way, if a later task wants to expose them.

### Confirmed to run for real (Step 4), and confirmed to actually watermark

```bash
curl -s -X POST http://localhost:5001/api/build \
  -H 'Authorization: Token token=secret' \
  -F 'instructions={"parts":[{"file":"document"}],"actions":[{"type":"watermark","text":"CONFIDENTIAL-PROBE","width":"50%","height":"50%"}],"output":{"type":"json-content","plainText":true}}' \
  -F 'document=@/tmp/probe.pdf;type=application/pdf'
```

Result: `200`, and — critically, following the redaction lesson that 200 alone proves
nothing — the extracted `plainText` of the output page actually contains
`CONFIDENTIAL-PROBE`:

```json
"plainText": "Shapes probe\r\n\"ForEvaluation Purposes Only\r\n\r\n...\r\n                  CONFIDENTIAL-PROBE"
```

This also incidentally confirms the brief's second warning in practice: `"ForEvaluation
Purposes Only"` is the *engine's own* evaluation-mode stamp (this Document Engine has no
licence key configured), present in the same output alongside the real watermark text — it is
not something this probing added and must not be mistaken for the watermark action having
malfunctioned or duplicated.

The earlier plain multipart run (`/tmp/probe-watermark.pdf`, no output override) returned
`200` with a 19201-byte PDF (up from the 15144-byte input), consistent with a watermark having
been drawn.

---

## PDF/A — is an **output type**, not an action

### Exact accepted shape

```json
{"output": {"type": "pdfa", "conformance": "pdfa-2b"}}
```

`conformance` is **optional** — `{"output":{"type":"pdfa"}}` alone produced no failing path,
meaning the API has some default conformance level when none is given. **Unknown, explicitly:
what that default is.** Not determined by this task; would require running the shape without
`conformance` and inspecting the output's actual PDF/A metadata, which is beyond a shape-probe
and closer to the compliance checking the design doc explicitly declines to do ("not that it
is conformant").

### Enumerated values — `conformance`

Every one of the eleven levels named in the `document-processor-api` skill's documentation was
individually probed and **all eleven were accepted** by the live engine — the one place in
this task where the documentation's enumerated list matched the live API exactly (still
verified independently rather than trusted):

`pdfa-1a`, `pdfa-1b`, `pdfa-2a`, `pdfa-2u`, `pdfa-2b`, `pdfa-3a`, `pdfa-3u`, `pdfa-3b`,
`pdfa-4`, `pdfa-4e`, `pdfa-4f`

Invalid values were rejected at `$.output.pdfa.conformance` with the message `is invalid`
(no list of valid values given in the error itself — this is why every candidate had to be
probed individually): `pdfa`, `pdf-a`, `pdfa1b` (no hyphen) were all rejected.

**Incidental finding, not deeply investigated:** `PDFA-1B` (uppercase) was accepted with no
failing path, suggesting the match may be case-insensitive. Only this one uppercase variant
was tried; this is not confirmed as a general rule and should not be relied on — use the
documented lowercase hyphenated form.

### Other accepted output fields

`vectorization` and `rasterization` (both booleans, per the vendor docs) were tried together
as `true`/`true` and produced no failing path. Unlike the general "unknown fields are
ignored" finding above, these **are** type-checked: setting `vectorization` to the string
`"yes"` produced a real error, `` $.output.pdfa.vectorization: is invalid ``. So, unlike
`watermarkType` on the watermark action, these two names are confirmed to be recognised by the
validator (not merely tolerated) — though whether they visibly change output was not checked.

### Confirmed to run for real (Step 4)

```bash
curl -s -o /tmp/probe-pdfa.pdf -w '%{http_code} %{size_download}\n' -X POST http://localhost:5001/api/build \
  -H 'Authorization: Token token=secret' \
  -F 'instructions={"parts":[{"file":"document"}],"output":{"type":"pdfa","conformance":"pdfa-2b"}}' \
  -F 'document=@/tmp/probe.pdf;type=application/pdf'
```

Result: `200`, a 17612-byte PDF (input 15144 bytes), reported by `file(1)` as
`PDF document, version 1.7, 1 pages` — a real, structurally valid PDF was produced. Per the
design doc's own stated limit, this confirms the operation **ran and changed the output**; it
does **not** confirm PDF/A conformance, which would need a dedicated validator this project
does not have. That limit is intentional, not an oversight of this task.

---

## Summary table

| Operation | Shape kind | Minimal accepted JSON | Enumerated values fully confirmed? | Ran for real (200 + non-empty)? | Output effect verified? |
| --- | --- | --- | --- | --- | --- |
| OCR | action | `{"type":"ocr","language":"english"}` | Partial — accepted/rejected set probed, not proven exhaustive | Yes | No (needs an image-only fixture; out of scope here) |
| Watermark (text) | action | `{"type":"watermark","text":"...","width":"50%","height":"50%"}` | N/A (free text) | Yes | **Yes** — extracted text contains the watermark string |
| Watermark (image) | action | `{"type":"watermark","image":"<part name>","width":"50%"}` | N/A | No — not run with an actual image attached | No |
| PDF/A | output | `{"output":{"type":"pdfa","conformance":"pdfa-2b"}}` | Yes — all 11 documented levels individually confirmed | Yes | Ran and changed output; conformance itself not checked (by design) |

## What was not probed and remains unknown

- The DWS-hosted API was not probed at all in this task — everything above is against a local
  Document Engine (1.18.1, evaluation mode) only. The OCR language list in particular may
  differ from DWS's hosted OCR, which likely ships a different (probably larger) language pack.
- Watermark's `fontSize`, `fontColor`, `opacity`, `rotation` — not probed; not needed by the
  current design's single-`text`-field schema.
- Watermark image mode was never run against an actual attached image file, only validated as
  an accepted shape.
- The default PDF/A `conformance` level (when the field is omitted) is unknown.
- Whether OCR actually adds a text layer to an image-only PDF is unknown — this task did not
  build the image-only fixture the design doc calls for.
- Case-insensitivity of the `conformance` enum was seen once (`PDFA-1B`) and not
  systematically confirmed.

None of the above blocks the next task: all three operations (OCR, watermark, PDF/A) have a
confirmed, live-verified minimal shape that fits `ProcessInstructions`, so none needs to be
dropped from this work.
