'use client';

import type { Document } from '@prisma/client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/bindery/avatar';
import { BI } from '@/components/bindery/icons';
import { useSession } from '@/lib/auth-client';

type DocumentWithOwner = Document & {
  ownerId: string;
  owner: {
    name: string | null;
    email: string;
  };
};

type Scope = 'all' | 'mine' | 'shared';

const SCOPES: ReadonlyArray<readonly [Scope, string]> = [
  ['all', 'All'],
  ['mine', 'Mine'],
  ['shared', 'Shared with me'],
];

const formatFileSize = (bytes: bigint | null) => {
  if (!bytes || bytes === BigInt(0)) return '0 Bytes';
  const bytesNumber = Number(bytes);
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytesNumber) / Math.log(k));
  return `${Math.round((bytesNumber / k ** i) * 100) / 100} ${sizes[i]}`;
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function FileIcon({ document }: { document: DocumentWithOwner }) {
  const extension = document.filename.split('.').pop()?.toLowerCase() ?? '';
  const tone = extension.startsWith('doc')
    ? 'docx'
    : document.fileType.startsWith('image/')
      ? 'img'
      : '';
  return (
    <span className={`bnd-ficon ${tone}`} aria-hidden="true">
      {extension.slice(0, 4).toUpperCase()}
    </span>
  );
}

type RowMenuProps = {
  document: DocumentWithOwner;
  canDelete: boolean;
  onDelete: () => void;
};

