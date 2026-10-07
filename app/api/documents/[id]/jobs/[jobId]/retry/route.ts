import { type NextRequest, NextResponse } from 'next/server';
import { getDocumentWriteFilter, requireAuth, type SessionUser } from '@/lib/auth';
import { createDocumentJob } from '@/lib/document-jobs';
import { jobRunner } from '@/lib/job-runner';
import { nutrientConfig } from '@/lib/nutrient-config';
import { describeJob, operationsForDocument, toolsUnavailableReason } from '@/lib/operations';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/documents/[id]/jobs/[jobId]/retry
 *
 * Queue a failed job again, with the same tool and the settings it stored. A
 * new job rather than a reset of the old one, so history keeps both attempts
 * and the failure's reason stays readable.
 *
 * The same checks as starting a job: write access, because it spends credits;
 * a tool this document is still offered; and settings that still parse — a
 * protect job whose sealed password the server can no longer open is refused
 * with that reason rather than re-run.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  try {
    const { id, jobId } = await params;
    const session = await requireAuth();

    const document = await prisma.document.findFirst({
      where: { id, ...getDocumentWriteFilter(session.user as SessionUser) },
      select: { id: true, fileType: true, producedByJob: { select: { kind: true } } },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const unavailable = toolsUnavailableReason({ producedByJob: document.producedByJob ?? null });

    if (unavailable) {
      return NextResponse.json({ error: unavailable }, { status: 400 });
    }

    const failed = await prisma.documentJob.findFirst({
      where: { id: jobId, documentId: document.id },
      select: { id: true, kind: true, status: true, parameters: true },
    });

    if (!failed) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (failed.status !== 'FAILED') {
      return NextResponse.json({ error: 'Only a failed job can be retried.' }, { status: 409 });
    }

    const operation = operationsForDocument({
      target: nutrientConfig().target,
      fileType: document.fileType,
    }).find((candidate) => candidate.kind === failed.kind);

    if (!operation) {
      return NextResponse.json(
        { error: 'That tool is no longer offered for this document.' },
        { status: 400 }
      );
    }

    const parsed = operation.parse(failed.parameters);

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    const job = await createDocumentJob({
      documentId: document.id,
      requestedById: session.user.id,
      kind: operation.kind,
      parameters: parsed.parameters,
    });

    try {
      jobRunner().enqueue({ jobId: job.id });
    } catch {
      // Recorded is accepted: the sweeper starts anything the runner did not.
    }

    const { parameters: _stored, ...visible } = job;

    return NextResponse.json(
      {
        job: {
          ...visible,
          description: describeJob({ kind: job.kind, parameters: parsed.parameters }),
        },
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Failed to retry the job' }, { status: 500 });
  }
}
