import type { Prisma } from '@prisma/client';
import { del, get } from '@vercel/blob';
import { type NextRequest, NextResponse } from 'next/server';
import { getEffectiveDocumentFilter, requireAuth, type SessionUser } from '@/lib/auth';
import { documentProvider } from '@/lib/document-provider';
import { nutrientConfig } from '@/lib/nutrient-config';
import { prisma } from '@/lib/prisma';
import { isOwnStagedUpload } from '@/lib/staged-upload';
import { validateUpload } from '@/lib/upload-validation';
import { withRetry } from '@/lib/with-retry';

/**
 * GET /api/documents
 * List all documents for the current user (with role-based filtering)
 * Supports search, filtering, and sorting query parameters
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const baseFilter = getEffectiveDocumentFilter(session.user as SessionUser);

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim();
    const fileType = searchParams.get('fileType')?.trim();
    const author = searchParams.get('author')?.trim();
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Search and filters are collected separately and combined with the access
    // filter under AND. Spreading them into one object would let `OR` here
    // overwrite the `OR` that expresses who may see what, turning a search into
    // a listing of every document in the database.
    const whereClause: Prisma.DocumentWhereInput = {};

    // Add search functionality - search across title, filename, and author
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { filename: { contains: search, mode: 'insensitive' } },
        { author: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Add file type filter
    if (fileType && fileType !== 'all') {
      whereClause.fileType = { contains: fileType, mode: 'insensitive' };
    }

    // Add author filter
    if (author && author !== 'all') {
      whereClause.author = { contains: author, mode: 'insensitive' };
    }

    // Validate and set sort parameters
    const validSortFields = [
      'title',
      'filename',
      'fileType',
      'fileSize',
      'author',
      'createdAt',
      'updatedAt',
    ];
    const validSortOrders = ['asc', 'desc'];

    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const finalSortOrder = validSortOrders.includes(sortOrder) ? sortOrder : 'desc';

    const documents = await prisma.document.findMany({
      where: { AND: [baseFilter, whereClause] },
      select: {
        id: true,
        documentEngineId: true,
        sessionToken: true,
        title: true,
        filename: true,
        fileType: true,
        fileSize: true,
        author: true,
        ownerId: true,
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
      orderBy: {
        [finalSortBy]: finalSortOrder,
      },
    });

    // Convert BigInt fileSize to string for JSON serialization
    const serializedDocuments = documents.map((doc) => ({
      ...doc,
      fileSize: doc.fileSize?.toString(),
    }));

    return NextResponse.json({ documents: serializedDocuments });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

const stringField = (body: unknown, key: string): string => {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return '';
  }
  const value: unknown = Reflect.get(body, key);
  return typeof value === 'string' ? value : '';
};

const discardStagedUpload = async (pathname: string): Promise<void> => {
  // ponytail: a failed delete leaves an orphan in Blob; sweep uploads/ if they pile up.
  await del(pathname).catch((error: unknown) => {
    console.error('Could not remove staged upload', pathname, error);
  });
};

/**
 * POST /api/documents
 * Upload a document the browser has already staged in Blob storage.
 * See `lib/staged-upload.ts` for why uploads are staged.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body: unknown = await request.json().catch(() => null);
    const pathname = stringField(body, 'pathname');
    const filename = stringField(body, 'filename');
    const title = stringField(body, 'title');
    const author = stringField(body, 'author');

    if (!pathname || !filename) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (!isOwnStagedUpload({ pathname, uploaderId: session.user.id })) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 403 });
    }

    const staged = await get(pathname, { access: 'private' });

    if (staged?.statusCode !== 200) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    try {
      const file = new File([await new Response(staged.stream).arrayBuffer()], filename, {
        type: staged.blob.contentType,
      });

      // Refuse what the backend would refuse anyway, before paying to send it.
      const validation = validateUpload({ file, limits: nutrientConfig().limits });

      if (!validation.ok) {
        return NextResponse.json({ error: validation.message }, { status: validation.status });
      }

      // Upload to the configured document backend, retrying a transient failure.
      const nutrientResult = await withRetry(() => documentProvider().uploadDocument({ file }));

      const document = await prisma.document.create({
        data: {
          documentEngineId: nutrientResult.documentId,
          sessionToken: nutrientResult.sessionToken,
          title,
          filename: file.name,
          fileType: file.type,
          fileSize: BigInt(file.size),
          author: author || session.user.name || session.user.email || 'Unknown',
          ownerId: session.user.id,
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

      return NextResponse.json({ document: serializedDocument }, { status: 201 });
    } finally {
      await discardStagedUpload(pathname);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (error instanceof Error && error.message.includes('Nutrient API')) {
      return NextResponse.json(
        { error: 'Document upload failed. Please try again.' },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}
