import { type NextRequest, NextResponse } from 'next/server';
import { cronAuthFailure } from '@/lib/cron-auth';
import { sweepMentions } from '@/lib/mention-sweeper';

/**
 * GET /api/cron/sweep-mentions
 *
 * Finds mentions that nobody has opened a document to discover.
 *
 * DWS has no comment webhooks, so without this a mention is only found when
 * somebody opens the document it was written on — which may be nobody, and is
 * rarely the mentioned person. `lib/mention-sweeper.ts` explains why the sweep
 * rotates through documents rather than selecting recently-changed ones.
 *
 * Separate from `sweep-jobs` on purpose, though both are scheduled and both take
 * the same secret. They fail independently — a DWS outage stops mentions being
 * found while document jobs carry on — and they want different cadences, since
 * a job wants prompt pickup while this is a backstop for something that usually
 * happens the moment anyone opens the document.
 */
export async function GET(request: NextRequest) {
  const refusal = cronAuthFailure(request);

  if (refusal) {
    return refusal;
  }

  try {
    return NextResponse.json(await sweepMentions());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The sweep failed.' },
      { status: 500 }
    );
  }
}
