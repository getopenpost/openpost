import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	acquireTranscriptionWorker,
	disposeTranscriptionWorker,
	hasTranscriptionWorker,
	onTranscriptionWorkerUnload
} from './transcription-worker-pool';

class FakeWorker {
	static instances: FakeWorker[] = [];
	terminated = false;

	constructor() {
		FakeWorker.instances.push(this);
	}

	terminate(): void {
		this.terminated = true;
	}
}

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');

beforeEach(() => {
	FakeWorker.instances = [];
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
});

afterEach(() => {
	disposeTranscriptionWorker('whisper');
	disposeTranscriptionWorker('parakeet');
	if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
	else Reflect.deleteProperty(globalThis, 'Worker');
});

function parseFakeWorker(worker: Worker): FakeWorker {
	// SAFETY: Test harness installs FakeWorker as global Worker, so acquireTranscriptionWorker returns a FakeWorker instance.
	return worker as FakeWorker;
}

describe('transcription worker pool unload', () => {
	it('notifies the active bridge before terminating its resident model worker', () => {
		const onUnload = vi.fn();
		onTranscriptionWorkerUnload('whisper', onUnload);
		const worker = parseFakeWorker(acquireTranscriptionWorker('whisper'));
		expect(hasTranscriptionWorker('whisper')).toBe(true);

		disposeTranscriptionWorker('whisper');

		expect(onUnload).toHaveBeenCalledOnce();
		expect(worker.terminated).toBe(true);
		expect(hasTranscriptionWorker('whisper')).toBe(false);
	});
});
