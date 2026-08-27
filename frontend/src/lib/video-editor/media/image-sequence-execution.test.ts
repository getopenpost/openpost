import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Project } from '../project/types';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { mediaPool } from './pool.svelte';
import type { RenderExecutionDependencies, RenderWorkerPort } from './render-execution';
import { renderImageSequenceExport } from './render-execution';
import type { RenderExportWorkerRequest, RenderExportWorkerResponse } from './render-export-worker.types';

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
	const getDirectoryHandle = async (name: string, opts?: { create?: boolean }): Promise<FileSystemDirectoryHandle> => {
		if (!dirs.has(name)) {
			if (!opts?.create) throw new DOMException('Not found', 'NotFoundError');
			const sub = createSyncRoot();
			Object.defineProperty(sub, 'name', { value: name });
			dirs.set(name, sub);
		}
		return dirs.get(name)!;
	};
	const getFileHandle = async (name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> => {
		if (!files.has(name) && !opts?.create) throw new DOMException('Not found', 'NotFoundError');
		if (!files.has(name) && opts?.create) files.set(name, new Blob([]));
		return {
			kind: 'file',
			name,
			getFile: async () => new File([files.get(name)!], name),
			createWritable: async () => {
				let blob = files.get(name) ?? new Blob([]);
				return {
					write: async (data: Blob | string | ArrayBuffer | Uint8Array) => {
						if (data instanceof Blob) blob = data;
						else if (typeof data === 'string') blob = new Blob([data]);
						else if (data instanceof ArrayBuffer) blob = new Blob([data]);
						else blob = new Blob([data as Uint8Array<ArrayBuffer>]);
						files.set(name, blob);
					},
					close: async () => {
						files.set(name, blob);
					},
					abort: async () => {}
				} as unknown as FileSystemWritableFileStream;
			}
		} as unknown as FileSystemFileHandle;
	};
	async function* entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		for (const [n, h] of dirs.entries()) yield [n, h as unknown as FileSystemHandle];
		for (const [n, b] of files.entries()) yield [n, { kind: 'file', name: n, getFile: async () => new File([b], n) } as unknown as FileSystemHandle];
	}
	return {
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
	} as unknown as FileSystemDirectoryHandle;
}

function deps(worker: FakeWorker, overrides: Partial<RenderExecutionDependencies> = {}): RenderExecutionDependencies {
	const root = createSyncRoot();
	return {
		workerAvailable: () => true,
		createWorker: () => worker as unknown as RenderWorkerPort,
		workspaceRoot: () => root,
		media: () => [],
		renderVideoMain: vi.fn(async () => ({ fileName: 'x', blob: new Blob([]) }) as never),
		renderAudioMain: vi.fn(async () => ({ fileName: 'x', blob: new Blob([]) }) as never),
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
	it('uses worker batches and writes on main thread without calling fallback', async () => {
		const worker = new FakeWorker((w, msg) => {
			if (msg.type !== 'start') return;
			queueMicrotask(() => {
				w.send({
					type: 'sequence-batch',
					requestId: msg.requestId,
					frames: [
						{ index: 0, frameNumber: 0, fileName: 'Seq Project_00001.png', blob: new Blob(['a'], { type: 'image/png' }) },
						{ index: 1, frameNumber: 1, fileName: 'Seq Project_00002.png', blob: new Blob(['b'], { type: 'image/png' }) }
					]
				});
				w.send({ type: 'sequence-complete', requestId: msg.requestId, frameCount: 2, totalBytes: 2 });
			});
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
		expect(worker.terminated).toBe(true);
	});

	it('falls back to main thread only for explicit worker limitation and never retries render errors', async () => {
		const worker = new FakeWorker((w, msg) => {
			if (msg.type !== 'start') return;
			queueMicrotask(() => w.send({ type: 'error', requestId: msg.requestId, error: 'WORKER_REQUIRES_MAIN_THREAD:dom-dependency' }));
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
			queueMicrotask(() => w.send({ type: 'error', requestId: msg.requestId, error: 'Encoder failed' }));
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

	it('WebP worker parity and honest error when unsupported', async () => {
		const worker = new FakeWorker((w, msg) => {
			if (msg.type !== 'start') return;
			queueMicrotask(() => {
				if (msg.options.format === 'webp') {
					w.send({ type: 'error', requestId: msg.requestId, error: 'WebP encoding is not supported in this browser. Choose PNG or JPEG.' });
				} else {
					w.send({ type: 'sequence-complete', requestId: msg.requestId, frameCount: 0, totalBytes: 0 });
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
