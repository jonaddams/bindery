import { type HandleUploadBody, handleUpload } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nutrientConfig } from '@/lib/nutrient-config';
import { isOwnStagedUpload } from '@/lib/staged-upload';

const NOT_YOUR_FOLDER = 'Uploads may only be staged in your own folder';

/**
 * POST /api/documents/upload-token
 * Issue the short-lived token a browser needs to stage a file in Blob storage.
 * See `lib/staged-upload.ts` for why uploads are staged.
 *
 * No `onUploadCompleted`: the browser calls `POST /api/documents` itself once
 * staging finishes, and Blob's completion callback could not reach localhost.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const body: HandleUploadBody = await request.json();
    const { limits } = nutrientConfig();

    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isOwnStagedUpload({ pathname, uploaderId: session.user.id })) {
          throw new Error(NOT_YOUR_FOLDER);
        }

        return {
          maximumSizeInBytes: limits.maxUploadBytes,
          allowedContentTypes: [...limits.allowedMimeTypes],
          addRandomSuffix: true,
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (error instanceof Error && error.message === NOT_YOUR_FOLDER) {
      return NextResponse.json({ error: NOT_YOUR_FOLDER }, { status: 403 });
    }

    console.error('Could not issue upload token', error);
    return NextResponse.json({ error: 'Could not prepare the upload' }, { status: 500 });
  }
}
