import assert from 'node:assert';
import { ExecutionQueue } from '../typescript/executionQueue.js';

describe('ExecutionQueue', () => {
    it('discards queued work after an interrupt and runs later work', async () => {
        const completed: string[] = [];
        const discarded: string[] = [];
        let releaseActive: () => void;
        const active = new Promise<void>((resolve) => {
            releaseActive = resolve;
        });
        const queue = new ExecutionQueue(
            async (item: string) => {
                completed.push(item);
                if (item === 'active') {
                    await active;
                }
                return;
            },
            (item) => discarded.push(item),
        );

        queue.enqueue('active', 'queued');

        queue.discardPending();
        queue.enqueue('later');
        releaseActive?.();

        await queue.whenIdle();

        assert.deepStrictEqual(completed, ['active', 'later']);
        assert.deepStrictEqual(discarded, ['queued']);
    });

    it('discards remaining work after an item fails', async () => {
        const completed: string[] = [];
        const discarded: string[] = [];
        const queue = new ExecutionQueue(
            async (item: string) => {
                completed.push(item);
                if (item === 'failed') throw new Error('failed');
            },
            (item) => discarded.push(item),
        );

        queue.enqueue('failed', 'queued');
        await queue.whenIdle();

        assert.deepStrictEqual(completed, ['failed']);
        assert.deepStrictEqual(discarded, ['queued']);
    });
});
