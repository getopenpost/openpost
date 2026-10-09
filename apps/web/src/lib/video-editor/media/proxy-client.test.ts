import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MediaMetadata } from './types';
import type { ProxyRequest, ProxyWorkerResponse } from './proxy-worker';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';
import { cachedProxy, clearProxyCache, getAutomaticProxy, getProxy } from './proxy-client';

class ControlledWorker {
	static instances: ControlledWorker[] = [];
	request?: ProxyRequest;
	onmessage: ((event: MessageEvent<ProxyWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	terminated = false;
	constructor() {
		ControlledWorker.instances.push(this);
	}
	postMessage(request: ProxyRequest): void {
		this.request = request;
	}
	terminate(): void {
		this.terminated = true;
	}
	reply(message: ProxyWorkerResponse): void {
		this.onmessage?.(new MessageEvent('message', { data: message }));
	}
}
const ids = new Set<string>();
const finishReads: Array<() => void> = [];
function media(
	id: string = crypto.randomUUID(),
	name = 'source.mp4',
	getFile: () => Promise<File> = async () => new File([name], name)
): MediaMetadata {
	ids.add(id);
	// SAFETY: linked source resolution only calls getFile on the native handle.
	const fileHandle = { kind: 'file', name, getFile } as FileSystemFileHandle;
	return {
		id,
		storageType: 'handle',
		fileHandle,
		fileName: name,
		fileSize: 5,
		mimeType: 'video/mp4',
		width: 3840,
		height: 2160,
		duration: 2,
		fps: 30,
		codec: 'avc1',
		bitrate: 0,
		tags: []
	};
}
async function decoder(index: number): Promise<ControlledWorker> {
	await vi.waitFor(() => expect(ControlledWorker.instances[index]?.request).toBeDefined());
	return ControlledWorker.instances[index]!;
}
function observe(promise: Promise<Blob>) {
	return promise.then(
		(blob) => ({ blob, error: undefined }),
		(error) => ({ blob: undefined, error })
	);
}
beforeEach(() => {
	vi.stubGlobal('Worker', ControlledWorker);
	ControlledWorker.instances = [];
});
afterEach(async () => {
	for (const id of ids) clearProxyCache(id);
	ids.clear();
	mediaTasks.reset();
	for (const finish of finishReads.splice(0)) finish();
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (const worker of ControlledWorker.instances)
		worker.reply({ type: 'error', message: 'cleanup' });
	vi.unstubAllGlobals();
});

it('replaces an invalidated source without returning its previous in-flight proxy', async () => {
	const source = media();
	const stale = observe(getAutomaticProxy(source));
	const first = await decoder(0);
	clearProxyCache(source.id);
	const replacement = media(source.id, 'replacement.mp4');
	const fresh = observe(getAutomaticProxy(replacement));
	first.reply({ type: 'complete', blob: new Blob(['old proxy']) });
	const second = await decoder(1);
	expect(await second.request!.file.text()).toBe('replacement.mp4');
	second.reply({ type: 'complete', blob: new Blob(['fresh proxy']) });
	expect((await stale).error).toMatchObject({ name: 'AbortError' });
	expect(await (await fresh).blob!.text()).toBe('fresh proxy');
	expect(await cachedProxy(source.id)!.text()).toBe('fresh proxy');
});

it('starts a fresh automatic job when a caller arrives immediately after its last waiter cancels', async () => {
	const source = media();
	const controller = new AbortController();
	const cancelled = observe(getAutomaticProxy(source, undefined, controller.signal));
	await decoder(0);
	controller.abort();
	const fresh = observe(getAutomaticProxy(source));
	const second = await decoder(1);
	second.reply({ type: 'complete', blob: new Blob(['fresh proxy']) });
	expect((await cancelled).error).toMatchObject({ name: 'AbortError' });
	expect(await (await fresh).blob!.text()).toBe('fresh proxy');
});

it('keeps a shared encode alive and reports progress to a caller whose peer cancels', async () => {
	const source = media();
	const controller = new AbortController();
	const first = observe(getProxy(source, undefined, controller.signal));
	const progress = vi.fn();
	const second = observe(getProxy(source, progress));
	const worker = await decoder(0);
	controller.abort();
	await vi.waitFor(async () => expect((await first).error).toMatchObject({ name: 'AbortError' }));
	expect(worker.terminated).toBe(false);
	worker.reply({ type: 'progress', progress: 0.5 });
	expect(progress).toHaveBeenCalledWith(0.5);
	worker.reply({ type: 'complete', blob: new Blob(['shared proxy']) });
	expect(await (await second).blob!.text()).toBe('shared proxy');
	expect(ControlledWorker.instances).toHaveLength(1);
});

it('cancels queued task waiters promptly while keeping subsequent background encodes serialized', async () => {
	const firstSource = media();
	const first = observe(getAutomaticProxy(firstSource));
	const worker = await decoder(0);
	const queuedSource = media();
	let cancelled = false;
	const queued = observe(getAutomaticProxy(queuedSource)).then((result) => {
		cancelled = true;
		return result;
	});
	mediaTasks.cancel(mediaTaskId('proxy', queuedSource.id));
	await vi.waitFor(() => expect(cancelled).toBe(true));
	const thirdSource = media(undefined, 'third.mp4');
	const third = observe(getAutomaticProxy(thirdSource));
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(ControlledWorker.instances).toHaveLength(1);
	worker.reply({ type: 'complete', blob: new Blob(['first']) });
	const thirdWorker = await decoder(1);
	expect(await thirdWorker.request!.file.text()).toBe(thirdSource.fileName);
	thirdWorker.reply({ type: 'complete', blob: new Blob(['third']) });
	expect((await queued).error).toMatchObject({ name: 'AbortError' });
	expect(await (await first).blob!.text()).toBe('first');
	expect(await (await third).blob!.text()).toBe('third');
});

it.each(['resolve', 'reject'])(
	'cancels a pending source read and preserves the replacement after its late %s',
	async (outcome) => {
		const delayed = Promise.withResolvers<File>();
		finishReads.push(() => delayed.resolve(new File(['cleanup'], 'source.mp4')));
		const getFile = vi
			.fn<() => Promise<File>>()
			.mockReturnValueOnce(delayed.promise)
			.mockResolvedValue(new File(['fresh source'], 'source.mp4'));
		const source = media(undefined, 'source.mp4', getFile);
		let settled = false;
		const pending = observe(getAutomaticProxy(source)).then((result) => {
			settled = true;
			return result;
		});
		await vi.waitFor(() => expect(getFile).toHaveBeenCalledTimes(1));
		mediaTasks.cancel(mediaTaskId('proxy', source.id));
		await vi.waitFor(() => expect(settled).toBe(true));
		expect((await pending).error).toMatchObject({ name: 'AbortError' });
		const fresh = observe(getAutomaticProxy(source));
		const worker = await decoder(0);
		worker.reply({ type: 'complete', blob: new Blob(['fresh']) });
		expect(await (await fresh).blob!.text()).toBe('fresh');
		if (outcome === 'resolve') delayed.resolve(new File(['stale source'], 'source.mp4'));
		else delayed.reject(new Error('old source unavailable'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ControlledWorker.instances).toHaveLength(1);
		expect(await cachedProxy(source.id)!.text()).toBe('fresh');
	}
);
