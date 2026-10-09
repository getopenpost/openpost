import { afterEach, expect, it, vi } from 'vitest';
import {
	decodedPreviewAudio,
	previewAudioContext,
	reversedPreviewAudio
} from './reverse-preview-audio';

const urls: string[] = [];

function source(): string {
	const url = URL.createObjectURL(new Blob([new Uint8Array([1])]));
	urls.push(url);
	return url;
}

function decodeBuffers(bytes: number) {
	// Use actual PCM allocations without encoding minutes of media just to test retention.
	return vi.spyOn(previewAudioContext(), 'decodeAudioData').mockImplementation(
		async () =>
			new AudioBuffer({
				length: bytes / Float32Array.BYTES_PER_ELEMENT,
				numberOfChannels: 1,
				sampleRate: 48_000
			})
	);
}

afterEach(() => {
	for (const url of urls.splice(0)) URL.revokeObjectURL(url);
	vi.restoreAllMocks();
});

it('evicts old decoded sources after 64 MiB while retaining recent audio', async () => {
	const decode = decodeBuffers(16 * 1024 * 1024);
	const sources = Array.from({ length: 5 }, source);
	for (const url of sources) await decodedPreviewAudio(url);
	expect(decode).toHaveBeenCalledTimes(5);
	await decodedPreviewAudio(sources[4]!);
	expect(decode).toHaveBeenCalledTimes(5);
	await decodedPreviewAudio(sources[0]!);
	expect(decode).toHaveBeenCalledTimes(6);
});

it.each([false, true])(
	'shares an oversized decode only while pending (trim past EOF: %s)',
	async (pastEnd) => {
		const decode = decodeBuffers(64 * 1024 * 1024 + 4);
		const url = source();
		const [first, concurrent] = await Promise.all([
			decodedPreviewAudio(url),
			decodedPreviewAudio(url)
		]);
		expect(concurrent).toBe(first);
		expect(decode).toHaveBeenCalledTimes(1);
		await decodedPreviewAudio(url);
		expect(decode).toHaveBeenCalledTimes(2);
		// A cached short reverse trim remains useful even when its decoded source is too big to retain.
		const start = pastEnd ? first.duration - 0.5 : 0;
		const end = start + 1;
		const wide = await reversedPreviewAudio(url, start, end);
		const narrow = await reversedPreviewAudio(url, start + 0.1, end - 0.1);
		expect(narrow.buffer).toBe(wide.buffer);
		expect(decode).toHaveBeenCalledTimes(3);
	}
);

it('shares reversed samples when clips request the same window concurrently', async () => {
	const decode = decodeBuffers(48_000 * 4);
	const url = source();
	const [first, concurrent] = await Promise.all([
		reversedPreviewAudio(url, 0, 1),
		reversedPreviewAudio(url, 0, 1)
	]);
	expect(concurrent.buffer).toBe(first.buffer);
	expect(decode).toHaveBeenCalledTimes(1);
});
