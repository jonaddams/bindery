'use client';

import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';
import { BI } from '@/components/bindery/icons';
import { stagedUploadPathname } from '@/lib/staged-upload';

type UploadState = {
  isUploading: boolean;
  error: string | null;
  success: boolean;
};

// An error response is not always ours: Vercel answers some failures in plain
// text before the route runs, so the body cannot be assumed to be JSON.
const describeFailedResponse = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  const error: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'error') : undefined;
  return typeof error === 'string' && error ? error : `Upload failed (${response.status})`;
};

const WORD_EXTENSIONS = new Set(['doc', 'docx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'webp']);

const fileIconVariant = (extension: string): string => {
  if (WORD_EXTENSIONS.has(extension)) return 'docx';
  if (IMAGE_EXTENSIONS.has(extension)) return 'img';
  return '';
};

export function FileUpload({ uploaderId }: { uploaderId: string }) {
  const router = useRouter();
  const fileUploadId = useId();
  const titleInputId = useId();
  const authorInputId = useId();
  const titleHintId = useId();

  const [uploadState, setUploadState] = useState<UploadState>({
    isUploading: false,
    error: null,
    success: false,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  const resetUploadState = useCallback(() => {
    setUploadState({
      isUploading: false,
      error: null,
      success: false,
    });
  }, []);

  const handleFileSelect = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setTitle(file.name.replace(/\.[^/.]+$/, '')); // Use filename without extension as default title
      setAuthor('');
      resetUploadState();
    },
    [resetUploadState]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);

      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadState((prev) => ({ ...prev, isUploading: true, error: null }));

      try {
        const staged = await upload(
          stagedUploadPathname({ uploaderId, filename: file.name }),
          file,
          {
            access: 'private',
            handleUploadUrl: '/api/documents/upload-token',
            multipart: true,
          }
        );

        const response = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pathname: staged.pathname, filename: file.name, title, author }),
        });

        if (!response.ok) {
          throw new Error(await describeFailedResponse(response));
        }

        const data = await response.json();

        setUploadState({
          isUploading: false,
          error: null,
          success: true,
        });

        // Redirect to document view after successful upload
        setTimeout(() => {
          router.push(`/documents/${data.document.id}`);
        }, 1500);
      } catch (error) {
        setUploadState({
          isUploading: false,
          error: error instanceof Error ? error.message : 'Upload failed',
          success: false,
        });
      }
    },
    [router, title, author, uploaderId]
  );

  const handleUpload = useCallback(() => {
    if (selectedFile) {
      uploadFile(selectedFile);
    }
  }, [selectedFile, uploadFile]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
  };

  const titleMissing = !title.trim();
  const extension = selectedFile?.name.split('.').pop()?.toLowerCase() ?? '';

  return (
    <div className="bnd-card">
      <div className="bnd-card-b bnd-stack" style={{ gap: 18 }}>
        {selectedFile ? (
          <div className="bnd-file">
            <span className={`bnd-ficon ${fileIconVariant(extension)}`}>
              {extension.slice(0, 4).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <b>{selectedFile.name}</b>
              <span>{formatFileSize(selectedFile.size)}</span>
              {/* The staging upload reports no progress we surface, so the bar is
                  indeterminate rather than showing a percentage it cannot know. */}
              {uploadState.isUploading && (
                <div style={{ marginTop: 8 }}>
                  <div className="bnd-bar ind">
                    <i />
                  </div>
                  <span style={{ display: 'block', marginTop: 5 }}>Uploading…</span>
                </div>
              )}
            </div>
            {!uploadState.isUploading && (
              <button
                type="button"
                className="bnd-link"
                onClick={() => {
                  setSelectedFile(null);
                  resetUploadState();
                }}
              >
                Choose different file
              </button>
            )}
          </div>
        ) : (
          /* File drop zone. Deliberately not a button: the labelled file input inside
             it is the keyboard-accessible control, and wrapping that in a button would
             both nest interactive elements and absorb their text into its own name. */
          /* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a
             pointer-only enhancement here; the labelled file input below provides the
             equivalent keyboard path, so this element needs no interactive role. */
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`bnd-drop ${dragOver ? 'drag' : ''}`}
          >
            <span className="ic">{BI.upload(20)}</span>
            <label htmlFor={fileUploadId} style={{ cursor: 'pointer' }}>
              <b>
                <span className="bnd-link">Click to upload</span>
                <span> or drag and drop</span>
              </b>
              <input
                id={fileUploadId}
                name="file-upload"
                type="file"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            <span className="bnd-hint">
              PDF, Word documents, images, and other common file types.
            </span>
          </div>
        )}

        {selectedFile && (
          <>
            <div className="bnd-field">
              <label htmlFor={titleInputId} className="bnd-lbl">
                Document title<span className="req">*</span>
              </label>
              <input
                type="text"
                id={titleInputId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a title for your document"
                className={`bnd-input ${titleMissing ? 'err' : ''}`}
                aria-invalid={titleMissing}
                aria-describedby={titleMissing ? titleHintId : undefined}
                disabled={uploadState.isUploading}
                required
              />
              {titleMissing && (
                <span id={titleHintId} className="bnd-hint bad">
                  Give the document a title.
                </span>
              )}
            </div>
            <div className="bnd-field">
              <label htmlFor={authorInputId} className="bnd-lbl">
                Author{' '}
                <span className="bnd-muted" style={{ fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                type="text"
                id={authorInputId}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Enter author name"
                className="bnd-input"
                disabled={uploadState.isUploading}
              />
            </div>
          </>
        )}

        {uploadState.success && (
          <div className="bnd-alert info" role="status">
            {BI.check(18)}
            <div>
              <b>Upload successful!</b>
              <p>Your document has been uploaded. Redirecting to document view...</p>
            </div>
          </div>
        )}

        {uploadState.error && (
          <div className="bnd-alert bad" role="alert">
            {BI.xcircle(18)}
            <div>
              <b>Upload failed</b>
              <p>{uploadState.error}</p>
              <div className="bnd-row-flex" style={{ marginTop: 10 }}>
                <button type="button" className="btn sm ghost" onClick={resetUploadState}>
                  {BI.retry(13)} Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bnd-card-f" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost" onClick={() => router.back()}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleUpload}
          disabled={!selectedFile || titleMissing || uploadState.isUploading || uploadState.success}
        >
          {uploadState.isUploading ? (
            <>
              <span className="bnd-spin" /> Uploading…
            </>
          ) : (
            <>{BI.upload(15)} Upload document</>
          )}
        </button>
      </div>
    </div>
  );
}
