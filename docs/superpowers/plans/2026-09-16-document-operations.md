# Document Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OCR, watermark and PDF/A conversion alongside redaction, reachable from a collapsed "Tools" menu that lists only the operations the configured backend supports.

**Architecture:** One module per operation in `lib/operations/`, each exporting a `DocumentOperation`. Parsing returns a *closure* that builds instructions, which is what lets a single registry hold four differently-parameterised operations with no cast. The job runner and the UI both read that registry, so they agree by construction.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Prisma 7 + PostgreSQL, Vitest, Biome, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-16-document-operations-design.md`

## Global Constraints

- **TDD is non-negotiable.** Every line of production code is written in response to a failing test. Write the test, watch it fail, then implement.
- **No `any`. No type assertions** (`as X`) without a comment justifying them. No `@ts-ignore`.
- **Prefer `type` over `interface`.** Options objects for multi-parameter functions.
- **`pnpm pre-commit` is the real gate** (`biome check --write && typecheck && test && build`). `pnpm test` alone misses a stale Prisma client and type-level guards.
- **Tests are behaviour-driven** and use the real types from the codebase, never redefined copies.
- **Integration tests skip when no engine is reachable.** After running them, confirm the output says *passed*, not *skipped* — a suite that passes with nothing running proves nothing.
- **Do not touch** `PRODUCT_NAME`, `PROGRAM_NAME`, or anything under `lib/sms-program.ts`. The SMS copy is filed with a VERIFIED A2P campaign that cannot be edited.
- **Local engine:** `docker/document-engine/up.sh` starts it on `http://localhost:5001` with token `secret`. `up.sh down -v` stops it. See `docs/testing-against-document-engine.md`.
- Existing behaviour must not change: with `NUTRIENT_TARGET` unset or `dws`, redaction works exactly as before.

---

### Task 1: Probe the three API shapes and record them

**This task writes no production code.** Its deliverable is a committed findings document, because the next three operations are built from its results. The spec is explicit about why: redaction's documented shape was *rejected outright* by the live API, and the dangerous failure was silent — black boxes over text that was still present. Do not write an instruction builder from documentation.

**Files:**
- Create: `docs/superpowers/specs/2026-09-16-build-api-shapes.md`

- [ ] **Step 1: Start a local Document Engine**

```bash
docker/document-engine/up.sh
until curl -s -o /dev/null http://localhost:5001/healthcheck; do sleep 3; done
echo "engine up"
```

- [ ] **Step 2: Probe all three action shapes in one free request**

The API validates every action and reports every failing path at once, and omitting the file means no build is performed or billed. A `400` naming failing paths is success for this step; a `401`/`403` means the token is wrong.

```bash
curl -s -X POST http://localhost:5001/api/build \
  -H 'Authorization: Token token=secret' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"file":"document"}],"actions":[{"type":"ocr"},{"type":"watermark"},{"type":"flatten"}]}' | head -c 2000
```

Record which action names are recognised and which are rejected. Repeat with candidate spellings (`ocr` vs `applyOcr`; `watermark` with `text`/`image`) until each of the three is accepted as an action name.

- [ ] **Step 3: Probe the enumerated values**

Send a deliberately invalid value for each enumerated field; the error names the valid ones.

```bash
curl -s -X POST http://localhost:5001/api/build \
  -H 'Authorization: Token token=secret' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"file":"document"}],"actions":[{"type":"ocr","language":"not-a-language"}]}' | head -c 2000
```

Do the same for the PDF/A output: PDF/A is an **output type**, not an action, so probe `{"output":{"type":"pdfa","conformance":"not-a-level"}}`.

- [ ] **Step 4: Confirm each shape actually runs**

Generate a text PDF to work on:

```bash
printf '<html><body><h1>Shapes probe</h1><p>Contact: probe@example.com</p></body></html>' > /tmp/probe.html
curl -s -o /tmp/probe.pdf -X POST http://localhost:5001/api/build \
  -H 'Authorization: Token token=secret' \
  -F 'instructions={"parts":[{"html":"index.html"}]}' \
  -F 'index.html=@/tmp/probe.html;type=text/html'
```

Run each confirmed shape against it with the file attached and check for HTTP 200 and a non-empty body.

- [ ] **Step 5: Write the findings document**

