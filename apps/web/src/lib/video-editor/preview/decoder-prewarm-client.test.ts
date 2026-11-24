import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '@openpost/editor-shared/media';
import type { DecoderPrewarmWorkerRequest } from './decoder-prewarm.worker';
import { clearPreviewDecoderPrewarm, prewarmPreviewFrame } from './decoder-prewarm-client';

const readSource = vi.fn<() => Promise<File>>();
function fileHandle(): FileSystemFileHandle {
	// SAFETY: linked source reads use only getFile on this native I/O boundary.
	return {
		kind: 'file',
		name: 'video.mp4',
		getFile: () => readSource()
	} as FileSystemFileHandle;
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
				data: {
					type: 'decoded',
					requestId: decoder.messages[0]!.requestId,
					entries: []
				}
			})
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(decoder.messages).toHaveLength(1);
		await Promise.all([old, fresh, repeat]);
	}
);
