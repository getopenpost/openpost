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
});
