/**
 * Who is allowed to trigger a scheduled sweep.
 *
 * The caller is a machine, so this is a shared secret rather than a session.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Both sweeps perform real, billed work — one runs document processing, the
 * other reads every document's comments from DWS and can send email and SMS — so
 * this is the only thing standing in front of spend. It lives in one place
 * because two endpoints enforcing the same rule separately is how they come to
 * disagree.
 */

import { NextResponse } from 'next/server';

/**
 * `null` when the request may proceed; the response to return when it may not.
 *
 * A missing secret refuses everything rather than running openly. That is the
 * safe failure: a deployment that forgot to configure one is exactly the
 * deployment least likely to notice billed work left exposed.
 */
export const cronAuthFailure = (request: Request): NextResponse | null => {
  const configured = process.env.CRON_SECRET;

  if (!configured) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so the sweep cannot be authenticated.' },
      { status: 503 }
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${configured}`) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  return null;
};
