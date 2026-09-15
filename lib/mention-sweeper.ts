/**
 * Finding mentions nobody has opened a document to discover.
 *
 * ## Why this has to exist
 *
 * DWS has no webhooks for comments. A `CommentMention` row is created by
 * `reconcileDocument`, which runs from `POST /api/documents/[id]/sync-comments`,
 * which the viewer calls when somebody opens a document. So until now a mention
 * was discovered only if a person — possibly not the mentioned one — happened to
 * open that document. Nobody opens it, nobody is ever told.
 *
 * That is survivable for email and SMS, where the sender usually opens the
 * document they just commented on, and fatal for an in-app notifications feed:
 * a panel that silently misses notifications is worse than no panel, because it
 * invites trust it cannot honour.
 *
 * ## It rotates rather than selecting
 *
 * There is no way to ask which documents changed. `Document.updatedAt` tracks
 * *our* writes, and a comment added in DWS touches nothing here — that is the
 * whole problem. So "sweep documents with recent activity", which is how this
 * was originally specified, is not implementable: activity is exactly what we
 * cannot see without asking.
 *
 * What is implementable is a rotation. Each run takes the least recently swept
 * documents, reconciles them, and stamps `lastSweptAt`. Every document is
 * therefore visited eventually, the cost of a run is bounded regardless of how
 * many documents exist, and a newly uploaded one goes first because null sorts
 * first.
 *
 * The cost is latency: a mention is found within one full rotation rather than
 * immediately. With the cron at ten minutes and a batch of ten, that is ten
 * minutes for up to ten documents, twenty for twenty, and so on. The inline
 * path still fires the moment anyone opens the document, so this is the floor
 * on discovery, not the normal case.
 *
 * ## This is also where notification volume belongs
 *
 * `notifyPendingMentions` sends serially, and AT&T's A2P throughput is 0.25
 * messages per second. Inline, on a user-facing request, a document with a dozen
 * mentions would block that request on carrier rate limiting. Here nobody is
 * waiting.
 */

import { notifyPendingMentions } from '@/lib/notify-mentions';
import { prisma } from '@/lib/prisma';

/**
 * Documents per run.
 *
 * Each one costs at least one DWS call even when nothing has changed, so this
 * bounds the bill as much as the runtime.
 */
export const MENTION_SWEEP_BATCH_SIZE = 10;

export type MentionSweepResult = {
  /** Documents visited, whether or not reconciling them succeeded. */
  swept: number;
  sent: number;
  failed: number;
};

/**
 * Reconcile the next batch of documents and notify anything found pending.
 *
 * Safe to run concurrently with the inline path and with itself:
 * `notifyPendingMentions` is idempotent, and a mention is marked notified only
 * once its delivery has been accepted.
 */
export const sweepMentions = async (): Promise<MentionSweepResult> => {
  const documents = await prisma.document.findMany({
    orderBy: { lastSweptAt: { sort: 'asc', nulls: 'first' } },
    take: MENTION_SWEEP_BATCH_SIZE,
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;

  for (const document of documents) {
    try {
      const result = await notifyPendingMentions({ documentId: document.id });

      sent += result.sent;
      failed += result.failed;
    } catch {
      // One unreachable document must not abandon the rest of the batch. The
      // mention stays pending, so the next rotation tries again.
      failed += 1;
    }

    // Stamped even when the reconcile threw, and that is deliberate: leaving it
    // unstamped would park a permanently broken document at the head of the
    // rotation for ever, and nothing behind it would be swept again. Nothing is
    // lost by moving on, because the mention itself is still pending.
    await prisma.document
      .update({ where: { id: document.id }, data: { lastSweptAt: new Date() } })
      .catch(() => {
        // The document was deleted between the query and the stamp. Nothing to
        // advance, and nothing worth failing the run over.
      });
  }

  return { swept: documents.length, sent, failed };
};
