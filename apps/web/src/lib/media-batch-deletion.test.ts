import { describe, expect, it } from 'vitest';
import {
	MediaBatchDeletionRejected,
	remainingMediaDeletionIDs,
	requestRecoverableMediaBatchDeletion
} from './media-batch-deletion';

describe('remainingMediaDeletionIDs', () => {
	it('retries only failed IDs after a partial deletion', () => {
		const firstRetry = remainingMediaDeletionIDs(['media-1', 'media-2'], {
			deleted: 1,
			failed_ids: ['media-2']
		});
		expect(firstRetry).toEqual(['media-2']);

		const completed = remainingMediaDeletionIDs(firstRetry, {
			deleted: 1,
			failed_ids: []
		});
		expect(completed).toEqual([]);
	});

	it('preserves the original target when a malformed response omits failed IDs', () => {
		expect(
			remainingMediaDeletionIDs(['media-1', 'media-2'], { deleted: 0, failed_ids: [] })
		).toEqual(['media-1', 'media-2']);
	});

	it('normalizes a nullable failed-ID list from the generated contract', () => {
		expect(remainingMediaDeletionIDs(['media-1'], { deleted: 1, failed_ids: null })).toEqual([]);
	});

	it('replays the same request when the first response is lost', async () => {
		const requested: string[][] = [];
		const result = await requestRecoverableMediaBatchDeletion(['media-1'], async (ids) => {
			requested.push([...ids]);
			if (requested.length === 1) throw new Error('response lost');
			return { deleted: 1, failed_ids: [] };
		});

		// Transport replay proof only: endpoint idempotency belongs to the
		// server and browser suites.
		expect(requested).toEqual([['media-1'], ['media-1']]);
		expect(result).toEqual({ deleted: 1, failed_ids: [] });
	});

	it('does not replay a request rejected by the server', async () => {
		let calls = 0;
		await expect(
			requestRecoverableMediaBatchDeletion(['media-1'], async () => {
				calls += 1;
				throw new MediaBatchDeletionRejected('media is in use');
			})
		).rejects.toThrow('media is in use');
		expect(calls).toBe(1);
	});
});
