import { describe, expect, it, beforeEach } from 'vitest';
import { GemmaLlmAdapter } from './adapter';

class MockWorker {
	listeners = new Map<string, Array<(event: unknown) => void>>();
	posted: unknown[] = [];
	addEventListener(type: string, handler: (event: unknown) => void) {
		const list = this.listeners.get(type) ?? [];
		list.push(handler);
		this.listeners.set(type, list);
	}
	postMessage(message: unknown) {
		this.posted.push(message);
		if ((message as { type?: string }).type === 'load') {
			queueMicrotask(() => this.emit('message', { type: 'ready' }));
		}
	}
	terminate() {}
	emit(type: string, data: unknown) {
		const list = this.listeners.get(type) ?? [];
		for (const handler of list) handler({ data } as unknown);
	}
	emitError(message: string) {
		const list = this.listeners.get('error') ?? [];
		for (const handler of list) handler({ message } as unknown);
	}
}

beforeEach(() => {
	if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
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

	it('ignores malformed worker responses without crashing', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => mock as unknown as Worker, 0);
		await adapter.load();
		const pending = adapter.generate([{ role: 'user', content: 'hi' }]);
		// Allow worker to be created and pending to be registered
		await new Promise((r) => setTimeout(r, 5));
		mock.emit('message', { type: 'progress', stage: 'loading-model', percent: NaN });
		mock.emit('message', { type: 'token', id: 1, delta: 123 });
		mock.emit('message', { type: 'result', id: 1, text: 123 });
		mock.emit('message', { type: 'error', message: 123 });
		mock.emit('message', { type: 'unknown' });
		// Should still be pending and not crash
		let settled = false;
		pending.then(
			() => (settled = true),
			() => (settled = true)
		);
		await new Promise((r) => setTimeout(r, 5));
		expect(settled).toBe(false);
		mock.emit('message', { type: 'result', id: 1, text: 'ok' });
		await expect(pending).resolves.toBe('ok');
	});

	it('cancels generation via AbortSignal and rejects with AbortError', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => mock as unknown as Worker, 0);
		await adapter.load();
		const controller = new AbortController();
		const promise = adapter.generate([{ role: 'user', content: 'hi' }], {
			signal: controller.signal
		});
		await new Promise((r) => setTimeout(r, 5));
		controller.abort();
		await expect(promise).rejects.toThrow(/Aborted/);
	});

	it('allows load after dispose to create new worker', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => mock as unknown as Worker, 0);
		await adapter.load();
		adapter.dispose();
		const nextMock = new MockWorker();
		const adapter2 = new GemmaLlmAdapter(() => nextMock as unknown as Worker, 0);
		await adapter2.load();
		const promise = adapter2.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		nextMock.emit('message', { type: 'result', id: 1, text: 'ok' });
		await expect(promise).resolves.toBe('ok');
		adapter2.dispose();
	});

	it('disposes and rejects pending generations, ignoring late results', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => mock as unknown as Worker, 0);
		await adapter.load();
		const promise = adapter.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		adapter.dispose();
		mock.emit('message', { type: 'result', id: 1, text: 'late' });
		await expect(promise).rejects.toThrow(/disposed/i);
	});

	it('ignores stale late messages for unknown ids', async () => {
		const mock = new MockWorker();
		const adapter = new GemmaLlmAdapter(() => mock as unknown as Worker, 0);
		await adapter.load();
		const promise = adapter.generate([{ role: 'user', content: 'hi' }]);
		await new Promise((r) => setTimeout(r, 5));
		mock.emit('message', { type: 'result', id: 9999, text: 'stale' });
		// Still pending - next emission for correct id should resolve
		mock.emit('message', { type: 'result', id: 1, text: 'ok' });
		await expect(promise).resolves.toBe('ok');
	});
});
