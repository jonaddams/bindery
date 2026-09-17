// @vitest-environment node

/**
 * Operations against a real Document Engine. Skipped when none is reachable, so
 * confirm this file reports passes rather than skips before believing it.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { documentProvider } from '@/lib/document-provider';
import { ocrOperation } from '@/lib/operations/ocr';
import { PDFA_CONFORMANCE_LEVELS, pdfaOperation } from '@/lib/operations/pdfa';
import { watermarkOperation } from '@/lib/operations/watermark';

const baseUrl = process.env.DOCUMENT_ENGINE_TEST_URL ?? 'http://localhost:5001';
const token = process.env.DOCUMENT_ENGINE_TEST_TOKEN ?? 'secret';

const privateKey = (() => {
  try {
    return readFileSync(
      `${__dirname}/../../docker/document-engine/secrets/jwt-private.pem`,
      'utf8'
    );
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

/** A plain text PDF, for operations that just need something to stamp or extract from. */
const samplePdf = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const body = new FormData();
  body.set('instructions', JSON.stringify({ parts: [{ html: 'index.html' }] }));
  body.set(
    'index.html',
    new File(['<html><body><p>Ordinary report body text.</p></body></html>'], 'index.html', {
      type: 'text/html',
    })
  );

  const response = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body,
  });

  return new Uint8Array(await response.arrayBuffer());
};

/** A page of rasterised text: OCR has nothing to do on a PDF that already has a text layer. */
const scannedPdf = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const body = new FormData();
  body.set(
    'instructions',
    JSON.stringify({
      parts: [{ html: 'index.html' }],
      output: { type: 'image', format: 'png', dpi: 150 },
    })
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

/**
 * Whether a PDF carries a real, copyable text layer — checked by decompressing
 * every Flate-encoded stream in the file and looking for a `/ToUnicode` CMap,
 * the marker that lets a reader turn a glyph code back into actual text.
 *
 * **Not the same check as `extractText` below, and deliberately so.** Building
 * this fixture surfaced a real behaviour of this Document Engine (1.18.1,
 * evaluation build): `json-content` extraction with `plainText: true` silently
 * falls back to running OCR itself whenever a page has no text layer — no
 * `ocr`/`disableOcr`/`contentAnalysis` field in the instructions, at any
 * nesting, turns it off (all tried while diagnosing this). So `extractText`
 * reports "SCANNED PROBE TEXT" for the *pre-OCR* scan too, and cannot
 * distinguish "the fixture already had text" from "extraction just OCR'd it
 * for me" — which means it cannot prove this test's premise. This function
 * inspects the PDF's own structure instead, which extraction cannot influence:
 * confirmed empirically (via `pdftotext`, independent of this engine) that the
 * wrapped scan has no real text layer and gains a `/Type0` composite font plus
 * a `/ToUnicode` CMap only after the `ocr` action actually runs.
 *
 * **This is a sufficient marker for this fixture, not a general test for "does
 * this PDF have text".** A standard-14 font with WinAnsiEncoding needs no
 * `/ToUnicode` and is perfectly copyable, so a born-digital PDF using one would
 * read `false` here despite having real text — the premise would then pass for
 * the wrong reason. Safe today only because `scannedPdf()` below is
 * image-only: no fonts at all before OCR runs. Do not reuse this helper
 * against a different fixture without re-checking that assumption.
 */
const hasSelectableTextLayer = (pdf: Uint8Array<ArrayBuffer>): boolean => {
  const buffer = Buffer.from(pdf);
  const decompressed: Buffer[] = [buffer];

  let searchFrom = 0;
  for (;;) {
    const streamAt = buffer.indexOf('stream', searchFrom);
    if (streamAt === -1) break;

    // Skip the end-of-line after the `stream` keyword: CRLF or a lone LF.
    let dataStart = streamAt + 'stream'.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const endAt = buffer.indexOf('endstream', dataStart);
    if (endAt === -1) break;

    try {
      decompressed.push(inflateSync(buffer.subarray(dataStart, endAt)));
    } catch {
      // Not every stream is Flate-encoded — images commonly use DCTDecode —
      // and this check only needs the ones that are.
    }

    searchFrom = endAt + 'endstream'.length;
  }

  return Buffer.concat(decompressed).includes('/ToUnicode');
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

// No `afterAll` cleanup here: every test in this file calls `processDocument`
// directly against in-memory bytes, never `uploadDocument`, so nothing is ever
// stored on the engine for a test in this file to delete afterwards.

describe.skipIf(!engineIsRunning)('Operations against a real engine', () => {
  beforeEach(() => {
    process.env.NUTRIENT_TARGET = 'document-engine';
    process.env.NUTRIENT_BASE_URL = baseUrl;
    process.env.DOCUMENT_ENGINE_API_TOKEN = token;
    process.env.DOCUMENT_ENGINE_JWT_PRIVATE_KEY = privateKey;
  });

  it('OCR adds a text layer a scan did not have', async () => {
    const scan = await scannedPdf();

    // The premise: no text layer before. If this fails the fixture is wrong,
    // not OCR. (Checked structurally, not via `extractText` — see the comment
    // on `hasSelectableTextLayer` for why extraction cannot tell this apart.)
    expect(hasSelectableTextLayer(scan)).toBe(false);

    const request = ocrOperation.parse({ kind: 'OCR', language: 'english' });
    if (!request.ok) throw new Error(request.message);

    const processed = await documentProvider().processDocument({
      source: scan,
      filename: 'scan.pdf',
      instructions: request.buildInstructions({ filePartName: 'document' }),
    });

    const processedBytes = new Uint8Array(processed);

    // The structural proof this action ran: a real, copyable text layer now
    // exists where there was none.
    expect(hasSelectableTextLayer(processedBytes)).toBe(true);
    // User-facing smoke check only. Extraction OCRs on demand (see
    // `hasSelectableTextLayer`'s comment above), so this cannot distinguish a
    // real text layer from extraction recognising one on the fly, and nothing
    // here proves OCR recognised the *correct* text rather than extraction's
    // own fallback independently arriving at the same reading. That gap is
    // accepted, not a defect — it just should not be described as covered.
    expect(await extractText(processedBytes)).toContain('SCANNED PROBE TEXT');
  }, 180_000);

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

    // Extraction here is genuine evidence the watermark is visually present in
    // the output — not proof of reading a pre-existing text layer. This engine
    // silently runs its own OCR when a page lacks a text layer (see the comment
    // on `hasSelectableTextLayer` above), but `samplePdf()` is HTML-rendered and
    // already has a real text layer, so this extraction is reading text, not
    // triggering that fallback.
    expect(await extractText(new Uint8Array(processed))).toContain('ZZTOPSECRETZZ');
  }, 120_000);

  it('PDF/A conversion runs and returns a different document', async () => {
    // Deliberately weaker than the other two: asserting real PDF/A conformance
    // needs a validator this project does not have, and a test implying
    // compliance it never checked would be worse than one claiming less. This
    // only proves the operation ran and produced a different document — not
    // that the output is genuinely PDF/A-conformant.
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
});
