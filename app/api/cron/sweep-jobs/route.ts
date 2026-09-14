import { type NextRequest, NextResponse } from 'next/server';
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
  const configured = process.env.CRON_SECRET;

  if (!configured) {
    // Refusing is the safe failure. Running openly when no secret is configured
    // would leave billed work exposed on exactly the deployment least likely to
    // notice — the one that forgot to set it.
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so the sweep cannot be authenticated.' },
      { status: 503 }
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${configured}`) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
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
