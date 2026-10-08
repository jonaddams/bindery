'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BI } from '@/components/bindery/icons';
import type { NutrientTarget } from '@/lib/nutrient-config';
import { pdfFilename, saveFile, withNamedDownload } from '@/lib/viewer-download';
import { viewerLoadOptions } from '@/lib/viewer-load-options';

type DocumentViewerProps = {
  documentId: string;
  /** The stored filename; the toolbar's download saves under it, as a PDF. */
  filename: string;
};

type ViewerError = {
  message: string;
  code?: string;
};

export function DocumentViewer({ documentId, filename }: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerInstanceRef = useRef<NutrientViewerInstance | null>(null);
  const isInitializingRef = useRef(false);
  const [error, setError] = useState<ViewerError | null>(null);
  const [viewerData, setViewerData] = useState<{
    sessionToken: string;
    // Which backend is storing this document, and where the browser reaches it.
    // The two need different `load()` calls, and the browser cannot tell them
    // apart on its own — see `lib/viewer-load-options.ts`.
    target: NutrientTarget;
    serverUrl: string | null;
    backendDocumentId: string;
    mentionableUsers: NutrientMentionableUser[];
    currentUserName: string | null;
  } | null>(null);

  /**
   * Tell the server this document's comments changed.
   *
   * Deliberately says nothing about *what* changed. DWS has no webhooks, so the
   * server needs a nudge to re-read — but it derives the mentions itself, so a
   * browser cannot cause an email to someone it names. Failures are swallowed:
   * the next reconcile picks up anything missed.
   */
  const requestCommentSync = useCallback(async () => {
    try {
      await fetch(`/api/documents/${documentId}/sync-comments`, { method: 'POST' });
    } catch {
      // Best effort by design.
    }
  }, [documentId]);

  // Fetch the viewer data from our API
  const fetchViewerData = useCallback(async () => {
    try {
      setError(null);

      const response = await fetch(`/api/documents/${documentId}/viewer-url`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get viewer data');
      }

      const data = await response.json();

      // The mention menu needs the directory. A failure here degrades the mention
      // menu rather than blocking the document from opening.
      let mentionableUsers: NutrientMentionableUser[] = [];
      try {
        const directoryResponse = await fetch('/api/mentionable-users');
        if (directoryResponse.ok) {
          mentionableUsers = (await directoryResponse.json()).mentionableUsers ?? [];
        }
      } catch {
        // Leave the list empty; the viewer still loads.
      }

      setViewerData({
        sessionToken: data.sessionToken,
        // Defaulting to DWS keeps an older server — one deployed before the
        // route said which backend it uses — working exactly as before.
        target: data.target === 'document-engine' ? 'document-engine' : 'dws',
        serverUrl: data.serverUrl ?? null,
        backendDocumentId: data.documentId,
        mentionableUsers,
        currentUserName: data.currentUserName ?? null,
      });
    } catch (error) {
      setError({
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'FETCH_ERROR',
      });
    }
  }, [documentId]);

  // Initialize the Nutrient Viewer using NutrientViewer.load()
  const initializeViewer = useCallback(async () => {
    if (!viewerData || !containerRef.current || isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;

    try {
      setError(null);

      // Unload any existing NutrientViewer instance first
      if (viewerInstanceRef.current && window?.NutrientViewer?.unload) {
        try {
          await window.NutrientViewer.unload(containerRef.current);
          viewerInstanceRef.current = null;
        } catch (_error) {
          // Ignore unload errors if no instance exists
        }
      }

      // Clear the container completely - this is critical
      if (containerRef.current) {
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild);
        }
      }

      // Check if NutrientViewer is available
      if (typeof window === 'undefined' || !window.NutrientViewer) {
        throw new Error('NutrientViewer library not loaded');
      }

      if (!viewerData.sessionToken || viewerData.sessionToken.trim() === '') {
        throw new Error('Empty session token received from API');
      }

      // The built-in download button saves as "document.pdf" and cannot be
      // renamed, so it is swapped for one that saves under this document's name.
      // It reads the instance when pressed, which is long after load resolves.
      const downloadNamed = async () => {
        const viewer = viewerInstanceRef.current;
        if (!viewer) return;
        try {
          // exportPDF omits unsaved annotations.
          await viewer.save().catch(() => undefined);
          saveFile({ bytes: await viewer.exportPDF(), filename: pdfFilename(filename) });
        } catch (exportError) {
          console.error('Could not export the document for download', exportError);
        }
      };
      const defaults = window.NutrientViewer.defaultToolbarItems;

      const instance = await window.NutrientViewer.load({
        ...viewerLoadOptions({
          container: containerRef.current,
          target: viewerData.target,
          serverUrl: viewerData.serverUrl,
          documentId: viewerData.backendDocumentId,
          sessionToken: viewerData.sessionToken,
          mentionableUsers: viewerData.mentionableUsers,
        }),
        ...(Array.isArray(defaults)
          ? {
              toolbarItems: withNamedDownload({
                items: defaults,
                onDownload: () => void downloadNamed(),
              }),
            }
          : {}),
      });

      // Without this the reader's own comments are labelled "Anonymous". DWS
      // records the author from the session's `user_id` either way; this is the
      // display name shown beside it, which the SDK cannot know on its own.
      instance.setAnnotationCreatorName(viewerData.currentUserName);

      // DWS has no webhooks, so this is how the server learns a comment appeared.
      // The payload is ignored on purpose — see requestCommentSync.
      instance.addEventListener('comments.mention', requestCommentSync);

      viewerInstanceRef.current = instance;
    } catch (error) {
      setError({
        message: error instanceof Error ? error.message : 'Failed to load document viewer',
        code: 'VIEWER_ERROR',
      });
      viewerInstanceRef.current = null;
    } finally {
      isInitializingRef.current = false;
    }
  }, [viewerData, requestCommentSync, filename]);

  // Cleanup function
  const cleanup = useCallback(async () => {
    if (viewerInstanceRef.current && containerRef.current && window?.NutrientViewer?.unload) {
      try {
        await window.NutrientViewer.unload(containerRef.current);
        viewerInstanceRef.current = null;
      } catch (_error) {
        // If unload fails, just clear the container
      }
    }

    // Clear the container completely
    if (containerRef.current) {
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }
    }

    isInitializingRef.current = false;
  }, []);

  // Effect to fetch viewer data
  useEffect(() => {
    fetchViewerData();
  }, [fetchViewerData]);

  // Effect to initialize viewer when data is available
  useEffect(() => {
    if (viewerData) {
      // Wait for container to be available
      let retryCount = 0;
      const maxRetries = 100; // 5 seconds max

      const checkAndInit = () => {
        if (containerRef.current) {
          // Also check that the container has computed dimensions
          const containerRect = containerRef.current.getBoundingClientRect();

          if (containerRect.width > 0 && containerRect.height > 0) {
            initializeViewer();
          } else if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkAndInit, 50);
          } else {
            setError({
              message: 'Failed to initialize document viewer: container has no dimensions',
              code: 'CONTAINER_SIZE_ERROR',
            });
          }
        } else if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(checkAndInit, 50);
        } else {
          setError({
            message: 'Failed to initialize document viewer: container not available',
            code: 'CONTAINER_ERROR',
          });
        }
      };
      checkAndInit();
    }
  }, [viewerData, initializeViewer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleRetry = useCallback(async () => {
    setError(null);
    setViewerData(null);
    await cleanup();
    fetchViewerData();
  }, [fetchViewerData, cleanup]);

  if (error) {
    return (
      <div className="bnd-viewer" style={{ justifyContent: 'center' }}>
        <div className="bnd-empty" style={{ border: 0 }}>
          <span className="ic">{BI.alert(22)}</span>
          <h3>Failed to load document</h3>
          <p>{error.message}</p>
          <button type="button" onClick={handleRetry} className="btn">
            Try again
          </button>
        </div>
      </div>
    );
  }

  // `.bnd-viewer` gives the frame a definite height, and the container fills it.
  // The SDK renders nothing into a container without real height — the
  // dimension check above waits for exactly that.
  return (
    <div className="bnd-viewer">
      {/* NutrientViewer container - it handles its own loading state */}
      <div ref={containerRef} style={{ position: 'relative', flex: 1, minHeight: 0 }} />
    </div>
  );
}
