import { describe, expect, it, beforeEach } from 'vitest';
import { GemmaLlmAdapter } from './adapter';
import { parseLlmWorkerRequest } from './worker-protocol';
import type { JsonValue } from '../types';

interface MockMessageEvent {
	data: JsonValue;
}

interface MockErrorEvent {
	message: string;
}

type MockWorkerEvent = MockMessageEvent | MockErrorEvent;

class MockWorker {
	listeners = new Map<string, Array<(event: MockWorkerEvent) => void>>();
	posted: JsonValue[] = [];
	addEventListener(type: string, handler: (event: MockWorkerEvent) => void) {
		const list = this.listeners.get(type) ?? [];
		list.push(handler);
		this.listeners.set(type, list);
	}
	postMessage(message: JsonValue) {
		this.posted.push(message);
		if (parseLlmWorkerRequest(message)?.type === 'load') {
			queueMicrotask(() => this.emit('message', { type: 'ready' }));
		}
	}
	terminated = false;
	terminate() {
		this.terminated = true;
	}
	emit(type: string, data: JsonValue) {
		const list = this.listeners.get(type) ?? [];
		for (const handler of list) handler({ data });
	}
	emitError(message: string) {
		const list = this.listeners.get('error') ?? [];
		for (const handler of list) handler({ message });
	}
	emitMessageError() {
		const list = this.listeners.get('messageerror') ?? [];
		for (const handler of list) handler({ data: null });
	}
}

function worker(mock: MockWorker): Worker {
	// @ts-expect-error MockWorker deliberately implements only the Worker surface used by the adapter.
	return mock;
}

beforeEach(() => {
	if (!('gpu' in navigator)) {
		Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
	}
});

describe('GemmaLlmAdapter', () => {
	it('rejects malformed maxTokens, temperature and topP before contacting worker', async () => {
		const adapter = new GemmaLlmAdapter();
		await expect(adapter.generate([], { maxTokens: NaN })).rejects.toThrow(RangeError);
		await expect(adapter.generate([], { maxTokens: Infinity })).rejects.toThrow(RangeError);
		await expect(adapter.generate([], { temperature: NaN })).rejects.toThrow(RangeError);
		await expect(adapter.generate([], { topP: 2 })).rejects.toThrow(RangeError);
		await expect(adapter.generate([], { topP: -0.1 })).rejects.toThrow(RangeError);
	});

	it('fails closed on a malformed worker response', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		const pending = adapter.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		mock.emit('message', { type: 'token', id: 1, delta: 123 });
		await expect(pending).rejects.toThrow(/invalid response/i);
		expect(mock.terminated).toBe(true);
	});

	it('cancels generation via AbortSignal and rejects with AbortError', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		const controller = new AbortController();
		const promise = adapter.generate([{ role: 'user', content: 'hi' }], {
			signal: controller.signal
		});
		await new Promise((r) => setTimeout(r, 5));
		controller.abort();
		expect(mock.posted).toContainEqual({ type: 'cancel', id: 1 });
		mock.emit('message', { type: 'result', id: 1, text: 'cancelled' });
		await expect(promise).rejects.toThrow(/Aborted/);
	});

	it('serializes generations until the previous worker call settles', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		const first = adapter.generate([{ role: 'user', content: 'first' }]);
		const second = adapter.generate([{ role: 'user', content: 'second' }]);
		await new Promise((r) => setTimeout(r, 5));
		expect(
			mock.posted.filter((message) => parseLlmWorkerRequest(message)?.type === 'generate')
		).toHaveLength(1);
		mock.emit('message', { type: 'result', id: 1, text: 'one' });
		await expect(first).resolves.toBe('one');
		await new Promise((r) => setTimeout(r, 0));
		expect(
			mock.posted.filter((message) => parseLlmWorkerRequest(message)?.type === 'generate')
		).toHaveLength(2);
		mock.emit('message', { type: 'result', id: 2, text: 'two' });
		await expect(second).resolves.toBe('two');
	});

	it('rejects pending work on worker crash and creates a clean worker next time', async () => {
		const firstWorker = new MockWorker();
		const secondWorker = new MockWorker();
		const workers = [firstWorker, secondWorker];
		const adapter = new GemmaLlmAdapter(() => worker(workers.shift()!), 0);
		await adapter.load();
		const failed = adapter.generate([{ role: 'user', content: 'first' }]);
		await new Promise((r) => setTimeout(r, 5));
		firstWorker.emitError('GPU process stopped');
		await expect(failed).rejects.toThrow(/GPU process stopped/i);
		expect(firstWorker.terminated).toBe(true);

		const recovered = adapter.generate([{ role: 'user', content: 'second' }]);
		await new Promise((r) => setTimeout(r, 5));
		secondWorker.emit('message', { type: 'result', id: 2, text: 'recovered' });
		await expect(recovered).resolves.toBe('recovered');
	});

	it('rejects pending work when a worker response cannot be cloned', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		const pending = adapter.generate([{ role: 'user', content: 'first' }]);
		await new Promise((resolve) => setTimeout(resolve, 5));
		mock.emitMessageError();
		await expect(pending).rejects.toThrow(/could not be read/i);
		expect(mock.terminated).toBe(true);
	});

	it('allows load after dispose to create new worker', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		adapter.dispose();
		const nextMock = new MockWorker();
		const adapter2 = new GemmaLlmAdapter(() => worker(nextMock), 0);
		await adapter2.load();
		const promise = adapter2.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		nextMock.emit('message', { type: 'result', id: 1, text: 'ok' });
		await expect(promise).resolves.toBe('ok');
		adapter2.dispose();
	});

	it('disposes and rejects pending generations, ignoring late results', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		const promise = adapter.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		adapter.dispose();
		mock.emit('message', { type: 'result', id: 1, text: 'late' });
		await expect(promise).rejects.toThrow(/disposed/i);
	});

	it('ignores stale late messages for unknown ids', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => worker(mock), 0);
		await adapter.load();
		const promise = adapter.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		mock.emit('message', { type: 'result', id: 9999, text: 'stale' });
		// Still pending - next emission for correct id should resolve
		mock.emit('message', { type: 'result', id: 1, text: 'ok' });
		await expect(promise).resolves.toBe('ok');
	});
});