Record, for each of OCR, watermark and PDF/A: the exact accepted JSON, the enumerated values, anything rejected that documentation suggested, and whether the operation is an `action` or an `output`. Mark anything still unknown explicitly — an honest gap is usable, a guess is not.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-build-api-shapes.md
git commit -m "docs: record the verified Build API shapes for OCR, watermark and PDF/A"
```

**If an operation's shape cannot be made to fit `ProcessInstructions`, stop and report it.** The spec says to drop that operation from this work rather than force it.

---

### Task 2: Operation types and registry, with redaction moved in

**Files:**
- Create: `lib/operations/types.ts`
- Create: `lib/operations/index.ts`
- Create: `lib/operations/index.test.ts`
- Move: `lib/redaction.ts` → `lib/operations/redaction.ts` (use `git mv`)
- Move: `lib/redaction.test.ts` → `lib/operations/redaction.test.ts`
- Modify: `lib/job-runner.ts`, `app/api/documents/[id]/jobs/route.ts`, `lib/document-jobs.ts`, `components/redaction-panel.tsx` — import paths only

**Interfaces:**
- Consumes: `ProcessInstructions` from `lib/document-provider.ts`; `NutrientTarget` from `lib/nutrient-config.ts`; `DocumentJobKind` from `@prisma/client`.
- Produces: `DocumentOperation`, `OperationField`, `OperationParseResult` (types); `DOCUMENT_OPERATIONS`, `operationFor(kind)`, `operationsFor(target)`; `redactionOperation`.

- [ ] **Step 1: Move redaction with history, and fix imports**

```bash
git mv lib/redaction.ts lib/operations/redaction.ts
git mv lib/redaction.test.ts lib/operations/redaction.test.ts
grep -rln "@/lib/redaction" app lib components | xargs sed -i '' 's#@/lib/redaction#@/lib/operations/redaction#g'
pnpm test
```

Expected: all existing tests pass. This step changes no behaviour.

- [ ] **Step 2: Write the types**

```typescript
// lib/operations/types.ts
import type { DocumentJobKind } from '@prisma/client';
import type { ProcessInstructions } from '@/lib/document-provider';
import type { NutrientTarget } from '@/lib/nutrient-config';

export type OperationFieldOption = { value: string; label: string };

/**
 * What the UI renders for an operation, declared by the operation itself.
 *
 * A schema rather than a component per operation: with one field each, a
 * component apiece would be more code and a second place for the registry and
 * the UI to disagree.
 */
export type OperationField =
  | {
      kind: 'select';
      name: string;
      label: string;
      options: readonly OperationFieldOption[];
      defaultValue: string;
    }
  | { kind: 'text'; name: string; label: string; placeholder: string; maxLength: number }
  /**
   * Redaction's preset-dropdown-plus-custom-regex form, which does not fit a
   * flat field list. Named as an exception rather than contorting the schema for
   * the other three.
   */
  | { kind: 'preset-or-regex'; name: string; label: string };

/**
 * The result of validating a request for one operation.
 *
 * Returns a *closure* rather than a parameters object, which is what lets one
 * registry hold operations with different parameter types and no cast: each
 * module validates its own input and hands back something that can only build
 * valid instructions.
 */
export type OperationParseResult =
  | {
      ok: true;
      buildInstructions: (options: { filePartName: string }) => ProcessInstructions;
      /** Appended to the source filename to name the output. */
      outputSuffix: string;
    }
  | { ok: false; message: string };

export type DocumentOperation = {
  kind: DocumentJobKind;
  label: string;
  description: string;
  /** Which backends can perform this. Lives here so there is no parallel list to drift. */
  backends: readonly NutrientTarget[];
  fields: readonly OperationField[];
  parse(raw: unknown): OperationParseResult;
};
```

- [ ] **Step 3: Write the failing registry test**

```typescript
// lib/operations/index.test.ts
// @vitest-environment node

import { DocumentJobKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_OPERATIONS, operationFor, operationsFor } from '@/lib/operations';

