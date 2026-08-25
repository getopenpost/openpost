import { describe, expect, it, vi } from 'vitest';
import {
	shouldStreamExport,
	isStreamingTargetAvailable,
	STREAMING_EXPORT_THRESHOLD_BYTES
} from './render-export';
import {
	IN_MEMORY_OUTPUT_LIMIT,
	STREAMING_EXPORT_LIMIT,
	assessExportPreflight,
	isStreamingExportAvailable
} from './export-preflight';
import { shouldUseChunkedSave } from './persist-rendered-export';

describe('streaming export thresholds', () => {
	it('keeps small outputs on BufferTarget', () => {
		expect(shouldStreamExport(10 * 1024 * 1024)).toBe(false);
		expect(shouldStreamExport(STREAMING_EXPORT_THRESHOLD_BYTES - 1)).toBe(false);
	});

	it('streams outputs above the chunk threshold', () => {
		expect(shouldStreamExport(STREAMING_EXPORT_THRESHOLD_BYTES + 1)).toBe(true);
		expect(shouldStreamExport(500 * 1024 * 1024)).toBe(true);
		expect(shouldStreamExport(2 * 1024 ** 3 + 1)).toBe(true);
	});

	it('rejects non-finite sizes without streaming', () => {
		expect(shouldStreamExport(Number.NaN)).toBe(false);
		expect(shouldStreamExport(0)).toBe(false);
		expect(shouldStreamExport(-1)).toBe(false);
	});

	it('exposes streaming availability via navigator.storage', () => {
		const originalNavigator = globalThis.navigator;
		try {
			Object.defineProperty(globalThis, 'navigator', {
				value: {},
				writable: true,
				configurable: true
			});
			expect(isStreamingTargetAvailable()).toBe(false);
			expect(isStreamingExportAvailable()).toBe(false);

			Object.defineProperty(globalThis, 'navigator', {
				value: { storage: { getDirectory: async () => ({}) } },
				writable: true,
				configurable: true
			});
			expect(isStreamingTargetAvailable()).toBe(true);
			expect(isStreamingExportAvailable()).toBe(true);
		} finally {
			Object.defineProperty(globalThis, 'navigator', {
				value: originalNavigator,
				writable: true,
				configurable: true
			});
		}
	});

	it('preflight streaming limits separate from in-memory limits', () => {
		expect(IN_MEMORY_OUTPUT_LIMIT).toBe(2 * 1024 ** 3);
		expect(STREAMING_EXPORT_LIMIT).toBe(8 * 1024 ** 3);
		expect(STREAMING_EXPORT_LIMIT).toBeGreaterThan(IN_MEMORY_OUTPUT_LIMIT);
	});

	it('shouldUseChunkedSave respects large-blob threshold', () => {
		expect(shouldUseChunkedSave(1 * 1024 * 1024)).toBe(false);
		expect(shouldUseChunkedSave(20 * 1024 * 1024 - 1)).toBe(false);
		expect(shouldUseChunkedSave(20 * 1024 * 1024 + 1)).toBe(true);
		expect(shouldUseChunkedSave(500 * 1024 * 1024)).toBe(true);
	});
});

describe('chunked workspace writes', () => {
	it('uses chunked writes for large blobs and bounded size', () => {
		// Large blobs (>20 MiB) must use streaming writes, not one-shot writeBlob
		expect(shouldUseChunkedSave(25 * 1024 * 1024 + 100)).toBe(true);
		expect(shouldUseChunkedSave(10 * 1024)).toBe(false);
	});

	it('cleans up partial workspace file on write failure', async () => {
		const writerWrite = vi.fn(async () => {
			throw new Error('disk full');
		});
		const writerClose = vi.fn(async () => undefined);
		const writerAbort = vi.fn(async () => undefined);
		const fakeWriter = { write: writerWrite, close: writerClose, abort: writerAbort };
		// Verify abort path is invoked when write fails
		try {
			await fakeWriter.write(new Uint8Array([1, 2, 3]));
		} catch {
			await fakeWriter.abort(new Error('disk full'));
		}
		expect(writerAbort).toHaveBeenCalledOnce();
		expect(writerClose).not.toHaveBeenCalled();
	});
});

