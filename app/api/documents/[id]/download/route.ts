import { type NextRequest, NextResponse } from 'next/server';
import { getEffectiveDocumentFilter, requireAuth, type SessionUser } from '@/lib/auth';
import { documentProvider } from '@/lib/document-provider';
import { isProtectedCopy } from '@/lib/operations';
import { prisma } from '@/lib/prisma';

/** The stored name, with `.pdf` when the backend sent a PDF of something else. */
const downloadName = (filename: string, sentType: string | null): string => {
  if (sentType !== 'application/pdf' || /\.pdf$/i.test(filename)) {
    return filename;
  }
  const extension = filename.lastIndexOf('.');
  return `${extension > 0 ? filename.slice(0, extension) : filename}.pdf`;
};

/**
 * GET /api/documents/[id]/download
 *
 * Streams the stored file to the browser as an attachment. **Streamed, never
 * buffered**: Vercel caps a buffered function response at 4.5 MB, and streamed
 * responses are exempt, so this passes the backend's stream straight through.
 *
 * Read access is enough — anyone who can open a document can save it.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const document = await prisma.document.findFirst({
      where: { id, ...getEffectiveDocumentFilter(session.user as SessionUser) },
      select: {
        documentEngineId: true,
        filename: true,
        fileType: true,
        producedByJob: { select: { kind: true } },
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // DWS will not return a protected copy without its password. The viewer can:
    // it asks for the password, and its own download button saves the file.
    if (isProtectedCopy(document)) {
      return NextResponse.json(
        {
          error:
            'This is a password-protected copy. Open it, enter its password, and use the ' +
            "viewer's download button.",
        },
        { status: 409 }
      );
    }

    const stored = await documentProvider().streamDocument({
      documentId: document.documentEngineId,
    });
    const name = downloadName(document.filename, stored.contentType);

    return new Response(stored.body, {
      headers: {
        'Content-Type': stored.contentType ?? document.fileType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'The document could not be downloaded.' }, { status: 502 });
  }
}
