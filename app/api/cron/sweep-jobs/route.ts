import { type NextRequest, NextResponse } from 'next/server';
import { cronAuthFailure } from '@/lib/cron-auth';
import { sweepJobs } from '@/lib/job-runner';

/**
 * GET /api/cron/sweep-jobs
 *
 * The durability half of the job runner. `after()` runs a job just after the
 * response that queued it, which covers the common case and nothing else: if the
 * function instance goes away mid-job, the work is simply lost. This endpoint is
 * what makes that acceptable — a scheduled pass that picks up jobs which were
 * never started, and jobs left RUNNING by a runner that died.
 *
 * Scheduled from `vercel.json`. Nothing about the sweep depends on Vercel; any
 * scheduler that can make an authenticated GET will do, which is the point of
 * keeping the logic in `lib/job-runner.ts` and the route this thin.
 *
 * **It is protected by a shared secret, not a session**, because the caller is a
 * machine. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The endpoint
 * does real, billed work, so the secret is the only thing in front of it.
 */
export async function GET(request: NextRequest) {
  const refusal = cronAuthFailure(request);

  if (refusal) {
    return refusal;
  }

  try {
    const result = await sweepJobs();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The sweep failed.' },
      { status: 500 }
    );
  }
}
