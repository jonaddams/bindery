import { type NextRequest, NextResponse } from 'next/server';
import {
  getDocumentWriteFilter,
  getEffectiveDocumentFilter,
  requireAuth,
  type SessionUser,
} from '@/lib/auth';
import { documentProvider } from '@/lib/document-provider';
import { parseTitle } from '@/lib/document-title';
import { prisma } from '@/lib/prisma';
import { withRetry } from '@/lib/with-retry';

/**
 * GET /api/documents/[id]
 * Get a specific document's metadata
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const filter = getEffectiveDocumentFilter(session.user as SessionUser);

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
        filename: true,
        fileType: true,
        fileSize: true,
        author: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Convert BigInt to string for JSON serialization
    const serializedDocument = {
      ...document,
      fileSize: document.fileSize?.toString(),
    };

    return NextResponse.json({ document: serializedDocument });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 });
  }
}

/**
 * PUT /api/documents/[id]
 * Update a document's metadata
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const filter = getDocumentWriteFilter(session.user as SessionUser);

    const body: unknown = await request.json().catch(() => undefined);

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const parsed = parseTitle(Reflect.get(body, 'title'));

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    const { title } = parsed;
    const rawAuthor: unknown = Reflect.get(body, 'author');
    const author = typeof rawAuthor === 'string' ? rawAuthor.trim() : '';

    // Check if document exists and user has access
    const existingDocument = await prisma.document.findFirst({
      where: {
        id,
        ...filter,
      },
    });

    if (!existingDocument) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Update document
    const document = await prisma.document.update({
      where: { id },
      data: {
        title,
        author: author || existingDocument.author,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        documentEngineId: true,
        sessionToken: true,
        title: true,
        filename: true,
        fileType: true,
        fileSize: true,
        author: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Convert BigInt to string for JSON serialization
    const serializedDocument = {
      ...document,
      fileSize: document.fileSize?.toString(),
    };

    return NextResponse.json({ document: serializedDocument });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete a document
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const filter = getDocumentWriteFilter(session.user as SessionUser);

    // Check if document exists and user has access
    const document = await prisma.document.findFirst({
      where: {
        id,
        ...filter,
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Delete from Nutrient API (with retry logic, but don't fail if it fails)
    try {
      await withRetry(() =>
        documentProvider().deleteDocument({ documentId: document.documentEngineId })
      );
    } catch (_error) {
      // Continue with database deletion even if Nutrient API deletion fails
    }

    // Delete from database
    await prisma.document.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
