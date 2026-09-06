import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaTaskId, mediaTasks } from '../../media-tasks.svelte';
import type { MediaMetadata } from '../../types';
import type {
	InterpolationWorkerRequest,
	InterpolationWorkerResponse
} from '../workers/frame-interpolation-worker';
import { gpuMediaJobScheduler } from '../gpu-media-job-scheduler';
import {
	FrameInterpolationService,
	type FrameInterpolationServiceDependencies
} from './frame-interpolation-service.svelte';

class FakeWorker extends EventTarget {
	static instances: FakeWorker[] = [];
	onmessage: ((event: MessageEvent<InterpolationWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	readonly requests: InterpolationWorkerRequest[] = [];
	terminated = false;

	constructor() {
		super();
		FakeWorker.instances.push(this);
	}

	postMessage(request: InterpolationWorkerRequest): void {
		this.requests.push(request);
	}

	dispatch(response: InterpolationWorkerResponse): void {
		this.onmessage?.(new MessageEvent('message', { data: response }));
	}

	crash(message: string): void {
		this.onerror?.(new ErrorEvent('error', { message }));
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
		fps: 24,
		codec: 'avc',
		bitrate: 800,
		tags: ['video']
	};
}

function generated(file: File): MediaMetadata {
	return {
		...media(`generated-${file.name}`),
		fileName: file.name,
		fileSize: file.size,
		fps: 96,
		tags: ['video', 'interpolated']
	};
}

function dependencies(
	overrides: Partial<FrameInterpolationServiceDependencies> = {}
): FrameInterpolationServiceDependencies {
	return {
		// SAFETY: FakeWorker implements every Worker member that FrameInterpolationService uses.
		createWorker: () => new FakeWorker() as Worker,
		resolveSource: async () => new Blob(['source'], { type: 'video/mp4' }),
		importVideo: async (file) => generated(file),
		rollbackImport: async () => undefined,
		readScratch: async () => new File([new Uint8Array([1, 2, 3])], 'result.mp4'),
		removeScratch: async () => undefined,
		...overrides
	};
}

beforeEach(() => {
	FakeWorker.instances = [];
	mediaTasks.reset();
});

afterEach(() => mediaTasks.reset());

describe('FrameInterpolationService lifecycle', () => {
	it('reports model download bytes, imports the result, and removes scratch output', async () => {
		const importVideo = vi.fn(async (file: File) => generated(file));
		const removeScratch = vi.fn(async () => undefined);
		const service = new FrameInterpolationService(dependencies({ importVideo, removeScratch }));
		const resultPromise = service.generate(media('source'), 'project', 4);

		await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
		const worker = FakeWorker.instances[0]!;
		await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
		const request = worker.requests[0]!;
		if (request.type !== 'interpolate') throw new Error('Expected an interpolation request.');

		worker.dispatch({
			type: 'progress',
			jobId: request.jobId,
			stage: 'downloading-model',
			progress: 0.25,
			receivedBytes: 5_000,
			totalBytes: 20_000
		});
		expect(mediaTasks.get(mediaTaskId('frame-interpolation', 'source'))).toMatchObject({
			stage: 'downloading-model',
			progress: 0.25,
			receivedBytes: 5_000,
			totalBytes: 20_000
		});

		worker.dispatch({
			type: 'complete',
			jobId: request.jobId,
			opfsPath: `interpolation-tmp/${request.jobId}.mp4`,
			result: {
				factor: 4,
				width: 64,
				height: 36,
				sourceWidth: 64,
				sourceHeight: 36,
				sourceFps: 24,
				outputFps: 96,
				codec: 'avc',
				frameCount: 96
			}
		});

		await expect(resultPromise).resolves.toMatchObject({ fps: 96 });
		expect(importVideo).toHaveBeenCalledOnce();
		expect(importVideo.mock.calls[0]?.[0].name).toBe('source (96fps).mp4');
		expect(removeScratch).toHaveBeenCalledWith(request.jobId);
		expect(mediaTasks.get(mediaTaskId('frame-interpolation', 'source'))).toBeUndefined();
	});

	it('cancels promptly before dispatch without creating a worker', async () => {
		let resolveSource!: (blob: Blob) => void;
		const source = new Promise<Blob>((resolve) => (resolveSource = resolve));
		const service = new FrameInterpolationService(
			dependencies({ resolveSource: async () => source })
		);
		const resultPromise = service.generate(media('slow-source'), 'project', 2);
		await vi.waitFor(() =>
			expect(mediaTasks.get(mediaTaskId('frame-interpolation', 'slow-source'))?.status).toBe(
				'running'
			)
		);

		expect(mediaTasks.cancel(mediaTaskId('frame-interpolation', 'slow-source'))).toBe(true);
		await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
		expect(FakeWorker.instances).toHaveLength(0);
		resolveSource(new Blob(['late']));
	});

	it('rejects a worker crash and removes its partial scratch file', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const removeScratch = vi.fn(async () => undefined);
		const service = new FrameInterpolationService(dependencies({ removeScratch }));
		const resultPromise = service.generate(media('crash'), 'project', 2);
		await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
		const worker = FakeWorker.instances[0]!;
		await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
		const request = worker.requests[0]!;
		if (request.type !== 'interpolate') throw new Error('Expected an interpolation request.');

		worker.crash('decoder failed');
		await expect(resultPromise).rejects.toThrow('decoder failed');
		expect(consoleError).toHaveBeenCalled();
		expect(worker.terminated).toBe(true);
		await vi.waitFor(() => expect(removeScratch).toHaveBeenCalledWith(request.jobId));
		consoleError.mockRestore();
	});

	it('unloads a resident worker and rejects active work without leaving a task behind', async () => {
		const removeScratch = vi.fn(async () => undefined);
		const service = new FrameInterpolationService(dependencies({ removeScratch }));
		const resultPromise = service.generate(media('resident'), 'project', 2);
		await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
		const worker = FakeWorker.instances[0]!;
		await vi.waitFor(() => expect(worker.requests[0]).toMatchObject({ type: 'interpolate' }));
		expect(service.isLoaded()).toBe(true);

		service.unload();

		await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
		expect(worker.terminated).toBe(true);
		expect(service.isLoaded()).toBe(false);
		expect(mediaTasks.get(mediaTaskId('frame-interpolation', 'resident'))).toBeUndefined();
		await vi.waitFor(() => expect(removeScratch).toHaveBeenCalledOnce());
		const releaseGpu = await gpuMediaJobScheduler.acquire(new AbortController().signal);
		releaseGpu();
	});
});
