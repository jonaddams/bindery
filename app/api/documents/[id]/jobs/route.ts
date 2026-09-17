import { type NextRequest, NextResponse } from 'next/server';
import {
  getDocumentWriteFilter,
  getEffectiveDocumentFilter,
  requireAuth,
  type SessionUser,
} from '@/lib/auth';
import { createDocumentJob } from '@/lib/document-jobs';
import { jobRunner } from '@/lib/job-runner';
import { nutrientConfig } from '@/lib/nutrient-config';
import { operationsFor } from '@/lib/operations';
import { prisma } from '@/lib/prisma';

/**
 * Jobs against one document.
 *
 * `POST` queues work; `GET` reports on it. They deliberately require **different
 * access**, which is the one thing worth reading carefully here.
 *
 * Starting a job takes the *write* filter — ownership, or an admin acting
 * outside SELF mode. A redaction does not modify its source, so the read filter
 * looks defensible and is not: the job spends the account's processing credits
 * and creates a new document owned by the source's owner. Someone who can read a
 * document only because they were mentioned in a comment on it must not be able
 * to do either.
 *
 * Reading job status takes the *read* filter, because "what has been done to this
 * document" is part of understanding the document, and anyone who may open it
 * may ask.
 *
 * (`lib/auth.ts` has two filters for exactly this reason, and reusing the read
 * one where a write is meant is a known trap — see TODO.md section 18.)
 */

const unauthorized = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Authentication required';

/**
 * POST /api/documents/[id]/jobs
 * Queue an operation against this document. Answers 202: taken on, not done.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const body = await request.json().catch(() => undefined);

    if (body === undefined) {
      return NextResponse.json({ error: 'A JSON body is required.' }, { status: 400 });
    }

    const operation = operationsFor(nutrientConfig().target).find(
      (candidate) => candidate.kind === body?.kind
    );

    if (!operation) {
      return NextResponse.json(
        { error: `"${String(body?.kind)}" is not an operation this deployment performs.` },
        { status: 400 }
      );
    }

    const parsed = operation.parse(body);

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    // Write access: see the note above. Absence is reported as 404 rather than
    // 403 so that a document's existence is not disclosed to someone who cannot
    // act on it, matching the other document routes.
    const document = await prisma.document.findFirst({
      where: { id, ...getDocumentWriteFilter(session.user as SessionUser) },
      select: { id: true },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const job = await createDocumentJob({
      documentId: document.id,
      requestedById: session.user.id,
      kind: operation.kind,
      parameters: body,
    });

    // A failure to enqueue is not a failure to accept. The job is recorded, and
    // the sweeper picks up anything that was never started — so reporting 500
    // here would tell the caller nothing happened when something will.
    try {
      jobRunner().enqueue({ jobId: job.id });
    } catch {
      // Left for the sweeper.
    }

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (unauthorized(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to queue the job' }, { status: 500 });
  }
}

/**
 * GET /api/documents/[id]/jobs
 * What has been asked of this document, and how it went.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const document = await prisma.document.findFirst({
      where: { id, ...getEffectiveDocumentFilter(session.user as SessionUser) },
      select: { id: true },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const jobs = await prisma.documentJob.findMany({
      where: { documentId: document.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        status: true,
        parameters: true,
        outputDocumentId: true,
        error: true,
        attempts: true,
        createdAt: true,
        finishedAt: true,
      },
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    if (unauthorized(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}
