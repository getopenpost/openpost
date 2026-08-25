import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sceneCaptionProvider } from './caption-provider';
import { clipProvider } from './clip-provider';
import { embeddingsProvider } from './embeddings-provider';

/** Typed inbound message for scene worker test fakes. */
type FakeWorkerMessage = { type: string; [key: string]: string | number | boolean | undefined };

class FakeWorker extends EventTarget {
	static instances: FakeWorker[] = [];
	terminated = false;
	readonly messages: FakeWorkerMessage[] = [];

	constructor() {
		super();
		FakeWorker.instances.push(this);
	}

	postMessage(message: FakeWorkerMessage): void {
		this.messages.push(message);
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
	sceneCaptionProvider.dispose();
	embeddingsProvider.dispose();
	clipProvider.dispose();
	if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
	else Reflect.deleteProperty(globalThis, 'Worker');
});

describe('scene model runtime unload', () => {
	it.each([
		['scene captions', () => sceneCaptionProvider.ensureReady(), sceneCaptionProvider.dispose],
		['semantic search', () => embeddingsProvider.ensureReady(), embeddingsProvider.dispose],
		['visual search', () => clipProvider.ensureReady(), clipProvider.dispose]
	] as const)('rejects an active %s load and terminates its worker', async (_, start, unload) => {
		const pending = start();
		const worker = FakeWorker.instances.at(-1)!;
		expect(worker.messages[0]).toMatchObject({ type: 'init' });

		unload();

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(worker.terminated).toBe(true);
	});
});
