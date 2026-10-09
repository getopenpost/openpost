import { afterEach, expect, it, vi } from 'vitest';
import { getMediaObjectUrl, revokeMediaObjectUrl } from './media-source';
import type { MediaMetadata } from './types';

const ids = new Set<string>();
const urls = new Set<string>();

function linkedMedia(getFile: () => Promise<File>, id = crypto.randomUUID()): MediaMetadata {
	ids.add(id);
	// SAFETY: resolving linked source bytes only calls getFile on the native handle boundary.
	const fileHandle = { kind: 'file', name: 'source.txt', getFile } as FileSystemFileHandle;
	return {
		id,
		storageType: 'handle',
		fileHandle,
		fileName: 'source.txt',
		fileSize: 6,
		mimeType: 'text/plain',
		duration: 0,
		width: 0,
		height: 0,
		fps: 0,
		codec: '',
		bitrate: 0,
		tags: []
	};
}

afterEach(() => {
	for (const id of ids) revokeMediaObjectUrl(id);
	for (const url of urls) URL.revokeObjectURL(url);
	ids.clear();
	urls.clear();
	vi.restoreAllMocks();
});

it('shares one source read and Blob URL between simultaneous consumers', async () => {
	const read = vi.fn(async () => new File(['source'], 'source.txt'));
	const media = linkedMedia(read);
	const [first, second] = await Promise.all([getMediaObjectUrl(media), getMediaObjectUrl(media)]);
	urls.add(first);
	urls.add(second);
	expect(await (await fetch(first)).text()).toBe('source');
	expect(second).toBe(first);
	expect(read).toHaveBeenCalledTimes(1);
	revokeMediaObjectUrl(media.id);
	await expect(fetch(first)).rejects.toThrow();
});

it('rejects a revoked pending source without overwriting the replacement URL', async () => {
	const pending = Promise.withResolvers<File>();
	const media = linkedMedia(() => pending.promise);
	const stale = getMediaObjectUrl(media);
	// Attach a rejection handler before revoking, since fetch-backed sources can abort immediately.
	const staleResult = expect(
		stale.then((url) => {
			urls.add(url);
			return url;
		})
	).rejects.toMatchObject({ name: 'AbortError' });
	revokeMediaObjectUrl(media.id);
	const replacement = linkedMedia(async () => new File(['new bytes'], 'source.txt'), media.id);
	const fresh = await getMediaObjectUrl(replacement);
	urls.add(fresh);
	pending.resolve(new File(['old bytes'], 'source.txt'));
	await staleResult;
	expect(await getMediaObjectUrl(replacement)).toBe(fresh);
	expect(await (await fetch(fresh)).text()).toBe('new bytes');
});

it('retries a failed source read without retaining the rejected pending request', async () => {
	const sourceUrl = URL.createObjectURL(new Blob(['retried bytes']));
	urls.add(sourceUrl);
	const media = {
		...linkedMedia(async () => new File([], 'source.txt')),
		storageType: 'cloud' as const,
		remoteUrl: sourceUrl
	};
	vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline'));
	await expect(getMediaObjectUrl(media)).rejects.toThrow('offline');
	const url = await getMediaObjectUrl(media);
	urls.add(url);
	expect(await (await fetch(url)).text()).toBe('retried bytes');
});