describe('The operation registry', () => {
  it('has exactly one operation for every job kind the schema allows', () => {
    // A kind with no operation is a job that can be created and never run.
    const kinds = DOCUMENT_OPERATIONS.map((operation) => operation.kind).sort();
    expect(kinds).toEqual(Object.values(DocumentJobKind).sort());
  });

  it('does not repeat a kind or a label', () => {
    const kinds = DOCUMENT_OPERATIONS.map((operation) => operation.kind);
    const labels = DOCUMENT_OPERATIONS.map((operation) => operation.label);

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every operation at least one backend, so none is unreachable', () => {
    for (const operation of DOCUMENT_OPERATIONS) {
      expect(operation.backends.length).toBeGreaterThan(0);
    }
  });

  it('finds an operation by kind', () => {
    expect(operationFor('REDACTION')?.label).toBe('Redact');
  });

  it('offers only the operations a backend supports', () => {
    const supported = operationsFor('dws').map((operation) => operation.kind);

    expect(supported).toContain('REDACTION');
    for (const operation of operationsFor('dws')) {
      expect(operation.backends).toContain('dws');
    }
  });
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npx vitest run lib/operations/index.test.ts`
Expected: FAIL — `Cannot find module '@/lib/operations'`.

- [ ] **Step 5: Conform redaction to the type**

Append to `lib/operations/redaction.ts`, keeping every existing export in place so its tests keep passing:

```typescript
import type { DocumentOperation } from '@/lib/operations/types';

export const redactionOperation: DocumentOperation = {
  kind: 'REDACTION',
  label: 'Redact',
  description: 'Permanently remove matching text.',
  backends: ['dws', 'document-engine'],
  fields: [{ kind: 'preset-or-regex', name: 'redaction', label: 'What to redact' }],
  parse: (raw) => {
    const request = parseRedactionRequest(raw);

    if (!request.ok) {
      return { ok: false, message: request.message };
    }

    return {
      ok: true,
      outputSuffix: 'redacted',
      buildInstructions: ({ filePartName }) =>
        buildRedactionInstructions({ filePartName, redaction: request.redaction }),
    };
  },
};
```

- [ ] **Step 6: Write the registry**

```typescript
// lib/operations/index.ts
import type { DocumentJobKind } from '@prisma/client';
import type { NutrientTarget } from '@/lib/nutrient-config';
import { redactionOperation } from '@/lib/operations/redaction';
import type { DocumentOperation } from '@/lib/operations/types';

export type { DocumentOperation, OperationField, OperationParseResult } from '@/lib/operations/types';

/** Every operation this app implements. Order is the order the menu shows. */
export const DOCUMENT_OPERATIONS: readonly DocumentOperation[] = [redactionOperation];

export const operationFor = (kind: DocumentJobKind): DocumentOperation | undefined =>
  DOCUMENT_OPERATIONS.find((operation) => operation.kind === kind);

/** What this deployment can offer, which is not the same as what it implements. */
export const operationsFor = (target: NutrientTarget): readonly DocumentOperation[] =>
  DOCUMENT_OPERATIONS.filter((operation) => operation.backends.includes(target));
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run lib/operations/`
Expected: PASS. The first test passes only because `DocumentJobKind` still has one value; Task 3 adds three more and it will fail until Tasks 6–8 land. That is intentional — it is the guard that stops a kind existing with no operation.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: put redaction behind an operation registry"
```

---

### Task 3: Add the three job kinds and generalise job creation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_document_operation_kinds/migration.sql` (generated)
- Modify: `lib/document-jobs.ts`
- Modify: `lib/document-jobs.test.ts`
- Modify: `app/api/documents/[id]/jobs/route.ts` (call site only)

**Interfaces:**
- Consumes: `DocumentOperation` from Task 2.
- Produces: `createDocumentJob({ documentId, requestedById, kind, parameters })` replacing `createRedactionJob`.

- [ ] **Step 1: Add the enum values**

```prisma
enum DocumentJobKind {
  REDACTION
  OCR
  WATERMARK
  PDFA
}
```

- [ ] **Step 2: Generate the migration without applying it**

```bash
pnpm prisma migrate dev --create-only --name document_operation_kinds
```

- [ ] **Step 3: Read the generated SQL before applying it**

Open the new `migration.sql`. Expect three `ALTER TYPE "DocumentJobKind" ADD VALUE` statements and **nothing else**. If it contains anything you did not ask for — a `DROP DEFAULT`, a column change — that is a bug to investigate, not noise to accept.

Postgres restricts `ALTER TYPE ... ADD VALUE` inside a transaction block. This migration only adds values without using them, so it should apply cleanly; if it fails on that, split it so each `ADD VALUE` runs on its own.

- [ ] **Step 4: Apply it and regenerate the client**

```bash
pnpm prisma migrate deploy
pnpm prisma generate
```

- [ ] **Step 5: Write the failing test for generic job creation**

```typescript
// in lib/document-jobs.test.ts
it('records the operation kind it was asked for', async () => {
  create.mockResolvedValue({ id: 'job_1' });

  await createDocumentJob({
    documentId: 'doc_1',
    requestedById: 'user_1',
    kind: 'OCR',
    parameters: { kind: 'OCR', language: 'english' },
  });

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ kind: 'OCR' }),
    })
  );
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run lib/document-jobs.test.ts`
Expected: FAIL — `createDocumentJob is not a function`.

- [ ] **Step 7: Replace `createRedactionJob`**

```typescript
export const createDocumentJob = async (options: {
  documentId: string;
  requestedById: string;
  kind: DocumentJobKind;
  /** Stored as given, so a finished job can still answer what it was asked to do. */
  parameters: Prisma.InputJsonValue;
}) => {
  const { documentId, requestedById, kind, parameters } = options;

  return prisma.documentJob.create({
    data: { documentId, requestedById, kind, parameters },
  });
};
```

Delete `createRedactionJob` and update its one call site in the jobs route to pass `kind: 'REDACTION'` and `parameters: body`.

- [ ] **Step 8: Run the full suite**

Run: `pnpm test`
Expected: `lib/operations/index.test.ts` now FAILS — three kinds have no operation. Every other test passes. Leave it failing; Tasks 6–8 fix it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add OCR, watermark and PDF/A job kinds"
```

---

### Task 4: Dispatch jobs through the registry

**Files:**
- Modify: `lib/job-runner.ts`
- Modify: `lib/job-runner.test.ts`
- Modify: `lib/document-jobs.ts` (the claim query must select `kind`)

**Interfaces:**
- Consumes: `operationFor(kind)` from Task 2.
- Produces: no new exports; `performJob` becomes kind-agnostic.

- [ ] **Step 1: Write the failing test**

```typescript
// in lib/job-runner.test.ts
it('refuses a job whose kind no operation implements, naming the kind', async () => {
  // Parameters and kind are read back from the database, so nothing guarantees
  // the running code still implements what an older writer recorded.
  claimJob.mockResolvedValue({
    id: 'job_1',
    documentId: 'doc_1',
    kind: 'WATERMARK',
    parameters: {},
  });

  await runJobNow({ jobId: 'job_1' });

  expect(failJob).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.stringContaining('WATERMARK') })
  );
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/job-runner.test.ts`
Expected: FAIL — the runner currently calls `parseRedactionRequest` regardless of kind, so the error mentions redaction rather than `WATERMARK`.

- [ ] **Step 3: Make the claimed job carry its kind**

In `lib/document-jobs.ts`, add `kind: true` to the `select` in the claim query. In `lib/job-runner.ts`:

```typescript
type ClaimedJob = {
  id: string;
  documentId: string;
  kind: DocumentJobKind;
  parameters: unknown;
};
```

- [ ] **Step 4: Dispatch through the registry**

Replace the opening of `performJob`:

```typescript
const performJob = async (job: ClaimedJob): Promise<void> => {
  const operation = operationFor(job.kind);

  if (!operation) {
    throw new Error(
      `This job cannot be run: "${job.kind}" is not an operation this build implements.`
    );
  }

  const request = operation.parse(job.parameters);

  if (!request.ok) {
    throw new Error(`This job cannot be run: ${request.message}`);
  }
  // ... document lookup and provider calls unchanged ...
```

Then use the closure and the suffix in place of the redaction-specific calls:

```typescript
  const processed = await provider.processDocument({
    source: new Uint8Array(source),
    filename: document.filename,
    instructions: request.buildInstructions({ filePartName: FILE_PART_NAME }),
  });

  const filename = suffixedFilename(document.filename, request.outputSuffix);
```

Rename `redactedFilename(filename)` to `suffixedFilename(filename, suffix)`, keeping its existing logic and replacing the hardcoded `REDACTED_SUFFIX` with the parameter.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/job-runner.test.ts`
Expected: PASS, including the existing redaction tests — redaction now runs through the generic path.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: dispatch jobs through the operation registry"
```

---

### Task 5: Accept any supported operation at the API

**Files:**
- Modify: `app/api/documents/[id]/jobs/route.ts`
- Modify: `app/api/documents/[id]/jobs/route.test.ts`

**Interfaces:**
- Consumes: `operationFor`, `operationsFor` from Task 2; `createDocumentJob` from Task 3.

- [ ] **Step 1: Add a config mock to the test file**

The route now calls `nutrientConfig()`, which reads the environment. Add this
alongside the file's existing `vi.mock` calls, and reset it in `beforeEach`:

```typescript
const resolvedConfig = vi.fn();

vi.mock('@/lib/nutrient-config', () => ({
  nutrientConfig: () => resolvedConfig(),
}));

// in beforeEach:
resolvedConfig.mockReset().mockReturnValue({
  target: 'dws',
  baseUrl: 'https://api.nutrient.io',
  limits: { requestTimeoutMs: 120_000 },
});
```

- [ ] **Step 2: Write the failing tests**

```typescript
// in app/api/documents/[id]/jobs/route.test.ts
it('refuses a kind no operation implements', async () => {
  const response = await post({ kind: 'TELEPORTATION' });

  expect(response.status).toBe(400);
});

it('accepts a kind the registry implements for this backend', async () => {
  const response = await post({ kind: 'REDACTION', strategy: 'preset', preset: 'email-address' });

  expect(response.status).toBe(201);
});
```

Note what is **not** tested here: refusing a kind that exists but is unsupported
*by the configured backend*. Every operation currently supports both targets, so
there is no such case to construct without inventing a fake operation, and a test
that fakes the registry would assert the mock rather than the route. The
`operationsFor(...)` filter in Step 4 is what implements it; add the test when an
operation first diverges — extraction is the likely one.

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run "app/api/documents/[id]/jobs/route.test.ts"`
Expected: FAIL — the route hardcodes `body?.kind !== 'REDACTION'`.

- [ ] **Step 4: Replace the hardcoded check**

```typescript
    const operation = operationsFor(nutrientConfig().target).find(
      (candidate) => candidate.kind === body?.kind
    );

    if (!operation) {
      return NextResponse.json(
        { error: `"${String(body?.kind)}" is not an operation this deployment performs.` },
        { status: 400 }
      );
    }

    const request = operation.parse(body);

    if (!request.ok) {
      return NextResponse.json({ error: request.message }, { status: 400 });
    }
```

Then create the job with `kind: operation.kind, parameters: body`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run "app/api/documents/[id]/jobs/route.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: accept any registered operation at the jobs route"
```

---

### Task 6: OCR

**Use the shapes recorded in Task 1.** The code below shows the structure; replace the action JSON and the language list with what the probe actually confirmed.

**Files:**
- Create: `lib/operations/ocr.ts`
- Create: `lib/operations/ocr.test.ts`
- Modify: `lib/operations/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/operations/ocr.test.ts
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ocrOperation } from '@/lib/operations/ocr';

describe('OCR', () => {
  it('builds instructions for the requested language', () => {
    const result = ocrOperation.parse({ kind: 'OCR', language: 'english' });

    if (!result.ok) {
      throw new Error(`Expected a valid request, got: ${result.message}`);
    }

    const instructions = result.buildInstructions({ filePartName: 'document' });

    expect(instructions.parts).toEqual([{ file: 'document' }]);
    expect(instructions.actions).toContainEqual(
      expect.objectContaining({ type: 'ocr', language: 'english' })
    );
  });

  it('names the languages it offers when given one it does not', () => {
    const result = ocrOperation.parse({ kind: 'OCR', language: 'klingon' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('english');
  });

  it('marks its output so it cannot be mistaken for the original', () => {
    const result = ocrOperation.parse({ kind: 'OCR', language: 'english' });

    if (!result.ok) throw new Error('Expected a valid request');
    expect(result.outputSuffix).toBe('ocr');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/operations/ocr.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/operations/ocr.ts
import type { DocumentOperation } from '@/lib/operations/types';

/**
 * The languages the Build API accepts, confirmed by probing rather than read
 * from documentation — see docs/superpowers/specs/2026-09-16-build-api-shapes.md.
 * Listed here so an unknown one is refused with a useful message instead of
 * becoming an opaque 400 after the job is queued.
 */
export const OCR_LANGUAGES = ['english'] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/**
 * What to call each language in front of a person, mirroring
 * `REDACTION_PRESET_LABELS`. A map rather than a transform, because the API's
 * identifiers are its own and need not be presentable.
 */
export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  english: 'English',
};

const isLanguage = (value: unknown): value is OcrLanguage =>
  typeof value === 'string' && OCR_LANGUAGES.includes(value as OcrLanguage);

export const ocrOperation: DocumentOperation = {
  kind: 'OCR',
  label: 'OCR',
  description: 'Recognise text in a scan so it can be searched and selected.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'select',
      name: 'language',
      label: 'Language',
      options: OCR_LANGUAGES.map((language) => ({
        value: language,
        label: OCR_LANGUAGE_LABELS[language],
      })),
      defaultValue: 'english',
    },
  ],
  parse: (raw) => {
    const request = raw as { language?: unknown };

    if (!isLanguage(request?.language)) {
      return {
        ok: false,
        message:
          `"${String(request?.language)}" is not a language this deployment offers. ` +
          `Available languages are: ${OCR_LANGUAGES.join(', ')}.`,
      };
    }

    const language = request.language;

    return {
      ok: true,
      outputSuffix: 'ocr',
      buildInstructions: ({ filePartName }) => ({
        parts: [{ file: filePartName }],
        actions: [{ type: 'ocr', language }],
        output: { type: 'pdf' },
      }),
    };
  },
};
```

Replace `OCR_LANGUAGES` and the label map with the real list from Task 1.

- [ ] **Step 4: Register it**

Add `ocrOperation` to `DOCUMENT_OPERATIONS` in `lib/operations/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/operations/`
Expected: PASS.

- [ ] **Step 6: Write the live integration test**

```typescript
// lib/operations/operations.integration.test.ts
// @vitest-environment node

/**
 * Operations against a real Document Engine. Skipped when none is reachable, so
 * confirm this file reports passes rather than skips before believing it.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { documentProvider } from '@/lib/document-provider';
import { ocrOperation } from '@/lib/operations/ocr';

const baseUrl = process.env.DOCUMENT_ENGINE_TEST_URL ?? 'http://localhost:5001';
const token = process.env.DOCUMENT_ENGINE_TEST_TOKEN ?? 'secret';

const privateKey = (() => {
  try {
    return readFileSync(`${__dirname}/../../docker/document-engine/secrets/jwt-private.pem`, 'utf8');
  } catch {
    return undefined;
  }
})();

const engineIsRunning = await (async (): Promise<boolean> => {
  if (!privateKey) return false;
  try {
    const response = await fetch(`${baseUrl}/healthcheck`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
})();

/** A page of rasterised text: OCR has nothing to do on a PDF that already has a text layer. */
const scannedPdf = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const body = new FormData();
  body.set(
    'instructions',
    JSON.stringify({ parts: [{ html: 'index.html' }], output: { type: 'image', format: 'png', dpi: 150 } })
  );
  body.set(
    'index.html',
    new File(['<html><body><h1>SCANNED PROBE TEXT</h1></body></html>'], 'index.html', {
      type: 'text/html',
    })
  );

  const rendered = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body,
  });

  const image = new Uint8Array(await rendered.arrayBuffer());

  const toPdf = new FormData();
  toPdf.set('instructions', JSON.stringify({ parts: [{ file: 'page' }] }));
  toPdf.set('page', new File([image], 'page.png', { type: 'image/png' }));

  const pdf = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body: toPdf,
  });

  return new Uint8Array(await pdf.arrayBuffer());
};

