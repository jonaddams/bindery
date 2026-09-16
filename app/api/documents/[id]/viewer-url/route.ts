import { type NextRequest, NextResponse } from 'next/server';
import { getEffectiveDocumentFilter, requireAuth, type SessionUser } from '@/lib/auth';
import { documentProvider } from '@/lib/document-provider';
import { nutrientConfig } from '@/lib/nutrient-config';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/documents/[id]/viewer-url
 * Generate a Nutrient API viewer URL with session token
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const filter = getEffectiveDocumentFilter(session.user as SessionUser);

    // Check if document exists and user has access
    const document = await prisma.document.findFirst({
      where: {
        id,
        ...filter,
      },
      select: {
        id: true,
        documentEngineId: true,
        sessionToken: true,
        title: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!document.documentEngineId) {
      return NextResponse.json(
        { error: 'Document upload incomplete - missing documentEngineId' },
        { status: 500 }
      );
    }

    // Always create a fresh session token (they expire after 24 hours)
    // This ensures we never use an expired token
    const sessionData = await documentProvider().createViewerSession({
      documentId: document.documentEngineId,
      userId: session.user.id,
    });
    const sessionToken = sessionData.sessionToken;

    // Update database with the new session token for reference
    await prisma.document.update({
      where: { id },
      data: { sessionToken },
    });

    const config = nutrientConfig();

    return NextResponse.json({
      sessionToken,
      documentId: document.documentEngineId,
      // The two backends need different `NutrientViewer.load()` calls — DWS
      // takes a `session`, Document Engine takes `documentId` + `authPayload` +
      // `serverUrl` — and the browser has no way to tell which it is talking to.
      // The provider seam stops at the server, so this is where the choice
      // crosses over to the client.
      target: config.target,
      // Only Document Engine needs this, and it must be the URL the *browser*
      // can reach the engine on. That is usually, but not necessarily, the one
      // this process uses: an engine addressed as a container hostname from the
      // server is not resolvable from a laptop. If the two ever have to differ,
      // this is the line that needs a separate public URL rather than the seam.
      serverUrl: config.target === 'document-engine' ? config.baseUrl : null,
      // The viewer has no other way to learn this. The session JWT carries
      // `user_id`, so DWS records who authored a comment, but the name shown
      // beside it is a separate string the SDK defaults to null — which it
      // renders as "Anonymous".
      currentUserName: session.user.name ?? session.user.email,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (error instanceof Error && error.message.includes('Nutrient API')) {
      return NextResponse.json(
        { error: 'Failed to generate viewer access. Please check Nutrient API configuration.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: 'Failed to generate viewer URL' }, { status: 500 });
  }
}
