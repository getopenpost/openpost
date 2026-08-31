import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Project } from '../project/types';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { mediaPool } from './pool.svelte';
import type { RenderExecutionDependencies, RenderWorkerPort } from './render-execution';
import { renderImageSequenceExport } from './render-execution';
import type {
	RenderExportWorkerRequest,
	RenderExportWorkerResponse
} from './render-export-worker.types';

const LAZY_IMAGE_SEQUENCE_LOAD_TIMEOUT_MS = 30_000;

function asWritableStream(
	stub: Partial<FileSystemWritableFileStream>
): FileSystemWritableFileStream {
	// SAFETY: tests only call the write, close, and abort methods supplied by this in-memory stub.
	return stub as FileSystemWritableFileStream;
}

function asFileHandle(stub: Partial<FileSystemFileHandle>): FileSystemFileHandle {
	// SAFETY: tests only call the file-handle methods supplied by this in-memory stub.
	return stub as FileSystemFileHandle;
}

function asDirectoryHandle(stub: Partial<FileSystemDirectoryHandle>): FileSystemDirectoryHandle {
	// SAFETY: tests only call the directory-handle methods supplied by this in-memory stub.
	return stub as FileSystemDirectoryHandle;
}

function asFileSystemHandle(stub: Pick<FileSystemHandle, 'kind' | 'name'>): FileSystemHandle {
	// SAFETY: directory listings in these tests only inspect kind and name.
	return stub as FileSystemHandle;
}

function asWorkerPort(worker: FakeWorker): RenderWorkerPort {
	// SAFETY: FakeWorker implements the EventTarget, postMessage, and terminate worker-port contract.
	return worker as RenderWorkerPort;
}

const project: Project = {
	id: 'seq-proj',
	name: 'Seq Project',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 2 / 30,
	metadata: { width: 16, height: 16, fps: 30 },
	timeline: {
		tracks: [
			{
				id: 't',
				name: 'Video',
				kind: 'video',
				height: 64,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				order: 0
			}
		],
		items: [
			{
				id: 's',
				trackId: 't',
				from: 0,
				durationInFrames: 2,
				label: 'S',
				type: 'shape',
				shapeType: 'rectangle',
				fillEnabled: true,
				fillColor: '#ff0000',
				transform: { width: 16, height: 16 }
			}
		]
	}
};

class FakeWorker extends EventTarget {
	messages: RenderExportWorkerRequest[] = [];
	terminated = false;
	constructor(private readonly respond?: (w: FakeWorker, m: RenderExportWorkerRequest) => void) {
		super();
	}
	postMessage(message: RenderExportWorkerRequest): void {
		this.messages.push(message);
		this.respond?.(this, message);
	}
	send(message: RenderExportWorkerResponse): void {
		this.dispatchEvent(new MessageEvent('message', { data: message }));
	}
	terminate(): void {
		this.terminated = true;
	}
}

function createSyncRoot(): FileSystemDirectoryHandle {
	const files = new Map<string, Blob>();
	const dirs = new Map<string, FileSystemDirectoryHandle>();
	const getDirectoryHandle = async (
		name: string,
		opts?: { create?: boolean }
	): Promise<FileSystemDirectoryHandle> => {
		if (!dirs.has(name)) {
			if (!opts?.create) throw new DOMException('Not found', 'NotFoundError');
			const sub = createSyncRoot();
			Object.defineProperty(sub, 'name', { value: name });
			dirs.set(name, sub);
		}
		return dirs.get(name)!;
	};
	const getFileHandle = async (
		name: string,
		opts?: { create?: boolean }
	): Promise<FileSystemFileHandle> => {
		if (!files.has(name) && !opts?.create) throw new DOMException('Not found', 'NotFoundError');
		if (!files.has(name) && opts?.create) files.set(name, new Blob([]));
		return asFileHandle({
			kind: 'file',
			name,
			getFile: async () => new File([files.get(name)!], name),
			createWritable: async () => {
				let blob = files.get(name) ?? new Blob([]);
				return asWritableStream({
					write: async (data: Blob | string | ArrayBuffer | Uint8Array) => {
						if (data instanceof Blob) blob = data;
						else blob = new Blob([data]);
						files.set(name, blob);
					},
					close: async () => {
						files.set(name, blob);
					},
					abort: async () => {}
				});
			}
		});
	};
	async function* entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		for (const [n, h] of dirs.entries()) yield [n, h];
		for (const [n, b] of files.entries())
			yield [
				n,
				asFileSystemHandle({
					kind: 'file',
					name: n
				})
			];
	}
	return asDirectoryHandle({
		kind: 'directory',
		name: 'root',
		getDirectoryHandle,
		getFileHandle,
		entries,
		removeEntry: async (name: string) => {
			files.delete(name);
			dirs.delete(name);
		},
		values: async function* () {
			for await (const [, h] of entries()) yield h;
		}
	});
}