const extractText = async (pdf: Uint8Array<ArrayBuffer>): Promise<string> => {
  const body = new FormData();
  body.set(
    'instructions',
    JSON.stringify({
      parts: [{ file: 'document' }],
      output: { type: 'json-content', plainText: true },
    })
  );
  body.set('document', new File([pdf], 'document.pdf', { type: 'application/pdf' }));

  const response = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body,
  });

  return response.text();
};

const uploaded: string[] = [];

afterAll(async () => {
  if (!engineIsRunning) return;
  for (const documentId of uploaded) {
    await fetch(`${baseUrl}/api/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Token token=${token}` },
    }).catch(() => undefined);
  }
});

describe.skipIf(!engineIsRunning)('Operations against a real engine', () => {
  beforeEach(() => {
    process.env.NUTRIENT_TARGET = 'document-engine';
    process.env.NUTRIENT_BASE_URL = baseUrl;
    process.env.DOCUMENT_ENGINE_API_TOKEN = token;
    process.env.DOCUMENT_ENGINE_JWT_PRIVATE_KEY = privateKey;
  });

  it('OCR adds a text layer a scan did not have', async () => {
    const scan = await scannedPdf();

    // The premise: no text before. If this fails the fixture is wrong, not OCR.
    expect(await extractText(scan)).not.toContain('SCANNED PROBE TEXT');

    const request = ocrOperation.parse({ kind: 'OCR', language: 'english' });
    if (!request.ok) throw new Error(request.message);

    const processed = await documentProvider().processDocument({
      source: scan,
      filename: 'scan.pdf',
      instructions: request.buildInstructions({ filePartName: 'document' }),
    });

    expect(await extractText(new Uint8Array(processed))).toContain('SCANNED PROBE TEXT');
  }, 180_000);
});
```

- [ ] **Step 7: Run it against a live engine**

```bash
docker/document-engine/up.sh
npx vitest run lib/operations/operations.integration.test.ts
```

Expected: **1 passed** — not skipped. If it says skipped, the engine is not reachable or the keypair was never generated.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add OCR"
```

