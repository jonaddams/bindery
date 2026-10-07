import { inflateSync } from 'node:zlib';

/**
 * Whether a document is probably a scan — pages that are pictures of text
 * rather than text — and so would gain from OCR.
 *
 * A PDF with no font anywhere cannot draw a single character, so it can only
 * hold images. That is cheap to check in-process: no API call, no credits. It is
 * a heuristic in one direction only — a PDF that declares a font but draws its
 * text as an image would pass as "not scanned" — which is the safe direction for
 * a suggestion.
 *
 * Fonts are usually declared inside compressed object streams, so those are
 * inflated; image streams are not, which keeps a 100 MB scan cheap to check.
 */
export const looksScanned = (options: { bytes: Uint8Array; fileType: string }): boolean => {
  const { bytes, fileType } = options;

  if (fileType.startsWith('image/')) {
    return true;
  }

  if (fileType !== 'application/pdf') {
    return false;
  }

  return !declaresFont(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
};

const FONT = '/Font';
/** How far back from `stream` to look for the stream's dictionary. */
const DICTIONARY_WINDOW = 512;
/**
 * Uploads are untrusted, and a few KB of Flate can expand to gigabytes. Real
 * object streams are kilobytes to low megabytes, so expansion stops at these
 * caps — per stream, and across the file so many small bombs cannot add up. A
 * stream past its cap is treated as unreadable, which errs towards "scanned":
 * at worst an OCR suggestion, never a crashed upload.
 */
const MAX_INFLATED_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_INFLATED_TOTAL_BYTES = 32 * 1024 * 1024;

const declaresFont = (pdf: Buffer): boolean => {
  if (pdf.includes(FONT)) {
    return true;
  }

  let budget = MAX_INFLATED_TOTAL_BYTES;
  let searchFrom = 0;
  for (;;) {
    const streamAt = pdf.indexOf('stream', searchFrom);
    if (streamAt === -1) return false;

    const endAt = pdf.indexOf('endstream', streamAt);
    if (endAt === -1) return false;
    searchFrom = endAt + 'endstream'.length;

    // `endstream` also contains `stream`; skip matches that are its tail.
    if (pdf.subarray(streamAt - 3, streamAt).toString('latin1') === 'end') continue;

    const dictionary = pdf
      .subarray(Math.max(0, streamAt - DICTIONARY_WINDOW), streamAt)
      .toString('latin1');
    if (!/\/Type\s*\/ObjStm\b/.test(dictionary.slice(dictionary.lastIndexOf('<<')))) continue;

    let dataStart = streamAt + 'stream'.length;
    if (pdf[dataStart] === 0x0d) dataStart += 1;
    if (pdf[dataStart] === 0x0a) dataStart += 1;

    if (budget <= 0) return false;

    try {
      const inflated = inflateSync(pdf.subarray(dataStart, endAt), {
        maxOutputLength: Math.min(MAX_INFLATED_STREAM_BYTES, budget),
      });
      budget -= inflated.length;
      if (inflated.includes(FONT)) return true;
    } catch {
      // Not Flate-encoded, damaged, or over its cap: nothing readable to search.
      budget -= MAX_INFLATED_STREAM_BYTES;
    }
  }
};
