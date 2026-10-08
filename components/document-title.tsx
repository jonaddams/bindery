'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { BI } from '@/components/bindery/icons';
import { TITLE_MAX_LENGTH } from '@/lib/document-title';

type DocumentTitleProps = {
  documentId: string;
  title: string;
  /** Write access, the same rule the update route applies. */
  canRename: boolean;
};

/**
 * The document page's heading, renamed in place by anyone who may edit it.
 * Enter saves and Escape cancels; the route trims and validates the title, and
 * any refusal is shown here with the text left for editing.
 */
export function DocumentTitle({ documentId, title, canRename }: DocumentTitleProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(title);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null || !draft.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft }),
      });
      const body: { document?: { title?: string }; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'The document could not be renamed.');
        return;
      }

      setCurrent(body.document?.title ?? draft.trim());
      setDraft(null);
      // The browser tab, the list and the rail all show the title too.
      router.refresh();
    } catch {
      setError('The document could not be renamed.');
    } finally {
      setIsSaving(false);
    }
  };

  if (draft === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <h1 className="bnd-h1" style={{ overflowWrap: 'anywhere' }}>
          {current}
        </h1>
        {canRename && (
          <button
            type="button"
            className="bnd-ib"
            aria-label="Rename"
            title="Rename"
            onClick={() => setDraft(current)}
          >
            {BI.pen(15)}
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="bnd-input"
          aria-label="Document title"
          value={draft}
          maxLength={TITLE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel();
          }}
          disabled={isSaving}
          // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this field
          autoFocus
          style={{ flex: 1, minWidth: 200, fontSize: 18 }}
        />
        <button type="submit" className="btn sm" disabled={isSaving || !draft.trim()}>
          Save
        </button>
        <button type="button" className="btn ghost sm" onClick={cancel} disabled={isSaving}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="bnd-hint bad" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}