---

### Task 7: Watermark

**Files:**
- Create: `lib/operations/watermark.ts`
- Create: `lib/operations/watermark.test.ts`
- Modify: `lib/operations/index.ts`, `lib/operations/operations.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/operations/watermark.test.ts
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { WATERMARK_MAX_LENGTH, watermarkOperation } from '@/lib/operations/watermark';

describe('Watermark', () => {
  it('stamps the text it was given', () => {
    const result = watermarkOperation.parse({ kind: 'WATERMARK', text: 'CONFIDENTIAL' });

    if (!result.ok) throw new Error(result.message);

    const instructions = result.buildInstructions({ filePartName: 'document' });

    expect(instructions.actions).toContainEqual(
      expect.objectContaining({ type: 'watermark', text: 'CONFIDENTIAL' })
    );
  });

  it('refuses empty text rather than stamping nothing', () => {
    const result = watermarkOperation.parse({ kind: 'WATERMARK', text: '   ' });

    expect(result.ok).toBe(false);
  });

  it('refuses text too long to render sensibly, naming the limit', () => {
    const result = watermarkOperation.parse({
      kind: 'WATERMARK',
      text: 'x'.repeat(WATERMARK_MAX_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(String(WATERMARK_MAX_LENGTH));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/operations/watermark.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/operations/watermark.ts
import type { DocumentOperation } from '@/lib/operations/types';

/**
 * Long enough for "CONFIDENTIAL — DO NOT DISTRIBUTE", short enough that it still
 * renders as a watermark rather than a paragraph across the page.
 */
export const WATERMARK_MAX_LENGTH = 64;

export const watermarkOperation: DocumentOperation = {
  kind: 'WATERMARK',
  label: 'Watermark',
  description: 'Stamp text across every page.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'text',
      name: 'text',
      label: 'Watermark text',
      placeholder: 'CONFIDENTIAL',
      maxLength: WATERMARK_MAX_LENGTH,
    },
  ],
  parse: (raw) => {
    const request = raw as { text?: unknown };
    const text = typeof request?.text === 'string' ? request.text.trim() : '';

    if (text.length === 0) {
      return { ok: false, message: 'Watermark text is required.' };
    }

    if (text.length > WATERMARK_MAX_LENGTH) {
      return {
        ok: false,
        message: `Watermark text must be ${WATERMARK_MAX_LENGTH} characters or fewer.`,
      };
    }

    return {
      ok: true,
      outputSuffix: 'watermarked',
      buildInstructions: ({ filePartName }) => ({
        parts: [{ file: filePartName }],
        actions: [{ type: 'watermark', text }],
        output: { type: 'pdf' },
      }),
    };
  },
};
```

