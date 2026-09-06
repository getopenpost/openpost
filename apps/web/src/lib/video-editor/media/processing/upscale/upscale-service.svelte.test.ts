import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaTaskId, mediaTasks } from '../../media-tasks.svelte';
import type { MediaMetadata } from '../../types';
import type { UpscaleWorkerRequest, UpscaleWorkerResponse } from '../workers/upscale-worker';
import { gpuMediaJobScheduler } from '../gpu-media-job-scheduler';
import { UpscaleService, type UpscaleServiceDependencies } from './upscale-service.svelte';

class FakeWorker extends EventTarget {
	static instances: FakeWorker[] = [];
	onmessage: ((event: MessageEvent<UpscaleWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	readonly requests: UpscaleWorkerRequest[] = [];
	terminated = false;

	constructor() {
		super();
		FakeWorker.instances.push(this);
	}

	postMessage(request: UpscaleWorkerRequest): void {
		this.requests.push(request);
	}

	dispatch(response: UpscaleWorkerResponse): void {
		this.onmessage?.(new MessageEvent('message', { data: response }));
	}

	terminate(): void {
		this.terminated = true;
	}
}

function media(id: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.mp4`,
		fileSize: 100,
		mimeType: 'video/mp4',
		duration: 1,
		width: 64,
		height: 36,
		fps: 3,
		codec: 'avc',
		bitrate: 800,
		tags: ['video']
	};
}

function generated(file: File): MediaMetadata {
	return {
		id: `generated-${file.name}`,
		storageType: 'workspace',
		fileName: file.name,
		fileSize: file.size,
		mimeType: file.type,
		duration: 1,
		width: 128,
		height: 72,
		fps: 3,
		codec: 'avc',
		bitrate: 1,
		tags: ['video', 'upscaled']
	};
}

beforeEach(() => {
	FakeWorker.instances = [];
	mediaTasks.reset();
});

afterEach(() => mediaTasks.reset());

describe('UpscaleService lifecycle', () => {
	it('serializes jobs, imports a completed result, and settles cancellation before advancing', async () => {
		const importVideo = vi.fn(async (file: File) => generated(file));
		const dependencies: UpscaleServiceDependencies = {
			// SAFETY: FakeWorker implements every Worker member that UpscaleService uses.
			createWorker: () => new FakeWorker() as Worker,
			resolveSource: async () => new Blob(['source'], { type: 'video/mp4' }),
			importVideo,
			rollbackImport: vi.fn(async () => undefined),
			readScratch: async () => new File([new Uint8Array([1, 2, 3])], 'result.mp4'),
			removeScratch: vi.fn(async () => undefined)
		};
		const service = new UpscaleService(dependencies);
		const firstPromise = service.generate(media('first'), 'project', 'liveAction');
		const secondPromise = service.generate(media('second'), 'project', 'animation');

		await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
		const worker = FakeWorker.instances[0]!;
		await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
		const firstRequest = worker.requests[0]!;
		expect(firstRequest).toMatchObject({ type: 'upscale', variant: 'liveAction' });
		if (firstRequest.type !== 'upscale') throw new Error('Expected an upscale request.');
		worker.dispatch({
			type: 'complete',
			jobId: firstRequest.jobId,
			opfsPath: `upscale-tmp/${firstRequest.jobId}.mp4`,
			result: {
				variant: 'liveAction',
				width: 128,
				height: 72,
				sourceWidth: 64,
				sourceHeight: 36,
				fps: 3,
				codec: 'avc',
				frameCount: 3
			}
		});

		await expect(firstPromise).resolves.toMatchObject({ width: 128, height: 72 });
		expect(importVideo).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
		const secondRequest = worker.requests[1]!;
		expect(secondRequest).toMatchObject({ type: 'upscale', variant: 'animation' });
		expect(mediaTasks.cancel(mediaTaskId('upscale', 'second'))).toBe(true);
		expect(mediaTasks.get(mediaTaskId('upscale', 'second'))).toMatchObject({
			status: 'cancelling'
		});
		await vi.waitFor(() => expect(worker.requests).toHaveLength(3));
		expect(worker.requests[2]).toMatchObject({ type: 'cancel' });
		if (secondRequest.type !== 'upscale') throw new Error('Expected an upscale request.');
		worker.dispatch({ type: 'cancelled', jobId: secondRequest.jobId });
		await expect(secondPromise).rejects.toMatchObject({ name: 'AbortError' });
		expect(mediaTasks.get(mediaTaskId('upscale', 'second'))).toBeUndefined();
	});

	it('unloads a resident worker and rejects active work without leaving a task behind', async () => {
		const removeScratch = vi.fn(async () => undefined);
		const dependencies: UpscaleServiceDependencies = {
			// SAFETY: FakeWorker implements every Worker member that UpscaleService uses.
			createWorker: () => new FakeWorker() as Worker,
			resolveSource: async () => new Blob(['source'], { type: 'video/mp4' }),
			importVideo: async (file) => generated(file),
			rollbackImport: async () => undefined,
			readScratch: async () => null,
			removeScratch
		};
		const service = new UpscaleService(dependencies);
		const resultPromise = service.generate(media('resident'), 'project', 'liveAction');
		await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
		const worker = FakeWorker.instances[0]!;
		await vi.waitFor(() => expect(worker.requests[0]).toMatchObject({ type: 'upscale' }));
		expect(service.isLoaded()).toBe(true);

		service.unload();

		await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
		expect(worker.terminated).toBe(true);
		expect(service.isLoaded()).toBe(false);
		expect(mediaTasks.get(mediaTaskId('upscale', 'resident'))).toBeUndefined();
		await vi.waitFor(() => expect(removeScratch).toHaveBeenCalledOnce());
		const releaseGpu = await gpuMediaJobScheduler.acquire(new AbortController().signal);
		releaseGpu();
	});
});
