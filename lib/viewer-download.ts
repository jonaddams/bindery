/**
 * Naming what the viewer's download button saves.
 *
 * The SDK's built-in `export-pdf` toolbar button saves as "document.pdf" and has
 * no option to name the file (checked against the Web SDK API reference and the
 * download-button guide, 2026-10-08). The guide's answer is a custom toolbar
 * button that calls `instance.exportPDF()`, so that is what replaces it — in the
 * same place, so the toolbar does not change shape.
 */

/** Every viewer export is a PDF, so the name ends `.pdf` whatever was uploaded. */
export const pdfFilename = (filename: string): string => {
  if (/\.pdf$/i.test(filename)) return filename;
  const extension = filename.lastIndexOf('.');
  return `${extension > 0 ? filename.slice(0, extension) : filename}.pdf`;
};

/** The same download arrow the rest of the app uses, as the SVG string the SDK wants. */
const DOWNLOAD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>' +
  '</svg>';

export const withNamedDownload = (options: {
  items: readonly NutrientToolbarItem[];
  onDownload: () => void;
}): NutrientToolbarItem[] =>
  options.items.map((item) =>
    item.type === 'export-pdf'
      ? {
          type: 'custom',
          id: 'download-pdf',
          title: 'Download',
          icon: DOWNLOAD_ICON,
          onPress: options.onDownload,
        }
      : item
  );

/** Hand the browser a file to save under `filename`. */
export const saveFile = (options: { bytes: ArrayBuffer; filename: string }): void => {
  const url = URL.createObjectURL(new Blob([options.bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = options.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
