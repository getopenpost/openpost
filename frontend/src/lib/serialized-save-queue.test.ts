import { describe, expect, it } from 'vitest';
import { SerializedSaveQueue } from './serialized-save-queue';

describe('SerializedSaveQueue', () => {
	it('never starts a newer save before the older save settles', async () => {
		const order: string[] = [];
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const queue = new SerializedSaveQueue(() => '');

		const first = queue.run(async () => {
			order.push('first:start');
			await firstBlocked;
			order.push('first:end');
			return 'first';
		});
		const second = queue.run(async () => {
			order.push('second:start');
			return 'second';
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(order).toEqual(['first:start']);
		releaseFirst();
		await expect(first).resolves.toBe('first');
		await expect(second).resolves.toBe('second');
		expect(order).toEqual(['first:start', 'first:end', 'second:start']);
	});

	it('flushes the newest queued save and continues after a failed save', async () => {
		const queue = new SerializedSaveQueue(() => 'fallback');
		void queue.run(async () => {
			throw new Error('stale save failed');
		});
		queue.run(async () => 'latest');

		await expect(queue.flush()).resolves.toBe('latest');
	});
});
