# Document operations beyond redaction

**Date:** 2026-09-16
**Status:** approved design, not yet implemented

## The problem

Bindery performs exactly one document operation — redaction — and its controls
sit permanently open on the document page. Two things are wrong with that.

The app demonstrates a fraction of what the backend does. The Build API offers
OCR, watermarking, format conversion and more, on both DWS and a self-hosted
Document Engine, and none of it is reachable.

And the page asserts that redaction is *the* thing you do to a document, because
its panel is always there. A second operation makes that framing untenable rather
than merely unbalanced.

The immediate purpose is to inform the forthcoming restyle: enough operations, in
enough different shapes, that the new design knows what it has to accommodate.

## Scope

**In:** OCR, watermark, and PDF/A conversion, alongside the existing redaction. A
collapsed "Tools" menu replacing the always-open redaction panel.

**Out, deliberately:** data extraction. It returns *data* rather than a derived
document, which is the one shape `DocumentJob` cannot model today — every job's
output is a new `Document` with `derivedFromId` lineage. Adding it means deciding
where structured results live, and that deserves its own design rather than
riding along with three operations that fit the existing machinery exactly.

Also out: any change to the viewer, the mention layer, or the job sweeper. The
sweeper is already kind-agnostic.

## Architecture

### The operation registry

One module per operation in `lib/operations/`, each exporting a single value of a
shared type, collected by `lib/operations/index.ts`.

Operations have different parameter types, and a registry cannot be generic over
all of them at once without a cast. The way out is for parsing to return a
*closure* rather than a parameters object:

```ts
type OperationParseResult =
  | {
      ok: true;
      buildInstructions: (o: { filePartName: string }) => ProcessInstructions;
      outputSuffix: string;
    }
  | { ok: false; message: string };

type DocumentOperation = {
  kind: DocumentJobKind;
  label: string;
  description: string;
  backends: readonly NutrientTarget[];
  fields: readonly OperationField[];
  parse(raw: unknown): OperationParseResult;
};
```

Each operation validates its own parameters and returns something that can only
build valid instructions. Invalid parameters cannot reach the runner, and no
`unknown` escapes the module — which is what lets one registry hold four
differently-shaped operations with no cast anywhere.

`backends` lives on the operation rather than in a separate per-backend list,
because a parallel list is a second source of truth that drifts. Today all four
operations support both targets, so the field reads the same either way; it earns
its place the moment one diverges, and extraction is the likely first case since
DWS has a dedicated Data Extraction API that Document Engine may not match.

### Rendering a form from the registry

`fields` is a small declarative schema — `{ name, label, kind, options? }` — so
the UI renders each operation's form generically rather than needing a React
component per operation. Three operations with one field each do not justify
more.

Field kinds: `select` (OCR language, PDF/A conformance level), `text`
(watermark), and `preset-or-regex` for redaction.

**The option lists are not specified here on purpose.** Which languages OCR
accepts and which PDF/A levels exist are facts about the API, and this project
has been wrong before by transcribing them from documentation. They come from
probing (see *Verification*), and each becomes a checked-in constant in its
operation's module the way `REDACTION_PRESETS` already is — so an unknown value
is refused here with a message naming the valid ones, rather than by the API with
a 400.

That last one is an admitted exception. Redaction's existing form is a preset
dropdown plus a custom-regex checkbox with its own case-sensitivity toggle, and
contorting a flat field list to express it would make the schema worse for the
other three. It is better to name the exception than to pretend three shapes
cover everything.

### Files

```
lib/operations/
  index.ts        registry, lookup by kind, operationsFor(target)
  types.ts        DocumentOperation, OperationField, OperationParseResult
  redaction.ts    moved from lib/redaction.ts, conformed
  ocr.ts
  watermark.ts
  pdfa.ts
```

## Wiring

**Schema.** Add `OCR`, `WATERMARK` and `PDFA` to `DocumentJobKind`. Purely
additive: no data moves and no rows change, unlike dropping `USER` from
`ImpersonationMode`, which needed a hand-written migration.

