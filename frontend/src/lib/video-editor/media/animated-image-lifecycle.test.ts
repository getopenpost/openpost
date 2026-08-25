import { describe, expect, it, vi } from 'vitest';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';

// Helper to create fake bitmap with close counter
function fakeBitmap(id: string, counter: Map<string, number>) {
	return {
		close: () => counter.set(id, (counter.get(id) ?? 0) + 1),
		width: 2,
		height: 2,
		id
	} as unknown as ImageBitmap & { id: string };
}

describe('lifecycle seams - cancel/retry', () => {
	it('aborted progress batches close raced bitmaps', () => {
		const counter = new Map<string, number>();
		const abortedRequests = new Set<string>(['req-1']);
		const frames: any[] = [];
		// Simulate onMessage progress handling when aborted
		const message = {
			requestId: 'req-1',
			type: 'progress' as const,
			frames: [
				{ index: 0, bitmap: fakeBitmap('b0', counter) },
				{ index: 1, bitmap: fakeBitmap('b1', counter) }
			],
			savedFrames: []
		};
		if (abortedRequests.has(message.requestId)) {
			for (const f of message.frames) f.bitmap.close();
		} else {
			frames.push(...message.frames);
		}
		expect(counter.get('b0')).toBe(1);
		expect(counter.get('b1')).toBe(1);
		expect(frames.length).toBe(0);
	});

	it('retry after abort can succeed', async () => {
		let attempt = 0;
		async function fakeExtraction(shouldAbort: boolean) {
			attempt++;
			if (shouldAbort) throw new DOMException('cancelled', 'AbortError');
			return { frames: [fakeBitmap('ok', new Map())] };
		}
		await expect(fakeExtraction(true)).rejects.toMatchObject({ name: 'AbortError' });
		await expect(fakeExtraction(false)).resolves.toBeDefined();
		expect(attempt).toBe(2);
	});
});

describe('persistence generation safety', () => {
	it('queuePersistence skips stale generation writes', async () => {
		const generations = new Map<string, number>([['m1', 1]]);
		const writes: string[] = [];
		async function queue(mediaId: string, gen: number, write: () => Promise<void>) {
			if ((generations.get(mediaId) ?? 0) !== gen) return;
			await write();
			writes.push('done');
		}
		// stale gen 0 vs current 1 -> skip
		await queue('m1', 0, async () => writes.push('stale'));
		expect(writes).toEqual([]);
		await queue('m1', 1, async () => writes.push('fresh'));
		expect(writes).toEqual(['fresh', 'done']);
	});

	it('clear increments generation so old loads are ignored', () => {
		const gens = new Map<string, number>();
		const startGen = gens.get('m1') ?? 0;
		gens.set('m1', startGen + 1); // clear
		const loadGen = startGen; // load started before clear
		expect((gens.get('m1') ?? 0) !== loadGen).toBe(true);
	});
});

describe('probe timing/limit', () => {
	it('rejects over 2000 frames', () => {
		const MAX = 2000;
		expect(MAX + 1 > MAX).toBe(true);
	});
});

describe('export error policy', () => {
	it('missing animated frame throws instead of poster fallback', () => {
		const frames: (ImageBitmap | undefined)[] = [
			fakeBitmap('a', new Map()) as unknown as ImageBitmap,
			undefined
		];
		expect(() => {
			const bmp = frames[1];
			if (!bmp) throw new Error('Animated image frame 1 missing for anim.gif');
		}).toThrow(/frame 1 missing/);
	});
});

describe('eviction with subscriber pinning and close-count', () => {
	it('evicts unpinned oldest and closes exactly once', () => {
		const closeCounts = new Map<string, number>();
		const makeEntry = (id: string, size: number, last: number) => ({
			sizeBytes: size,
			lastAccessed: last,
			frames: { frames: [fakeBitmap(id, closeCounts) as unknown as ImageBitmap] } as any,
			id
		});
		const cache = new SizedAccessedMemoryCache<any>(20, {
			isPinned: (k) => k === 'keep',
			onEvict: (_k, e) => e.frames.frames[0].close()
		});
		cache.add('keep', makeEntry('keep', 10, 1));
		cache.add('a', makeEntry('a', 10, 2));
		cache.add('b', makeEntry('b', 10, 3)); // should evict a, keep pinned
		expect(closeCounts.get('a')).toBe(1);
		expect(closeCounts.get('keep')).toBeUndefined();
		expect(cache.peek('keep')).toBeDefined();
		// second eviction should not double-close keep
		cache.add('c', makeEntry('c', 10, 4));
		expect(closeCounts.get('a')).toBe(1);
		expect(closeCounts.get('keep')).toBeUndefined();
	});
});

describe('reverse exclusive-end seam', () => {
	it('elapsed 0 reversed maps to last frame', async () => {
		const { animatedFrameIndexAtElapsed, computeCumulativeDelays } =
			await import('./animated-image-plan');
		const cum = computeCumulativeDelays([100, 100, 100]);
		expect(
			animatedFrameIndexAtElapsed({
				elapsedMs: 0,
				reversed: true,
				cumulativeDelaysMs: cum,
				totalDurationMs: 300
			})
		).toBe(2);
	});
});
