// @vitest-environment node

/**
 * Operations against a real Document Engine. Skipped when none is reachable, so
 * confirm this file reports passes rather than skips before believing it.
 */
import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { documentProvider } from '@/lib/document-provider';
import { compressOperation } from '@/lib/operations/compress';
import { flattenOperation } from '@/lib/operations/flatten';
import { ocrOperation } from '@/lib/operations/ocr';
import { PDFA_CONFORMANCE_LEVELS, pdfaOperation } from '@/lib/operations/pdfa';
import { pdfuaOperation } from '@/lib/operations/pdfua';
import { rotateOperation } from '@/lib/operations/rotate';
import type { DocumentOperation } from '@/lib/operations/types';
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

/**
 * The PDF's bytes with every Flate stream inflated alongside, so a structural
 * marker can be found whether it sits in a plain object or a compressed object
 * stream. Same walk as `hasSelectableTextLayer`, for markers other than text.
 */
const inflatedText = (pdf: Uint8Array): string => {
  const buffer = Buffer.from(pdf);
  const parts: Buffer[] = [buffer];
  let searchFrom = 0;
  for (;;) {
    const streamAt = buffer.indexOf('stream', searchFrom);
    if (streamAt === -1) break;
    let dataStart = streamAt + 'stream'.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const endAt = buffer.indexOf('endstream', dataStart);
    if (endAt === -1) break;
    try {
      parts.push(inflateSync(buffer.subarray(dataStart, endAt)));
    } catch {
      // Not Flate — irrelevant to the markers looked for here.
    }
    searchFrom = endAt + 'endstream'.length;
  }
  return Buffer.concat(parts).toString('latin1');
};

/** Counts FreeText annotations and form widgets, however the writer spaced the names. */
const annotationCount = (pdf: Uint8Array): number =>
  (inflatedText(pdf).match(/\/Subtype\s*\/(FreeText|Widget)\b/g) ?? []).length;

/**
 * A one-page PDF with body text, a filled form field and a FreeText annotation,
 * written by hand so the fixture does not depend on the system under test.
 */
const annotatedPdf = (): Uint8Array<ArrayBuffer> => {
  const content = 'BT /F1 18 Tf 72 700 Td (PROBE BODY TEXT) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /NeedAppearances true >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Annots [6 0 R 7 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (probefield) /V (FIELDVALUE) ' +
      '/Rect [72 600 300 630] /P 3 0 R /DA (/Helv 12 Tf 0 g) /F 4 >>',
    '<< /Type /Annot /Subtype /FreeText /Rect [72 500 300 540] /Contents (ANNOTATION TEXT) ' +
      '/DA (/Helv 12 Tf 0 g) /P 3 0 R /F 4 >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
};

/** A noisy, photo-like image as a one-page PDF: compression needs something to chew on. */
const imagePdf = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const width = 600;
  const height = 600;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed & 0xff;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = (x + random() / 4) & 0xff;
      rows[at + 1] = (y + random() / 4) & 0xff;
      rows[at + 2] = random();
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const body = new FormData();
  body.set('instructions', JSON.stringify({ parts: [{ file: 'page' }] }));
  body.set('page', new File([png], 'page.png', { type: 'image/png' }));
  const response = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: { Authorization: `Token token=${token}` },
    body,
  });
  return new Uint8Array(await response.arrayBuffer());
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

  const run = async (
    operation: DocumentOperation,
    request: Record<string, unknown>,
    source: Uint8Array<ArrayBuffer>
  ): Promise<Uint8Array> => {
    const parsed = operation.parse({ kind: operation.kind, ...request });
    if (!parsed.ok) throw new Error(parsed.message);
    const processed = await documentProvider().processDocument({
      source,
      filename: 'report.pdf',
      instructions: parsed.buildInstructions({ filePartName: 'document' }),
    });
    return new Uint8Array(processed);
  };

  // A structure tree is what makes a PDF tagged; the pdfuaid entry in its XMP
  // metadata is what claims PDF/UA. Not a conformance check — that needs a
  // validator — but both markers are absent from the source.
  it('PDF/UA tags the document and declares itself PDF/UA', async () => {
    const source = await samplePdf();
    expect(inflatedText(source)).not.toContain('pdfuaid');

    const output = inflatedText(await run(pdfuaOperation, {}, source));

    expect(output).toContain('/StructTreeRoot');
    expect(output).toContain('pdfuaid');
  }, 120_000);

  it('rotate turns the page', async () => {
    const output = inflatedText(await run(rotateOperation, { degrees: '90' }, await samplePdf()));

    expect(output).toMatch(/\/Rotate\s+90\b/);
  }, 120_000);

  it('flatten removes annotations while keeping what they showed', async () => {
    const source = annotatedPdf();
    expect(annotationCount(source)).toBe(2);

    const output = await run(flattenOperation, {}, source);

    expect(annotationCount(output)).toBe(0);
    expect(await extractText(new Uint8Array(output))).toContain('ANNOTATION TEXT');
  }, 120_000);

  // Measured at 718 KB → 22 KB when probing; "under half" leaves room for
  // engine versions to differ without letting a no-op pass.
  it('compress shrinks an image-heavy document substantially', async () => {
    const source = await imagePdf();

    const output = await run(compressOperation, { level: 'maximum' }, source);

    expect(output.byteLength).toBeLessThan(source.byteLength / 2);
  }, 120_000);
});
