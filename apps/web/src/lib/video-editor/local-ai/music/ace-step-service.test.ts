import { describe, expect, it, vi } from 'vitest';
import type { AceStepGenerationResult, AceStepUpdateListener, AceStepWebGpu } from 'ai-music-js';
import {
	ACE_STEP_HIGH_DOWNLOAD_BYTES,
	ACE_STEP_STANDARD_DOWNLOAD_BYTES,
	AceStepMusicService,
	musicGenerationTags,
	trimGeneratedWav,
	type AceStepRuntime
} from './ace-step-service';
import { gpuMediaJobScheduler } from '../../media/processing/gpu-media-job-scheduler';

function generationResult(seed: number): AceStepGenerationResult {
	const wav = wavFixture(10);
	// SAFETY: the service never reads audioBuffer in this wrapper test.
	const audioBuffer = {} as AudioBuffer;
	return {
		seed,
		audioQuality: 'standard',
		sampler: 'euler',
		instrumental: true,
		lyrics: '',
		audioBuffer,
		wav,
		wavBytes: new ArrayBuffer(4),
		channels: [new Float32Array(), new Float32Array()],
		sampleRate: 48_000,
		durationSeconds: 10,
		latentFrames: 250,
		trace: [],
		timings: {},
		estimatedPeakBytes: 1
	};
}

function wavFixture(durationSeconds: number): Blob {
	const sampleRate = 48_000;
	const channels = 1;
	const bytesPerSample = 2;
	const blockAlign = channels * bytesPerSample;
	const dataSize = Math.round(durationSeconds * sampleRate) * blockAlign;
	const bytes = new Uint8Array(44 + dataSize);
	const view = new DataView(bytes.buffer);
	const writeId = (offset: number, value: string) => {
		for (let index = 0; index < value.length; index++)
			bytes[offset + index] = value.charCodeAt(index);
	};
	writeId(0, 'RIFF');
	view.setUint32(4, bytes.length - 8, true);
	writeId(8, 'WAVE');
	writeId(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeId(36, 'data');
	view.setUint32(40, dataSize, true);
	return new Blob([bytes], { type: 'audio/wav' });
}

function fakeRuntime() {
	const listeners = new Set<AceStepUpdateListener>();
	const listCachedModels = vi.fn();
	const generate = vi.fn(async (options: Parameters<AceStepWebGpu['generate']>[0]) => {
		for (const listener of listeners) {
			listener({
				type: 'download',
				assetId: 'dit:weights:0',
				group: 'dit',
				label: 'ACE-Step DiT',
				loaded: 500,
				total: 1000,
				cached: false
			});
			listener({
				type: 'progress',
				operation: 'generate',
				stage: 'flow-matching',
				detail: 'DiT 4/8',
				progress: 0.5
			});
		}
		return generationResult(options.seed ?? 42);
	});
	const runtime: AceStepRuntime = {
		generate,
		subscribe: vi.fn((listener: AceStepUpdateListener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		cancel: vi.fn(() => true),
		dispose: vi.fn(),
		listCachedModels,
		clearCache: vi.fn()
	};
	return { runtime, generate, listCachedModels };
}

describe('AceStepMusicService', () => {
	it('rejects invalid work before it allocates a runtime', async () => {
		const createRuntime = vi.fn();
		const service = new AceStepMusicService(createRuntime);

		await expect(
			service.generate({ prompt: ' ', durationSeconds: 10, audioQuality: 'standard' })
		).rejects.toThrow('Describe the music');
		await expect(
			service.generate({ prompt: 'Music', durationSeconds: 1, audioQuality: 'standard' })
		).rejects.toThrow('2 to 120');
		expect(createRuntime).not.toHaveBeenCalled();
	});

	it('renders the model minimum once and returns an exact short WAV without re-encoding', async () => {
		const { runtime, generate } = fakeRuntime();
		const service = new AceStepMusicService(async () => runtime);
		const result = await service.generate({
			prompt: 'Two second logo sting',
			durationSeconds: 2,
			audioQuality: 'standard',
			seed: 9
		});

		expect(generate).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 10 }));
		expect(result.duration).toBe(2);
		const bytes = new Uint8Array(await result.blob.arrayBuffer());
		const view = new DataView(bytes.buffer);
		expect(view.getUint32(40, true)).toBe(2 * 48_000 * 2);
		expect(view.getUint32(4, true)).toBe(bytes.length - 8);
	});

	it('waits behind other GPU media work and cancels without loading the model', async () => {
		const blocker = new AbortController();
		const release = await gpuMediaJobScheduler.acquire(blocker.signal);
		const { runtime } = fakeRuntime();
		const createRuntime = vi.fn(async () => runtime);
		const service = new AceStepMusicService(createRuntime);
		const abort = new AbortController();
		const pending = service.generate({
			prompt: 'Patient ambient bed',
			durationSeconds: 10,
			audioQuality: 'standard',
			signal: abort.signal
		});
		await Promise.resolve();
		expect(createRuntime).not.toHaveBeenCalled();

		abort.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(createRuntime).not.toHaveBeenCalled();
		release();
	});

	it('disposes a runtime that finishes loading after an explicit unload', async () => {
		const { runtime } = fakeRuntime();
		let resolveRuntime!: (runtime: AceStepRuntime) => void;
		const service = new AceStepMusicService(
			() => new Promise<AceStepRuntime>((resolve) => (resolveRuntime = resolve))
		);
		const pending = service.inspectCache();
		expect(service.isLoaded()).toBe(true);

		service.unload();
		resolveRuntime(runtime);

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(runtime.dispose).toHaveBeenCalledOnce();
		expect(service.isLoaded()).toBe(false);
	});
});
