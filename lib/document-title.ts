/** Long enough for any real title; short enough to fit a list row and a page heading. */
export const TITLE_MAX_LENGTH = 200;

/** A document title as a caller sent it, trimmed — or why it cannot be used. */
export const parseTitle = (
  raw: unknown
): { ok: true; title: string } | { ok: false; message: string } => {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, message: 'Give the document a title.' };
  }

  const title = raw.trim();

  if (title.length > TITLE_MAX_LENGTH) {
    return {
      ok: false,
      message: `A title can be at most ${TITLE_MAX_LENGTH} characters.`,
    };
  }

  return { ok: true, title };
};
