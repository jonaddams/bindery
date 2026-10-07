// @vitest-environment node

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { looksScanned } from '@/lib/scan-detection';

/** A minimal PDF from object bodies, with a correct xref so it is a real file. */
const pdfFrom = (objects: readonly (string | Buffer)[]): Uint8Array => {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  let length = parts[0].length;
  const offsets = objects.map((body, index) => {
    const offset = length;
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(chunk);
    length += chunk.length;
    return offset;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ].join('');
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(xref)]));
};

const stream = (dictionary: string, data: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from('\nendstream'),
  ]);

const textPdf = () =>
  pdfFrom([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream('', Buffer.from('BT /F1 18 Tf 72 700 Td (Hello) Tj ET')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);

/** What a scanner produces: a page that is one image and nothing else. */
const scannedPdf = () =>
  pdfFrom([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    stream('', Buffer.from('q 612 0 0 792 0 0 cm /Im1 Do Q')),
    stream(
      '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8',
      Buffer.from([0, 255, 255, 0])
    ),
  ]);

/**
 * Text whose font is declared inside a compressed object stream, which is how
 * most modern writers — including both backends — lay a PDF out. A detector
 * that only searched the raw bytes would call this a scan.
 */
const textPdfWithObjectStream = () => {
  const font = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const header = '6 0 ';
  const packed = deflateSync(Buffer.from(`${header}${font}`));
  return pdfFrom([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /F 6 0 R >> >>',
    stream('', Buffer.from('BT 18 Tf 72 700 Td (Hello) Tj ET')),
    stream(`/Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode`, packed),
  ]);
};

describe('Telling whether a document is a scan', () => {
  it('calls a PDF with text in it not a scan', () => {
    expect(looksScanned({ bytes: textPdf(), fileType: 'application/pdf' })).toBe(false);
  });

  it('calls a PDF whose pages are only images a scan', () => {
    expect(looksScanned({ bytes: scannedPdf(), fileType: 'application/pdf' })).toBe(true);
  });

  it('finds text whose font is declared inside a compressed object stream', () => {
    expect(looksScanned({ bytes: textPdfWithObjectStream(), fileType: 'application/pdf' })).toBe(
      false
    );
  });

  // A photo of a page has no text layer by definition.
  it('calls an image a scan', () => {
    expect(looksScanned({ bytes: new Uint8Array([0x89, 0x50]), fileType: 'image/png' })).toBe(true);
  });

  // Office files are text by construction; OCR would have nothing to add.
  it('does not call an Office document a scan', () => {
    expect(
      looksScanned({
        bytes: new Uint8Array([0x50, 0x4b]),
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe(false);
  });
});
