import { describe, expect, it, vi } from 'vitest';
import { createStreamingWritableLifecycle, type StreamingFileWritable } from './stream-target';
import type { StreamTargetChunk } from 'mediabunny';

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: Error): void;
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

function createWritable(overrides: Partial<StreamingFileWritable> = {}): StreamingFileWritable {
	return {
		write: vi.fn(async () => undefined),
		close: vi.fn(async () => undefined),
		abort: vi.fn(async () => undefined),
		...overrides
	};
}

function chunk(position = 0) {
	return {
		type: 'write',
		position,
		data: new Uint8Array([1, 2, 3])
	} satisfies StreamTargetChunk;
}

describe('streaming writable lifecycle', () => {
	it('waits for close before exposing the completed file', async () => {
		const close = deferred();
		const stored = new File(['done'], 'stored.webm', { type: 'video/webm' });
		const writable = createWritable({ close: vi.fn(() => close.promise) });
		const lifecycle = createStreamingWritableLifecycle(
			writable,
			async () => stored,
			async () => undefined
		);
		const writer = lifecycle.writable.getWriter();
		await writer.write(chunk());
		const closePromise = writer.close();
		let exposed = false;
		const filePromise = lifecycle.file('export.webm', 'video/webm').then((file) => {
			exposed = true;
			return file;
		});
		await Promise.resolve();
		expect(exposed).toBe(false);
		close.resolve();
		await closePromise;
		const file = await filePromise;
		expect(await file.text()).toBe('done');
		expect(file.type).toBe('video/webm');
		expect(writable.abort).not.toHaveBeenCalled();
	});

	it('aborts once and preserves the write failure', async () => {
		const failure = new Error('write failed');
		const writable = createWritable({
			write: vi.fn(async () => Promise.reject(failure))
		});
		const lifecycle = createStreamingWritableLifecycle(
			writable,
			async () => new File(['partial'], 'partial.webm'),
			async () => undefined
		);
		const writer = lifecycle.writable.getWriter();
		await expect(writer.write(chunk())).rejects.toBe(failure);
		await expect(lifecycle.file('export.webm', 'video/webm')).rejects.toBe(failure);
		expect(writable.abort).toHaveBeenCalledTimes(1);
	});

	it('does not hang when cancellation races a pending write', async () => {
		const write = deferred();
		const writeStarted = deferred();
		const abort = deferred();
		const controller = new AbortController();
		const writable = createWritable({
			write: vi.fn(async () => {
				writeStarted.resolve();
				await write.promise;
			}),
			abort: vi.fn(() => abort.promise)
		});
		const lifecycle = createStreamingWritableLifecycle(
			writable,
			async () => new File(['partial'], 'partial.webm'),
			async () => undefined,
			controller.signal
		);
		const writer = lifecycle.writable.getWriter();
		const writePromise = writer.write(chunk());
		await writeStarted.promise;
		controller.abort(new DOMException('cancelled', 'AbortError'));
		const fileResult = lifecycle.file('export.webm', 'video/webm').then(
			() => null,
			(error: Error) => error
		);
		abort.resolve();
		write.resolve();
		await expect(writePromise).resolves.toBeUndefined();
		expect(await fileResult).toMatchObject({ name: 'AbortError' });
		expect(writable.abort).toHaveBeenCalledTimes(1);
	});
});
