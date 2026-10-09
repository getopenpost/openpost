import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '../media/types';
import type { DecoderPrewarmWorkerRequest } from './decoder-prewarm.worker';
import {
	clearPreviewDecoderPrewarm,
	clonePrewarmedPreviewFrame,
	prewarmPreviewFrame
} from './decoder-prewarm-client';

const readSource = vi.fn<() => Promise<File>>();
function fileHandle(): FileSystemFileHandle {
	// SAFETY: linked source reads use only getFile on this native I/O boundary.
	return { kind: 'file', name: 'video.mp4', getFile: () => readSource() } as FileSystemFileHandle;
}

class ControlledWorker extends EventTarget {
	static instances: ControlledWorker[] = [];
	readonly messages: DecoderPrewarmWorkerRequest[] = [];
	terminated = false;
	constructor() {
		super();
		ControlledWorker.instances.push(this);
	}
	postMessage(message: DecoderPrewarmWorkerRequest): void {
		this.messages.push(message);
	}
	terminate(): void {
		this.terminated = true;
	}
}

const media: MediaMetadata = {
	id: 'video',
	storageType: 'handle',
	fileHandle: fileHandle(),
	fileName: 'video.mp4',
	fileSize: 5,
	mimeType: 'video/mp4',
	width: 64,
	height: 32,
	duration: 2,
	fps: 30,
	codec: 'avc1',
	bitrate: 0,
	tags: []
};
const blob = new File(['video'], 'video.mp4', { type: 'video/mp4' });

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('Worker', ControlledWorker);
	ControlledWorker.instances = [];
	readSource.mockReset().mockResolvedValue(blob);
});
afterEach(async () => {
	clearPreviewDecoderPrewarm();
	await vi.runAllTimersAsync();
	clearPreviewDecoderPrewarm();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it('settles active and queued prewarm requests when the decoder is cleared', async () => {
	let settled = false;
	const first = prewarmPreviewFrame(media, 0, blob);
	const second = prewarmPreviewFrame(media, 1, blob);
	void Promise.all([first, second]).then(() => {
		settled = true;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(ControlledWorker.instances).toHaveLength(1);
	clearPreviewDecoderPrewarm();
	await vi.advanceTimersByTimeAsync(0);
	expect(settled).toBe(true);
	expect(ControlledWorker.instances[0]!.terminated).toBe(true);
	expect(ControlledWorker.instances).toHaveLength(1);
});

it.each(['session clear', 'source replacement', 'source round trip'] as const)(
	'settles obsolete source reads after %s without blocking new frames',
	async (invalidation) => {
		const delayed = Promise.withResolvers<File>();
		readSource.mockReturnValueOnce(delayed.promise);
		let oldSettled = false;
		const old = prewarmPreviewFrame(media, 0);
		void old.then(() => {
			oldSettled = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(readSource).toHaveBeenCalledTimes(1);
		if (invalidation === 'session clear') clearPreviewDecoderPrewarm();
		if (invalidation === 'source round trip')
			void prewarmPreviewFrame({ ...media, fileHandle: fileHandle() }, 0);
		const replacement =
			invalidation === 'source replacement' ? { ...media, fileHandle: fileHandle() } : media;
		const fresh = prewarmPreviewFrame(replacement, 0);
		await vi.advanceTimersByTimeAsync(0);
		expect(oldSettled).toBe(true);
		expect(ControlledWorker.instances).toHaveLength(1);
		const decoder = ControlledWorker.instances[0]!;
		expect(decoder.messages).toHaveLength(1);
		delayed.resolve(blob);
		await vi.advanceTimersByTimeAsync(0);
		expect(decoder.messages).toHaveLength(1);
		const repeat = prewarmPreviewFrame(replacement, 0);
		decoder.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'decoded', requestId: decoder.messages[0]!.requestId, entries: [] }
			})
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(decoder.messages).toHaveLength(1);
		await Promise.all([old, fresh, repeat]);
	}
);

it.each(['cached', 'received before publication'])('closes %s frames on clear', async (stage) => {
	const bitmap: ImageBitmap = { width: 64, height: 32, close: vi.fn() };
	const pending = prewarmPreviewFrame(media, 0, blob);
	await vi.advanceTimersByTimeAsync(0);
	const decoder = ControlledWorker.instances[0]!;
	decoder.dispatchEvent(
		new MessageEvent('message', {
			data: {
				type: 'decoded',
				requestId: decoder.messages[0]!.requestId,
				entries: [{ timestamp: 0, bitmap }]
			}
		})
	);
	if (stage === 'cached') await pending;
	clearPreviewDecoderPrewarm();
	// Reusing the exact source version must not admit a previous session's frames.
	const fresh = prewarmPreviewFrame(media, 0, blob);
	await pending;
	await vi.advanceTimersByTimeAsync(0);
	expect(bitmap.close).toHaveBeenCalledTimes(1);
	expect(await clonePrewarmedPreviewFrame(media.id, 0, 0)).toBeNull();
	const current = ControlledWorker.instances.at(-1)!;
	current.dispatchEvent(
		new MessageEvent('message', {
			data: { type: 'decoded', requestId: current.messages[0]!.requestId, entries: [] }
		})
	);
	await fresh;
});

it.each(['timeout', 'error', 'messageerror'] as const)(
	'releases a decoder after %s and lets the next request recover',
	async (failure) => {
		const pending = prewarmPreviewFrame(media, 0, blob);
		await vi.advanceTimersByTimeAsync(0);
		const failed = ControlledWorker.instances[0]!;
		if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
		else {
			failed.dispatchEvent(new Event(failure));
			await vi.advanceTimersByTimeAsync(0);
		}
		expect(failed.terminated).toBe(true);
		await pending;
		const lateBitmap: ImageBitmap = { width: 32, height: 32, close: vi.fn() };
		failed.dispatchEvent(
			new MessageEvent('message', {
				data: {
					type: 'decoded',
					requestId: failed.messages[0]!.requestId,
					entries: [{ timestamp: 0, bitmap: lateBitmap }]
				}
			})
		);
		expect(lateBitmap.close).toHaveBeenCalledOnce();
		const fresh = prewarmPreviewFrame(media, 1, blob);
		await vi.advanceTimersByTimeAsync(0);
		const recovered = ControlledWorker.instances.at(-1)!;
		expect(recovered).not.toBe(failed);
		recovered.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'decoded', requestId: recovered.messages[0]!.requestId, entries: [] }
			})
		);
		await fresh;
	}
);

it('reads unchanged source bytes once while prewarming successive frames', async () => {
	for (const timestamp of [0, 1]) {
		const pending = prewarmPreviewFrame(media, timestamp);
		await vi.advanceTimersByTimeAsync(0);
		const worker = ControlledWorker.instances.at(-1)!;
		worker.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'decoded', requestId: worker.messages.at(-1)!.requestId, entries: [] }
			})
		);
		await pending;
	}
	expect(readSource).toHaveBeenCalledTimes(1);
});
