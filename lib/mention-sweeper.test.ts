// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findManyDocuments = vi.fn();
const updateDocument = vi.fn();
const notifyPendingMentions = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      findMany: (...a: unknown[]) => findManyDocuments(...a),
      update: (...a: unknown[]) => updateDocument(...a),
    },
  },
}));

vi.mock('@/lib/notify-mentions', () => ({
  notifyPendingMentions: (...a: unknown[]) => notifyPendingMentions(...a),
}));

const { MENTION_SWEEP_BATCH_SIZE, sweepMentions } = await import('@/lib/mention-sweeper');

beforeEach(() => {
  vi.clearAllMocks();
  findManyDocuments.mockResolvedValue([{ id: 'doc_1' }, { id: 'doc_2' }]);
  updateDocument.mockResolvedValue({});
  notifyPendingMentions.mockResolvedValue({ sent: 0, failed: 0, failures: [] });
});

describe('choosing what to sweep', () => {
  // Nothing tells us which documents changed — DWS has no comment webhooks — so
  // the sweep cannot visit only "documents with recent activity". It rotates.
  it('takes the least recently swept documents, never-swept first', async () => {
    await sweepMentions();

    const query = findManyDocuments.mock.calls[0][0];
    expect(query.orderBy).toEqual({ lastSweptAt: { sort: 'asc', nulls: 'first' } });
  });

  it('bounds how much one run takes on', async () => {
    await sweepMentions();

    expect(findManyDocuments.mock.calls[0][0].take).toBe(MENTION_SWEEP_BATCH_SIZE);
    expect(MENTION_SWEEP_BATCH_SIZE).toBeGreaterThan(0);
  });

  it('reconciles every document it picked', async () => {
    await sweepMentions();

    expect(notifyPendingMentions).toHaveBeenCalledWith({ documentId: 'doc_1' });
    expect(notifyPendingMentions).toHaveBeenCalledWith({ documentId: 'doc_2' });
  });

  it('reports what it did', async () => {
    notifyPendingMentions.mockResolvedValue({ sent: 2, failed: 1, failures: [] });

    const result = await sweepMentions();

    expect(result).toEqual({ swept: 2, sent: 4, failed: 2 });
  });

  it('does nothing gracefully when there are no documents', async () => {
    findManyDocuments.mockResolvedValue([]);

    expect(await sweepMentions()).toEqual({ swept: 0, sent: 0, failed: 0 });
    expect(notifyPendingMentions).not.toHaveBeenCalled();
  });
});

describe('advancing the rotation', () => {
  it('stamps each document it visited', async () => {
    await sweepMentions();

    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc_1' },
        data: expect.objectContaining({ lastSweptAt: expect.any(Date) }),
      })
    );
  });

  // Otherwise one document that always fails sits at the head of the rotation
  // for ever and nothing behind it is ever swept. Nothing is lost by moving on:
  // a mention stays pending until its notification is actually accepted, so the
  // next rotation picks it up again.
  it('stamps a document even when reconciling it failed', async () => {
    notifyPendingMentions.mockRejectedValue(new Error('DWS unreachable'));

    await sweepMentions();

    expect(updateDocument).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one document fails, so one bad document cannot block the rest', async () => {
    notifyPendingMentions.mockRejectedValueOnce(new Error('DWS unreachable'));

    const result = await sweepMentions();

    expect(notifyPendingMentions).toHaveBeenCalledTimes(2);
    expect(result.swept).toBe(2);
  });

  it('counts a document that threw as a failure rather than a success', async () => {
    notifyPendingMentions.mockRejectedValueOnce(new Error('DWS unreachable'));
    notifyPendingMentions.mockResolvedValue({ sent: 1, failed: 0, failures: [] });

    const result = await sweepMentions();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  // A document deleted between the query and the stamp must not abort the run.
  it('survives the stamp failing', async () => {
    updateDocument.mockRejectedValue(new Error('record not found'));

    await expect(sweepMentions()).resolves.toMatchObject({ swept: 2 });
  });
});
