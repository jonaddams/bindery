import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listMentions, markMentionsRead } from '@/lib/mention-feed';

/**
 * The in-app mention feed.
 *
 * `GET` lists this person's mentions with an unread count; `POST` marks them
 * read. Both take their identity from the session and **never** from the
 * request — a user id in the body is ignored, because honouring one would make
 * this a way to read somebody else's mentions or to mark them read behind their
 * back, which hides a notification from the person it was for.
 *
 * There is no document filter here, deliberately. Being mentioned already grants
 * a `DocumentShare` — the notifier creates it before sending, so a notification
 * can never point at a document the reader is refused — so a mention the caller
 * owns is by construction one they may see.
 */

const unauthorized = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Authentication required';

/** GET /api/mentions */
export async function GET(_request: NextRequest) {
  try {
    const session = await requireAuth();

    return NextResponse.json(await listMentions({ userId: session.user.id }));
  } catch (error) {
    if (unauthorized(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to fetch mentions' }, { status: 500 });
  }
}

/**
 * POST /api/mentions
 *
 * Body `{ mentionIds }` marks those read; an absent `mentionIds` marks all of
 * them. An empty array marks nothing, which `markMentionsRead` enforces — the
 * dangerous reading of `[]` is "all of them", and it would silently clear the
 * feed.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await request.json().catch(() => ({}));
    const mentionIds: unknown = body?.mentionIds;

    if (mentionIds !== undefined) {
      if (!Array.isArray(mentionIds) || mentionIds.some((id) => typeof id !== 'string')) {
        return NextResponse.json(
          { error: 'mentionIds must be an array of mention IDs.' },
          { status: 400 }
        );
      }
    }

    const result = await markMentionsRead({
      userId: session.user.id,
      mentionIds: mentionIds as string[] | undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (unauthorized(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to mark mentions read' }, { status: 500 });
  }
}