function deps(
	worker: FakeWorker,
	overrides: Partial<RenderExecutionDependencies> = {}
): RenderExecutionDependencies {
	const root = createSyncRoot();
	return {
		workerAvailable: () => true,
		createWorker: () => asWorkerPort(worker),
		workspaceRoot: () => root,
		media: () => [],
		renderVideoMain: vi.fn(async () => ({ fileName: 'x', blob: new Blob([]) })),
		renderAudioMain: vi.fn(async () => ({ fileName: 'x', blob: new Blob([]) })),
		renderImageSequenceMain: vi.fn(async () => ({
			kind: 'workspace-directory',
			directoryName: 'Seq Project',
			relPath: 'projects/seq-proj/exports/Seq Project',
			frameCount: 2,
			totalBytes: 100
		})),
		...overrides
	};
}

afterEach(() => {
	mediaPool.clear();
	setWorkspaceRoot(null);
});

describe('image sequence worker/main ownership', () => {
	it(
		'uses worker batches and writes on main thread without calling fallback',
		{ timeout: LAZY_IMAGE_SEQUENCE_LOAD_TIMEOUT_MS },
		async () => {
			const worker = new FakeWorker((w, msg) => {
				if (msg.type === 'start') {
					queueMicrotask(() =>
						w.send({
							type: 'sequence-batch',
							requestId: msg.requestId,
							batchId: 0,
							frames: [
								{
									index: 0,
									frameNumber: 0,
									fileName: 'Seq Project_00001.png',
									blob: new Blob(['a'], { type: 'image/png' })
								},
								{
									index: 1,
									frameNumber: 1,
									fileName: 'Seq Project_00002.png',
									blob: new Blob(['b'], { type: 'image/png' })
								}
							]
						})
					);
					return;
				}
				if (msg.type === 'sequence-batch-ack') {
					queueMicrotask(() =>
						w.send({
							type: 'sequence-complete',
							requestId: msg.requestId,
							frameCount: 2,
							totalBytes: 2
						})
					);
				}
			});
			const d = deps(worker);
			const outcome = await renderImageSequenceExport(
				{
					project,
					options: { format: 'png', width: 16, height: 16, range: { startFrame: 0, endFrame: 2 } }
				},
				d
			);
			expect(outcome.renderPath).toBe('worker');
			expect(outcome.result.kind).toBe('workspace-directory');
			expect(d.renderImageSequenceMain).not.toHaveBeenCalled();
			expect(worker.messages.some((message) => message.type === 'sequence-batch-ack')).toBe(true);
			expect(worker.terminated).toBe(true);
		}
	);

	it('falls back to main thread only for explicit worker limitation and never retries render errors', async () => {
		const worker = new FakeWorker((w, msg) => {
			if (msg.type !== 'start') return;
			queueMicrotask(() =>
				w.send({
					type: 'error',
					requestId: msg.requestId,
					error: 'WORKER_REQUIRES_MAIN_THREAD:dom-dependency'
				})
			);
		});
		const renderMain = vi.fn(async () => ({
			kind: 'workspace-directory' as const,
			directoryName: 'Seq Project',
			relPath: 'projects/seq-proj/exports/Seq Project',
			frameCount: 2,
			totalBytes: 2
		}));
		const d = deps(worker, { renderImageSequenceMain: renderMain });
		const outcome = await renderImageSequenceExport(
			{ project, options: { format: 'png', width: 16, height: 16 } },
			d
		);
		expect(outcome.renderPath).toBe('main-thread');
		expect(outcome.fallbackReason).toMatch(/WORKER_REQUIRES_MAIN_THREAD/);
		expect(renderMain).toHaveBeenCalledOnce();

		const failingWorker = new FakeWorker((w, msg) => {
			if (msg.type !== 'start') return;
			queueMicrotask(() =>
				w.send({ type: 'error', requestId: msg.requestId, error: 'Encoder failed' })
			);
		});
		const failingMain = vi.fn(async () => ({
			kind: 'workspace-directory' as const,
			directoryName: 'Seq Project',
			relPath: 'projects/seq-proj/exports/Seq Project',
			frameCount: 2,
			totalBytes: 2
		}));
		const d2 = deps(failingWorker, { renderImageSequenceMain: failingMain });
		await expect(
			renderImageSequenceExport({ project, options: { format: 'png', width: 16, height: 16 } }, d2)
		).rejects.toThrow('Encoder failed');
		expect(failingMain).not.toHaveBeenCalled();
	});

	it('cancels worker and cleans up on abort', async () => {
		const worker = new FakeWorker(() => {});
		const controller = new AbortController();
		const pending = renderImageSequenceExport(
			{ project, options: { format: 'png', width: 16, height: 16 }, signal: controller.signal },
			deps(worker)
		);
		controller.abort();
		await expect(pending).rejects.toThrow(/Abort|Cancelled|Render cancelled/);
		expect(worker.terminated).toBe(true);
	});

	it('rejects an oversized worker batch without falling back to a second render', async () => {
		const worker = new FakeWorker((current, message) => {
			if (message.type !== 'start') return;
			queueMicrotask(() =>
				current.send({
					type: 'sequence-batch',
					requestId: message.requestId,
					batchId: 0,
					frames: Array.from({ length: 9 }, (_, index) => ({
						index,
						frameNumber: index,
						fileName: `frame-${index}.png`,
						blob: new Blob([String(index)], { type: 'image/png' })
					}))
				})
			);
		});
		const d = deps(worker);
		await expect(
			renderImageSequenceExport({ project, options: { format: 'png', width: 16, height: 16 } }, d)
		).rejects.toThrow('Invalid image-sequence batch size: 9');
		expect(d.renderImageSequenceMain).not.toHaveBeenCalled();
		expect(worker.messages.some((message) => message.type === 'cancel')).toBe(true);
		expect(worker.terminated).toBe(true);
	});

	it('rejects a second batch before acknowledging the active write', async () => {
		const worker = new FakeWorker((current, message) => {
			if (message.type !== 'start') return;
			queueMicrotask(() => {
				const frame = {
					index: 0,
					frameNumber: 0,
					fileName: 'frame-0.png',
					blob: new Blob(['frame'], { type: 'image/png' })
				};
				current.send({
					type: 'sequence-batch',
					requestId: message.requestId,
					batchId: 0,
					frames: [frame]
				});
				current.send({
					type: 'sequence-batch',
					requestId: message.requestId,
					batchId: 1,
					frames: [{ ...frame, index: 1, frameNumber: 1, fileName: 'frame-1.png' }]
				});
			});
		});
		const d = deps(worker);
		await expect(
			renderImageSequenceExport({ project, options: { format: 'png', width: 16, height: 16 } }, d)
		).rejects.toThrow('Image-sequence worker sent an out-of-order batch.');
		expect(d.renderImageSequenceMain).not.toHaveBeenCalled();
		expect(worker.terminated).toBe(true);
	});

	it('terminates the worker and rejects when output allocation fails', async () => {
		const worker = new FakeWorker();
		const deniedRoot = asDirectoryHandle({
			kind: 'directory',
			name: 'denied',
			getDirectoryHandle: vi.fn(async () => {
				throw new DOMException('Denied', 'NotAllowedError');
			})
		});
		const d = deps(worker, { workspaceRoot: () => deniedRoot });
		await expect(
			renderImageSequenceExport({ project, options: { format: 'png', width: 16, height: 16 } }, d)
		).rejects.toMatchObject({ name: 'NotAllowedError' });
		expect(worker.terminated).toBe(true);
		expect(d.renderImageSequenceMain).not.toHaveBeenCalled();
	});

	it('WebP worker parity and honest error when unsupported', async () => {
		const worker = new FakeWorker((w, msg) => {
			if (msg.type !== 'start') return;
			queueMicrotask(() => {
				if (msg.options.format === 'webp') {
					w.send({
						type: 'error',
						requestId: msg.requestId,
						error: 'WebP encoding is not supported in this browser. Choose PNG or JPEG.'
					});
				} else {
					w.send({
						type: 'sequence-complete',
						requestId: msg.requestId,
						frameCount: 0,
						totalBytes: 0
					});
				}
			});
		});
		const d = deps(worker);
		await expect(
			renderImageSequenceExport({ project, options: { format: 'webp', width: 16, height: 16 } }, d)
		).rejects.toThrow(/WebP encoding is not supported/);
		expect(d.renderImageSequenceMain).not.toHaveBeenCalled();
	});
});