function RowMenu({ document, canDelete, onDelete }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.document.addEventListener('mousedown', onPointer);
    window.document.addEventListener('keydown', onKey);
    return () => {
      window.document.removeEventListener('mousedown', onPointer);
      window.document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copyLink = () => {
    setOpen(false);
    void navigator.clipboard?.writeText(`${window.location.origin}/documents/${document.id}`);
  };

  const label = `Actions for ${document.title}`;

  return (
    <div className="bnd-pop" ref={ref}>
      <button
        className="bnd-ib"
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {BI.more(16)}
      </button>
      {open && (
        <div className="bnd-menu" role="menu">
          <Link href={`/documents/${document.id}`} className="mi" role="menuitem">
            {BI.docs(15)} Open
          </Link>
          <button className="mi" type="button" role="menuitem" onClick={copyLink}>
            {BI.link(15)} Copy link
          </button>
          {canDelete && (
            <>
              <hr />
              <button
                className="mi bad"
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                {BI.trash(15)} Delete…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type DeleteModalProps = {
  title: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function DeleteModal({ title, isDeleting, onConfirm, onCancel }: DeleteModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) onCancel();
    };
    window.document.addEventListener('keydown', onKey);
    return () => window.document.removeEventListener('keydown', onKey);
  }, [isDeleting, onCancel]);

  return (
    <div className="bnd-scrim">
      <div className="bnd-modal" role="dialog" aria-modal="true" aria-label="Delete this document?">
        <div className="bnd-modal-h">
          <span className="bnd-warnic">{BI.alert(18)}</span>
          <h2>Delete this document?</h2>
          <button
            className="bnd-ib"
            type="button"
            aria-label="Close"
            onClick={onCancel}
            disabled={isDeleting}
            style={{ margin: '-6px -6px 0 0' }}
          >
            {BI.x(16)}
          </button>
        </div>
        <div className="bnd-modal-b">
          <p style={{ margin: 0, color: 'var(--ink-2)', textWrap: 'pretty' }}>
            <b style={{ color: 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>
              {title}
            </b>{' '}
            will be removed permanently. You can&apos;t undo this.
          </p>
        </div>
        <div className="bnd-modal-f">
          <button className="btn ghost" type="button" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </button>
          <button
            className="btn bnd-danger"
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentList() {
  const { data: session, isPending } = useSession();
  const [documents, setDocuments] = useState<DocumentWithOwner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    documentId: string;
    documentTitle: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/documents');
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const isMine = (document: DocumentWithOwner) => document.ownerId === session?.user?.id;

  const canDeleteDocument = (document: DocumentWithOwner) => {
    // Don't show delete buttons if session is still loading
    if (isPending || !session?.user) return false;

    // User can delete if they own the document
    if (document.ownerId === session.user.id) return true;

    // Mirrors `isActingAsAdmin` in lib/auth.ts, which is the actual control —
    // this only decides whether to draw the button. The two disagreed until
    // September 2026: this read `=== 'ADMIN'` while the server read
    // `!== 'SELF'`, so in the old USER mode the button was hidden while the API
    // would have allowed the delete. Keep them in step, and remember that the
    // server is the half that matters.
    if (session.user.role === 'ADMIN' && session.user.currentImpersonationMode === 'ADMIN') {
      return true;
    }

    return false;
  };

  const handleDeleteClick = (document: DocumentWithOwner) => {
    setDeleteConfirmation({
      documentId: document.id,
      documentTitle: document.title,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmation) return;

    try {
      setIsDeleting(true);

      const response = await fetch(`/api/documents/${deleteConfirmation.documentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete document');
      }

      // Remove the document from the local state
      setDocuments((prev) => prev.filter((doc) => doc.id !== deleteConfirmation.documentId));
      setDeleteConfirmation(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirmation(null);
  }, []);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading documents"
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '48px 0',
          color: 'var(--ink-3)',
        }}
      >
        <span className="bnd-spin lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bnd-alert bad" role="alert">
        {BI.xcircle(18)}
        <div>
          <b>Error loading documents</b>
          <p>{error}</p>
          <button
            type="button"
            className="btn ghost sm"
            onClick={fetchDocuments}
            style={{ marginTop: 10 }}
          >
            {BI.retry(13)} Try again
          </button>
        </div>
      </div>
    );
  }

  const counts: Record<Scope, number> = {
    all: documents.length,
    mine: documents.filter(isMine).length,
    shared: documents.filter((document) => !isMine(document)).length,
  };

  const needle = query.trim().toLowerCase();
  const visible = documents
    .filter((document) =>
      scope === 'all' ? true : scope === 'mine' ? isMine(document) : !isMine(document)
    )
    .filter(
      (document) =>
        !needle ||
        document.title.toLowerCase().includes(needle) ||
        document.filename.toLowerCase().includes(needle)
    );

  const ownerLabel = (document: DocumentWithOwner) =>
    isMine(document) ? 'You' : document.owner.name || document.owner.email;

  return (
    <>
      <div className="bnd-head">
        <div>
          <h1 className="bnd-h1">Documents</h1>
          {documents.length > 0 && (
            <p className="bnd-sub">
              {`${plural(counts.all, 'document')} · ${counts.shared} shared with you`}
            </p>
          )}
        </div>
        {documents.length > 0 && (
          <Link href="/upload" className="btn bnd-hide-m" style={{ color: 'var(--bg)' }}>
            {BI.upload(15)} Upload document
          </Link>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="bnd-empty">
          <span className="ic">{BI.docs(22)}</span>
          <h3>No documents yet</h3>
          <p>Upload a PDF, Word file or scan to get started.</p>
          <Link href="/upload" className="btn" style={{ color: 'var(--bg)' }}>
            {BI.upload(15)} Upload a document
          </Link>
          <span className="bnd-hint" style={{ marginTop: 6 }}>
            Documents colleagues share with you will appear here too.
          </span>
        </div>
      ) : (
        <>
          <div className="bnd-toolbar">
            <div className="bnd-search">
              {BI.search(15)}
              <input
                className="bnd-input"
                placeholder="Search documents"
                aria-label="Search documents"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="bnd-seg">
              {SCOPES.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={scope === key ? 'on' : ''}
                  aria-pressed={scope === key}
                  onClick={() => setScope(key)}
                >
                  {label} <span className="n">{counts[key]}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="bnd-empty slim">
              <h3>No matches</h3>
              <p>
                {needle ? `Nothing matches “${query.trim()}”` : 'Nothing here'}
                {scope !== 'all' ? ' in this view' : ''}.
              </p>
              <button
                className="bnd-link"
                type="button"
                onClick={() => {
                  setQuery('');
                  setScope('all');
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="bnd-list">
              <div className="bnd-lh" aria-hidden="true">
                <span>Name</span>
                <span>Size</span>
                <span>Owner</span>
                <span>Created</span>
                <span />
              </div>
              {visible.map((document) => (
                <div key={document.id} className="bnd-lr" style={{ cursor: 'default' }}>
                  <div className="bnd-name">
                    <FileIcon document={document} />
                    <div className="tx">
                      <div className="t">
                        <b>
                          <Link href={`/documents/${document.id}`} style={{ color: 'inherit' }}>
                            {document.title}
                          </Link>
                        </b>
                      </div>
                      <span className="m">
                        {formatFileSize(document.fileSize)} · {ownerLabel(document)} ·{' '}
                        {formatDate(document.createdAt)}
                      </span>
                    </div>
                  </div>
                  <span className="c">{formatFileSize(document.fileSize)}</span>
                  <span className="c who">
                    <Avatar
                      id={document.ownerId}
                      name={document.owner.name || document.owner.email}
                      size="sm"
                    />
                    {ownerLabel(document)}
                  </span>
                  <span className="c">{formatDate(document.createdAt)}</span>
                  <RowMenu
                    document={document}
                    canDelete={canDeleteDocument(document)}
                    onDelete={() => handleDeleteClick(document)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {deleteConfirmation && (
        <DeleteModal
          title={deleteConfirmation.documentTitle}
          isDeleting={isDeleting}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </>
  );
}
