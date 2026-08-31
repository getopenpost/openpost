import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneCaptionProvider } from './caption-provider';
import { clipProvider } from './clip-provider';
import { embeddingsProvider } from './embeddings-provider';

/** Typed inbound message for scene worker test fakes. */
interface FakeWorkerMessage {
	type: string;
	id?: number;
	before?: Blob;
	after?: Blob;
}

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
	it('verifies scene-cut frame pairs through the shared local model worker', async () => {
		const loading = sceneCaptionProvider.ensureReady();
		const worker = FakeWorker.instances.at(-1)!;
		worker.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
		await loading;

		const progress: Array<{ stage: string; completed: number }> = [];
		const verification = sceneCaptionProvider.verifySceneCuts(
			[{ before: new Blob(['before']), after: new Blob(['after']) }],
			{ onProgress: (value) => progress.push(value) }
		);
		await vi.waitFor(() => expect(worker.messages.at(-1)?.type).toBe('verify'));
		const id = worker.messages.at(-1)?.id;
		worker.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'result', id, isSceneCut: true, reason: 'CUT' }
			})
		);

		await expect(verification).resolves.toEqual([true]);
		expect(progress).toEqual([{ stage: 'verifying', percent: 100, completed: 1, total: 1 }]);
	});

	it('reports inference failures so scene detection can keep deterministic candidates', async () => {
		const loading = sceneCaptionProvider.ensureReady();
		const worker = FakeWorker.instances.at(-1)!;
		worker.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
		await loading;

		const verification = sceneCaptionProvider.verifySceneCuts([
			{ before: new Blob(['before']), after: new Blob(['after']) }
		]);
		await vi.waitFor(() => expect(worker.messages.at(-1)?.type).toBe('verify'));
		worker.dispatchEvent(
			new MessageEvent('message', {
				data: {
					type: 'result',
					id: worker.messages.at(-1)?.id,
					isSceneCut: false,
					reason: 'error: inference failed'
				}
			})
		);

		await expect(verification).rejects.toThrow('inference failed');
	});

	it('serializes shared model operations', async () => {
		const loading = sceneCaptionProvider.ensureReady();
		const worker = FakeWorker.instances.at(-1)!;
		worker.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
		await loading;
		const pair = { before: new Blob(['before']), after: new Blob(['after']) };

		const first = sceneCaptionProvider.verifySceneCuts([pair]);
		const second = sceneCaptionProvider.verifySceneCuts([pair]);
		await vi.waitFor(() =>
			expect(worker.messages.filter((message) => message.type === 'verify')).toHaveLength(1)
		);
		const firstId = worker.messages.at(-1)?.id;
		worker.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'result', id: firstId, isSceneCut: true, reason: 'CUT' }
			})
		);
		await expect(first).resolves.toEqual([true]);

		await vi.waitFor(() =>
			expect(worker.messages.filter((message) => message.type === 'verify')).toHaveLength(2)
		);
		worker.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'result', id: worker.messages.at(-1)?.id, isSceneCut: false, reason: 'SAME' }
			})
		);
		await expect(second).resolves.toEqual([false]);
	});

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