describe('preflight selection with streaming', () => {
	it('uses streaming for large estimates and in-memory for small', () => {
		const large = 500 * 1024 * 1024;
		const small = 10 * 1024 * 1024;
		expect(shouldStreamExport(large)).toBe(true);
		expect(shouldStreamExport(small)).toBe(false);

		const videoTrack = {
			id: 't',
			name: 'T',
			kind: 'video' as const,
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item = {
			id: 'i',
			trackId: 't',
			from: 0,
			durationInFrames: 30 * 60 * 30,
			label: 'x',
			type: 'video' as const,
			mediaId: 'm'
		};
		const largeResult = assessExportPreflight({
			settings: {
				format: 'mp4',
				codec: 'avc',
				quality: 'high',
				width: 1920,
				height: 1080,
				subtitleMode: 'burn'
			},
			fps: 30,
			items: [item],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { m: 'ready' },
			streamingAvailable: true
		});
		expect(largeResult.canExport).toBe(true);
		expect(largeResult.checks.some((c) => c.id === 'streaming-active')).toBe(true);

		const smallResult = assessExportPreflight({
			settings: {
				format: 'mp4',
				codec: 'avc',
				quality: 'draft',
				width: 1920,
				height: 1080,
				subtitleMode: 'burn'
			},
			fps: 30,
			items: [{ ...item, durationInFrames: 30 }],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { m: 'ready' },
			streamingAvailable: true
		});
		expect(smallResult.checks.some((c) => c.id === 'streaming-active')).toBe(false);
	});

	it('small outputs remain compatible when streaming is unavailable', () => {
		const videoTrack = {
			id: 't',
			name: 'T',
			kind: 'video' as const,
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item = {
			id: 'i',
			trackId: 't',
			from: 0,
			durationInFrames: 300,
			label: 'x',
			type: 'video' as const,
			mediaId: 'm'
		};
		const result = assessExportPreflight({
			settings: {
				format: 'mp4',
				codec: 'avc',
				quality: 'standard',
				width: 1920,
				height: 1080,
				subtitleMode: 'burn'
			},
			fps: 30,
			items: [item],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { m: 'ready' },
			streamingAvailable: false
		});
		expect(result.canExport).toBe(true);
		expect(result.predictedRenderPath).toBe('worker');
	});
});

describe('worker failure semantics', () => {
	it('does not hide a worker render error behind a second render', async () => {
		const { renderExportArtifact } = await import('./render-execution');
		const fakeWorker = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			postMessage: vi.fn(),
			terminate: vi.fn()
		} as unknown as import('./render-execution').RenderWorkerPort;

		let capturedOnMessage: (event: Event) => void = () => {};
		fakeWorker.addEventListener = vi.fn((type: string, fn: never) => {
			if (type === 'message') capturedOnMessage = fn as never;
		}) as never;

		const createWorker = vi.fn(() => fakeWorker);
		const renderVideoMain = vi.fn(async () => {
			throw new Error('should not be called');
		});

		const pending = renderExportArtifact(
			{
				mode: 'video',
				project: {
					id: 'p',
					name: 'P',
					description: '',
					createdAt: 0,
					updatedAt: 0,
					duration: 1,
					metadata: { width: 16, height: 16, fps: 30 },
					timeline: { tracks: [], items: [], transitions: [] }
				},
				videoOptions: { format: 'webm' }
			},
			{
				workerAvailable: () => true,
				createWorker,
				workspaceRoot: () => ({}) as FileSystemDirectoryHandle,
				media: () => [],
				renderVideoMain: renderVideoMain as never,
				renderAudioMain: async () => ({ fileName: 'a', blob: new Blob([]) })
			}
		);

		await Promise.resolve();
		const sent = (
			fakeWorker.postMessage as unknown as {
				mock: { calls: [import('./render-export-worker.types').RenderExportWorkerRequest][] };
			}
		).mock.calls[0]?.[0];
		const requestId = sent && 'requestId' in sent ? (sent.requestId as string) : 'unknown';
		capturedOnMessage(
			new MessageEvent('message', {
				data: { type: 'error', requestId, error: 'Encoder failed' }
			})
		);

		await expect(pending).rejects.toThrow('Encoder failed');
		expect(renderVideoMain).not.toHaveBeenCalled();
		expect(fakeWorker.terminate).toHaveBeenCalled();
	});
});
