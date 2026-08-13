import { describe, expect, it, vi } from 'vitest';
import { ObjectURLLeasePool, VideoSourceURLSlot, type VideoSourceURLLease } from './source-url';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('video source Blob URL ownership', () => {
	it('coalesces identical in-flight reads and revokes after the final owner', async () => {
		const create = vi.fn(() => 'blob:shared');
		const revoke = vi.fn();
		const read = deferred<Blob>();
		const load = vi.fn(() => read.promise);
		const pool = new ObjectURLLeasePool({ create, revoke });

		const first = pool.acquire('projects/p/proxies/a.webm', load);
		const second = pool.acquire('projects/p/proxies/a.webm', load);
		expect(load).toHaveBeenCalledTimes(1);
		read.resolve(new Blob(['video']));
		const [firstLease, secondLease] = await Promise.all([first, second]);

		expect(create).toHaveBeenCalledTimes(1);
		firstLease.release();
		firstLease.release();
		expect(revoke).not.toHaveBeenCalled();
		secondLease.release();
		expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:shared');
	});

	it('releases a slow stale generation without replacing the current preview', async () => {
		const first = deferred<VideoSourceURLLease>();
		const second = deferred<VideoSourceURLLease>();
		const releaseFirst = vi.fn();
		const releaseSecond = vi.fn();
		const slot = new VideoSourceURLSlot();

		const staleResult = slot.replace(() => first.promise);
		const currentResult = slot.replace(() => second.promise);
		second.resolve({ url: 'blob:current', release: releaseSecond });
		expect(await currentResult).toBe('blob:current');
		first.resolve({ url: 'blob:stale', release: releaseFirst });
		expect(await staleResult).toBeUndefined();
		expect(releaseFirst).toHaveBeenCalledTimes(1);
		expect(releaseSecond).not.toHaveBeenCalled();

		slot.dispose();
		slot.dispose();
		expect(releaseSecond).toHaveBeenCalledTimes(1);
	});

	it('clears a failed pending load so the same path can recover', async () => {
		const create = vi.fn(() => 'blob:recovered');
		const revoke = vi.fn();
		const load = vi
			.fn<() => Promise<Blob>>()
			.mockRejectedValueOnce(new Error('interrupted read'))
			.mockResolvedValueOnce(new Blob(['recovered']));
		const pool = new ObjectURLLeasePool({ create, revoke });

		await expect(pool.acquire('projects/p/proxies/retry.webm', load)).rejects.toThrow(
			'interrupted read'
		);
		const lease = await pool.acquire('projects/p/proxies/retry.webm', load);
		expect(lease.url).toBe('blob:recovered');
		expect(load).toHaveBeenCalledTimes(2);
		lease.release();
		expect(revoke).toHaveBeenCalledWith('blob:recovered');
	});

	it('releases the previous lease immediately on replacement and clear', async () => {
		const releaseFirst = vi.fn();
		const releaseSecond = vi.fn();
		const slot = new VideoSourceURLSlot();
		await slot.replace(async () => ({ url: 'blob:first', release: releaseFirst }));

		const pending = deferred<VideoSourceURLLease>();
		const replacement = slot.replace(() => pending.promise);
		expect(releaseFirst).toHaveBeenCalledTimes(1);
		pending.resolve({ url: 'blob:second', release: releaseSecond });
		expect(await replacement).toBe('blob:second');

		slot.clear();
		slot.clear();
		expect(releaseSecond).toHaveBeenCalledTimes(1);
	});
});