Replace the action JSON with the shape confirmed in Task 1.

- [ ] **Step 4: Register and run**

Add `watermarkOperation` to `DOCUMENT_OPERATIONS`.

Run: `npx vitest run lib/operations/`
Expected: PASS.

- [ ] **Step 5: Add the live check**

```typescript
// in lib/operations/operations.integration.test.ts
it('watermark puts the requested text into the document', async () => {
  // A distinctive string, because an unlicensed engine stamps its own
  // "For Evaluation Purposes Only" watermark and "some watermark is present"
  // would pass without this operation doing anything.
  const request = watermarkOperation.parse({ kind: 'WATERMARK', text: 'ZZTOPSECRETZZ' });
  if (!request.ok) throw new Error(request.message);

  const source = await samplePdf();

  const processed = await documentProvider().processDocument({
    source,
    filename: 'report.pdf',
    instructions: request.buildInstructions({ filePartName: 'document' }),
  });

  expect(await extractText(new Uint8Array(processed))).toContain('ZZTOPSECRETZZ');
}, 120_000);
```

Add the `samplePdf()` helper alongside `scannedPdf()`, building a text PDF from HTML exactly as `lib/document-provider.integration.test.ts` does.

- [ ] **Step 6: Run against a live engine**

Run: `npx vitest run lib/operations/operations.integration.test.ts`
Expected: **2 passed**, not skipped.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add watermarking"
```

---

### Task 8: PDF/A conversion

**Files:**
- Create: `lib/operations/pdfa.ts`
- Create: `lib/operations/pdfa.test.ts`
- Modify: `lib/operations/index.ts`, `lib/operations/operations.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/operations/pdfa.test.ts
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { PDFA_CONFORMANCE_LEVELS, pdfaOperation } from '@/lib/operations/pdfa';

