import { describe, expect, it, vi, beforeEach } from 'vitest';

async function loadWithMock(meta: unknown, frameBlobs: (Blob | null)[]) {
	const opfs = await import('./opfs-cache');
	vi.spyOn(opfs, 'readOpfsBlob').mockImplementation(
		async (_store: string, _mediaId: string, name: string) => {
			if (name === 'meta.json') {
				if (meta === null) return null;
				return new Blob([JSON.stringify(meta)], { type: 'application/json' });
			}
			const idx = Number(name.split('.')[0]);
			return frameBlobs[idx] ?? null;
		}
	);
	// mock createImageBitmap to return a fake bitmap
	vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
		if (!blob) throw new Error('no blob');
		return { close: () => {}, width: 2, height: 2 } as unknown as ImageBitmap;
	});
	const mod = await import('./animated-image-persistence');
	return mod.loadAnimatedImage('test-id');
}

describe('animated image persistence durations', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('accepts finite positive fractions', async () => {
		const result = await loadWithMock(
			{ version: 1, durationsMs: [33.333, 16.666, 100], width: 10, height: 10, frameCount: 3 },
			[new Blob(['a']), new Blob(['b']), new Blob(['c'])]
		);
		expect(result).not.toBeNull();
		expect(result?.durationsMs).toEqual([33.333, 16.666, 100]);
	});

	it('rejects zero durations (must be strictly > 0)', async () => {
		const result = await loadWithMock(
			{ version: 1, durationsMs: [100, 0, 100], width: 10, height: 10, frameCount: 3 },
			[new Blob(['a']), new Blob(['b']), new Blob(['c'])]
		);
		expect(result).toBeNull();
	});

	it('rejects negative durations', async () => {
		const result = await loadWithMock(
			{ version: 1, durationsMs: [100, -1], width: 10, height: 10, frameCount: 2 },
			[new Blob(['a']), new Blob(['b'])]
		);
		expect(result).toBeNull();
	});

	it('rejects non-finite durations', async () => {
		const result = await loadWithMock(
			{ version: 1, durationsMs: [100, Infinity], width: 10, height: 10, frameCount: 2 },
			[new Blob(['a']), new Blob(['b'])]
		);
		expect(result).toBeNull();
	});

	it('rejects integer zero via same rule', async () => {
		const result = await loadWithMock(
			{ version: 1, durationsMs: [0], width: 1, height: 1, frameCount: 1 },
			[new Blob(['a'])]
		);
		expect(result).toBeNull();
	});
});
