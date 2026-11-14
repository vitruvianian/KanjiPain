import { describe, expect, it, vi } from 'vitest';

import { DraftSaveQueue } from '../../src/services/draft-save-queue';

describe('DraftSaveQueue', () => {
  it('serializes saves for one session and flushes their completion', async () => {
    const queue = new DraftSaveQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.enqueue('session', async () => {
      order.push('first-start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first-end');
      return 1;
    });
    const second = queue.enqueue('session', () => {
      order.push('second');
      return Promise.resolve(2);
    });

    await vi.waitFor(() => {
      expect(order).toEqual(['first-start']);
    });
    releaseFirst?.();
    await queue.flush('session');

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not replay a failed save to later commands that flush the queue', async () => {
    const queue = new DraftSaveQueue();
    const failed = queue.enqueue('session', () => Promise.reject(new Error('save failed')));
    await expect(failed).rejects.toThrow('save failed');
    await expect(queue.flush('session')).resolves.toBeUndefined();

    const next = queue.enqueue('session', () => Promise.resolve('saved'));
    await expect(next).resolves.toBe('saved');
  });
});