describe('PDF/A conversion', () => {
  it('asks for the requested conformance level', () => {
    const level = PDFA_CONFORMANCE_LEVELS[0];
    const result = pdfaOperation.parse({ kind: 'PDFA', conformance: level });

    if (!result.ok) throw new Error(result.message);

    const instructions = result.buildInstructions({ filePartName: 'document' });

    // PDF/A is an output type rather than an action — see the shapes document.
    expect(instructions.output).toEqual(expect.objectContaining({ conformance: level }));
  });

  it('names the levels it offers when given one it does not', () => {
    const result = pdfaOperation.parse({ kind: 'PDFA', conformance: 'pdfa-99z' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(PDFA_CONFORMANCE_LEVELS[0]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/operations/pdfa.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/operations/pdfa.ts
import type { DocumentOperation } from '@/lib/operations/types';

/** Confirmed by probing — see docs/superpowers/specs/2026-09-16-build-api-shapes.md. */
export const PDFA_CONFORMANCE_LEVELS = ['pdfa-2b'] as const;

export type PdfaConformance = (typeof PDFA_CONFORMANCE_LEVELS)[number];

/** Presentable names for the API's own identifiers, as OCR and redaction do. */
export const PDFA_CONFORMANCE_LABELS: Record<PdfaConformance, string> = {
  'pdfa-2b': 'PDF/A-2b',
};

const isConformance = (value: unknown): value is PdfaConformance =>
  typeof value === 'string' && PDFA_CONFORMANCE_LEVELS.includes(value as PdfaConformance);

export const pdfaOperation: DocumentOperation = {
  kind: 'PDFA',
  label: 'Convert to PDF/A',
  description: 'Produce an archival copy for long-term retention.',
  backends: ['dws', 'document-engine'],
  fields: [
    {
      kind: 'select',
      name: 'conformance',
      label: 'Conformance level',
      options: PDFA_CONFORMANCE_LEVELS.map((level) => ({
        value: level,
        label: PDFA_CONFORMANCE_LABELS[level],
      })),
      defaultValue: 'pdfa-2b',
    },
  ],
  parse: (raw) => {
    const request = raw as { conformance?: unknown };

    if (!isConformance(request?.conformance)) {
      return {
        ok: false,
        message:
          `"${String(request?.conformance)}" is not a conformance level this deployment offers. ` +
          `Available levels are: ${PDFA_CONFORMANCE_LEVELS.join(', ')}.`,
      };
    }

    const conformance = request.conformance;

    return {
      ok: true,
      outputSuffix: 'pdfa',
      buildInstructions: ({ filePartName }) => ({
        parts: [{ file: filePartName }],
        actions: [],
        output: { type: 'pdfa', conformance },
      }),
    };
  },
};
```

Replace the levels and the output shape with what Task 1 confirmed.

- [ ] **Step 4: Register and run**

Add `pdfaOperation` to `DOCUMENT_OPERATIONS`.

Run: `npx vitest run lib/operations/`
Expected: PASS — including the registry test from Task 2, which has been failing since Task 3 and now finds an operation for all four kinds.

- [ ] **Step 5: Add the live check**

```typescript
// in lib/operations/operations.integration.test.ts
it('PDF/A conversion runs and returns a different document', async () => {
  // Deliberately weaker than the other two: asserting real PDF/A conformance
  // needs a validator this project does not have, and a test implying
  // compliance it never checked would be worse than one claiming less.
  const request = pdfaOperation.parse({
    kind: 'PDFA',
    conformance: PDFA_CONFORMANCE_LEVELS[0],
  });
  if (!request.ok) throw new Error(request.message);

  const source = await samplePdf();

  const processed = await documentProvider().processDocument({
    source,
    filename: 'report.pdf',
    instructions: request.buildInstructions({ filePartName: 'document' }),
  });

  expect(processed.byteLength).toBeGreaterThan(0);
  expect(new Uint8Array(processed)).not.toEqual(source);
}, 120_000);
```

- [ ] **Step 6: Run against a live engine**

Run: `npx vitest run lib/operations/operations.integration.test.ts`
Expected: **3 passed**, not skipped.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add PDF/A conversion"
```

---

### Task 9: The Tools menu

**Files:**
- Create: `components/document-tools.tsx`
- Create: `components/document-tools.test.tsx`
- Delete: `components/redaction-panel.tsx`, `components/redaction-panel.test.tsx`
- Modify: `app/documents/[id]/page.tsx:180`

**Interfaces:**
- Consumes: `operationsFor(target)` from Task 2, called in the server component and passed as a prop so the client never imports `nutrientConfig`.
- Produces: `DocumentTools({ documentId, canRunTools, operations })`.

- [ ] **Step 1: Write the failing tests**

```typescript
// components/document-tools.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentTools } from '@/components/document-tools';
import { ocrOperation } from '@/lib/operations/ocr';
import { redactionOperation } from '@/lib/operations/redaction';

const operations = [redactionOperation, ocrOperation];

describe('The tools menu', () => {
  it('keeps the tools out of the way until asked for', () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    expect(screen.queryByText('Convert to PDF/A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tools/i })).toBeInTheDocument();
  });

  it('offers only the operations it was given', async () => {
    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));

    expect(screen.getByText('OCR')).toBeInTheDocument();
    expect(screen.queryByText('Convert to PDF/A')).not.toBeInTheDocument();
  });

  it('posts the kind of the operation that was chosen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ job: { id: 'job_1' } }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<DocumentTools documentId="doc_1" canRunTools operations={operations} />);

    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    await userEvent.click(screen.getByText('OCR'));
    await userEvent.click(screen.getByRole('button', { name: /run/i }));

    const posted = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual(
      expect.objectContaining({ kind: 'OCR' })
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run components/document-tools.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the component**

Start from `components/redaction-panel.tsx` and keep its job-polling, error handling and busy state unchanged — only the controls change. Add: a collapsed `Tools` button toggling a list of `operations`; on selection, render that operation's `fields` (a `<select>` for `select`, an `<input>` for `text`, and the existing preset/regex controls for `preset-or-regex`); and a submit that posts `{ kind, ...fieldValues }`. Label each job in the history with `operations.find(o => o.kind === job.kind)?.label ?? job.kind`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run components/document-tools.test.tsx`
Expected: PASS.

- [ ] **Step 5: Swap it into the page**

In `app/documents/[id]/page.tsx`, replace the `RedactionPanel` import and its use at line 180:

```tsx
import { DocumentTools } from '@/components/document-tools';
import { nutrientConfig } from '@/lib/nutrient-config';
import { operationsFor } from '@/lib/operations';

// ... inside the component, beside the existing canRedact calculation:
const operations = operationsFor(nutrientConfig().target);

// ... at line 180:
<DocumentTools documentId={document.id} canRunTools={canRedact} operations={operations} />
```

Rename the local `canRedact` to `canRunTools`, keeping its existing condition unchanged.

- [ ] **Step 6: Delete the old panel**

```bash
git rm components/redaction-panel.tsx components/redaction-panel.test.tsx
```

- [ ] **Step 7: Run the full gate**

Run: `pnpm pre-commit`
Expected: all pass.

- [ ] **Step 8: Verify in a browser against both backends**

Per `docs/testing-against-document-engine.md`: with `NUTRIENT_TARGET=document-engine`, open a document, run each of the four operations, and confirm each produces a derived document with lineage. Then set `NUTRIENT_TARGET=dws` and spot-check **one** operation — every DWS `/build` call is billed, so do not run the full matrix there.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: replace the redaction panel with a tools menu"
```

---

## Notes for the executor

- **Task 1 gates Tasks 6–8.** The action JSON and enumerated values in those tasks are structural placeholders showing the shape of the module; the real values come from the probe. If a probe contradicts what a task shows, the probe wins.
- **The registry test fails on purpose** between Task 3 and Task 8. That is the guard that a job kind cannot exist with no operation to run it.
- **If an operation's shape will not fit `ProcessInstructions`**, stop and report rather than widening the type. The spec says to drop that operation instead.
