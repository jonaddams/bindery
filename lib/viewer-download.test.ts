import { afterEach, describe, expect, it, vi } from 'vitest';
import { pdfFilename, saveFile, withNamedDownload } from '@/lib/viewer-download';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Naming a downloaded PDF', () => {
  it('keeps a PDF’s own name', () => {
    expect(pdfFilename('Q3 Contract.pdf')).toBe('Q3 Contract.pdf');
  });

  // What the viewer exports is always a PDF, whatever was uploaded.
  it('gives anything else a .pdf extension in place of its own', () => {
    expect(pdfFilename('minutes.docx')).toBe('minutes.pdf');
    expect(pdfFilename('receipt')).toBe('receipt.pdf');
  });
});

describe('The viewer toolbar’s download button', () => {
  const defaults = [
    { type: 'pager' },
    { type: 'print' },
    { type: 'export-pdf' },
    { type: 'search' },
  ] as const;

  // The built-in button saves as "document.pdf" and the SDK offers no option
  // to name it, so it is replaced, in place, by one that can.
  it('replaces the built-in export button in the same place', () => {
    const onDownload = vi.fn();

    const items = withNamedDownload({ items: defaults, onDownload });

    expect(items.map((item) => item.type)).toEqual(['pager', 'print', 'custom', 'search']);
    expect(items[2]).toEqual(
      expect.objectContaining({ id: 'download-pdf', title: 'Download', icon: expect.any(String) })
    );
  });

  it('downloads through the handler it was given', () => {
    const onDownload = vi.fn();

    withNamedDownload({ items: defaults, onDownload })[2].onPress?.();

    expect(onDownload).toHaveBeenCalled();
  });

  it('leaves a toolbar with no export button alone', () => {
    const items = withNamedDownload({ items: [{ type: 'pager' }], onDownload: vi.fn() });

    expect(items).toEqual([{ type: 'pager' }]);
  });
});

describe('Saving the exported bytes', () => {
  it('saves them under the name given', () => {
    const createObjectURL = vi.fn(() => 'blob:exported');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    saveFile({ bytes: new ArrayBuffer(3), filename: 'Q3 Contract.pdf' });

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('Q3 Contract.pdf');
    expect(clicked[0].href).toBe('blob:exported');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:exported');
  });
});