One claim to verify rather than assume: Postgres restricts
`ALTER TYPE ... ADD VALUE` inside a transaction block, and Prisma wraps a
migration in one. It should be fine, because the migration only adds values
without using them in the same transaction — but generate the SQL with
`--create-only` and read it before applying.

**API route.** `POST /api/documents/[id]/jobs` already reads `body.kind` and
rejects anything that is not `REDACTION`, so this is a generalisation rather than
a rewrite: look the kind up in the registry, then check the operation supports
the configured backend.

That second check is not redundant with the UI. The menu only renders supported
operations, but a tab left open across a configuration change will post a stale
kind, and "not shown" is not a permission.

**Runner.** `runJob` hardcodes `parseRedactionRequest` then
`buildRedactionInstructions`. That pair becomes a registry lookup. The
surrounding sequence — download, process, upload, create the derived `Document`
— is unchanged, because all three new operations share redaction's shape.
`redactedFilename()` generalises to use the operation's `outputSuffix`.

**UI.** `components/redaction-panel.tsx` becomes
`components/document-tools.tsx`: a collapsed Tools button, the list of supported
operations, the selected operation's fields rendered from its schema, and job
history below — labelled per operation through a registry lookup rather than
assuming redaction.

The server component computes `operationsFor(target)` and passes it as a prop, so
the client never imports `nutrientConfig`. The existing permission gate carries
over unchanged, renamed from `canRedact` to `canRunTools`.

## Verification

**The riskiest part of this work is not the code. It is three API shapes that are
not yet known.**

Redaction's shape was established by probing the live API, and the shape the
vendor's own reference documentation showed was rejected outright — while the
dangerous failure was *silent*: a document with black boxes drawn over text that
was still fully present underneath. OCR, watermark and PDF/A shapes are currently
assumed, not verified.

So verification comes **before** the instruction builders are written, not after.

**Probe the shapes for free.** Stack several actions in one request and omit the
file. The API validates every action and reports every failing path at once, so a
whole set of enumerated values can be confirmed for the price of a single 400.
This is how the redaction preset list was established without spending a build.

**Then verify each operation changes the output**, rather than merely returning
200:

| Operation | How it is checked |
| --- | --- |
| OCR | extract text before and after; an image-only PDF should gain a text layer |
| Watermark | the output's extracted text contains the stamped string |
| PDF/A | it ran and the output differs — **not** that it is conformant |

The PDF/A limit is deliberate. Asserting real conformance needs a validator this
project does not have, and a test that implies compliance it has not checked
would be worse than one that claims less.

OCR needs an image-only PDF fixture, which the HTML-to-PDF generator cannot
produce. Generate one by converting an image through `/build`. It is the only
fixture here that is not free.

## Testing

Test-driven, as the project requires.

**Unit.** Per operation: parse rejects bad input with a message naming what was
wrong, and builds the expected instructions. Registry: every `DocumentJobKind`
has exactly one operation, kinds and labels are unique, and every operation names
at least one backend — the last catching an operation unreachable by
construction.

**Integration.** A new `lib/operations/operations.integration.test.ts`, following
the established pattern of skipping when no engine is reachable. Per
`docs/testing-against-document-engine.md`, confirm it reports passes rather than
skips; a suite that passes with nothing running proves nothing.

**Both backends, with a caveat.** The testing policy says check DWS and Document
Engine. Every `/build` call against DWS is billed, so: verify exhaustively
against the local engine, which is free, and spot-check each operation once
against DWS rather than running the full matrix there.

**Component.** The tools menu lists only supported operations, selecting one
reveals its fields, and submitting posts the right `kind`.

## Risks

**The three API shapes are unverified.** Mitigated by probing before
implementing, above. This is the item most likely to change the design, and if an
operation's shape turns out not to fit `ProcessInstructions`, that operation
should be dropped from this piece of work rather than forced.

**A silent success is the failure mode that matters.** Redaction taught this: the
operation returns 200 and produces a document that looks right and is not. Every
operation here therefore has an assertion about its *output*, not its status
code.

**Evaluation-mode watermark.** A local engine without a licence key stamps "For
Evaluation Purposes Only" on output. That is easy to mistake for a watermark
operation having run, and vice versa. Tests asserting watermark content must use
a string of their own choosing, not merely "some watermark is present".
