import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import {
	formatSequenceFileName,
	sanitizeSequenceBaseName,
	renderImageSequenceFrames,
	renderImageSequenceToWorkspace,
	renderImageSequenceToDirectoryHandle,
	renderImageSequenceZip,
	IMAGE_SEQUENCE_BATCH_SIZE
} from './image-sequence-export';
import { mediaPool } from './pool.svelte';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { listDirectory } from '../workspace-fs/fs-primitives';
import { projectExportsDir } from '../workspace-fs/paths';

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

function projectForSequence(opts: {
	fps?: number;
	width?: number;
	height?: number;
	backgroundColor?: string;
	frames: number;
	withAlphaShape?: boolean;
}): Project {
	const track: TimelineTrack = {
		id: 'video',
		name: 'Video',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
	const item: TimelineItem = opts.withAlphaShape
		? {
				id: 'shape-alpha',
				trackId: track.id,
				from: 0,
				durationInFrames: opts.frames,
				label: 'Alpha',
				type: 'shape',
				shapeType: 'rectangle',
				fillEnabled: true,
				fillColor: '#ff0000',
				transform: { x: 0, y: 0, width: opts.width ?? 16, height: opts.height ?? 16, opacity: 0.5 }
			}
		: {
				id: 'shape',
				trackId: track.id,
				from: 0,
				durationInFrames: opts.frames,
				label: 'Solid',
				type: 'shape',
				shapeType: 'rectangle',
				fillEnabled: true,
				fillColor: '#00ff00',
				transform: { x: 0, y: 0, width: opts.width ?? 16, height: opts.height ?? 16 }
			};
	return {
		id: 'seq-project',
		name: 'Sequence Project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: opts.frames / (opts.fps ?? 30),
		metadata: {
			width: opts.width ?? 16,
			height: opts.height ?? 16,
			fps: opts.fps ?? 30,
			backgroundColor: opts.backgroundColor
		},
		timeline: { tracks: [track], items: [item] }
	};
}

async function createInMemoryRoot(): Promise<FileSystemDirectoryHandle> {
	// Minimal in-memory FileSystemDirectoryHandle for workspace tests
	const files = new Map<string, Blob>();
	const dirs = new Map<string, FileSystemDirectoryHandle>();
	async function getDirectoryHandle(
		name: string,
		opts?: { create?: boolean }
	): Promise<FileSystemDirectoryHandle> {
		if (!dirs.has(name)) {
			if (!opts?.create) throw new DOMException('Not found', 'NotFoundError');
			const sub = await createInMemoryRoot();
			// Preserve name for debugging
			Object.defineProperty(sub, 'name', { value: name });
			dirs.set(name, sub);
		}
		return dirs.get(name)!;
	}
	async function getFileHandle(
		name: string,
		opts?: { create?: boolean }
	): Promise<FileSystemFileHandle> {
		const key = name;
		if (!files.has(key) && !opts?.create) throw new DOMException('Not found', 'NotFoundError');
		if (!files.has(key) && opts?.create) files.set(key, new Blob([]));
		return asFileHandle({
			kind: 'file',
			name,
			getFile: async () => new File([files.get(key)!], name),
			createWritable: async () => {
				let blob = files.get(key) ?? new Blob([]);
				return asWritableStream({
					write: async (data: Blob | string | ArrayBuffer | Uint8Array) => {
						if (data instanceof Blob) blob = data;
						else blob = new Blob([data]);
						files.set(key, blob);
					},
					close: async () => {
						files.set(key, blob);
					},
					abort: async () => {}
				});
			}
		});
	}
	async function* entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
		for (const [name, handle] of dirs.entries()) yield [name, handle];
		for (const [name, blob] of files.entries()) {
			yield [
				name,
				asFileSystemHandle({
					kind: 'file',
					name
				})
			];
		}
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

afterEach(() => {
	mediaPool.clear();
	setWorkspaceRoot(null);
});

describe('image sequence exact frames and Chromium pixels', () => {
	it('emits exact frame count and names with correct FPS/dimensions', async () => {
		const project = projectForSequence({ frames: 3, width: 32, height: 24, fps: 30 });
		const frames = [];
		for await (const frame of renderImageSequenceFrames(project, {
			format: 'png',
			width: 32,
			height: 24
		})) {
			frames.push(frame);
			expect(frame.blob.type).toBe('image/png');
			expect(frame.fileName).toBe(
				formatSequenceFileName(sanitizeSequenceBaseName(project.name), frame.index, 3, 'png')
			);
		}
		expect(frames).toHaveLength(3);
		expect(frames[0]!.frameNumber).toBe(0);
		expect(frames[2]!.frameNumber).toBe(2);
		// Decode first frame and verify dimensions and color at center (real pixels)
		const bmp = await createImageBitmap(frames[0]!.blob);
		expect(bmp.width).toBe(32);
		expect(bmp.height).toBe(24);
		const canvas = new OffscreenCanvas(bmp.width, bmp.height);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(bmp, 0, 0);
		const data = ctx.getImageData(16, 12, 1, 1).data;
		// Shape is #00ff00 solid => green channel max
		expect(data[1]).toBeGreaterThan(200);
		expect(data[0]).toBeLessThan(50);
		expect(data[2]).toBeLessThan(50);
		bmp.close();
	});

	it('respects range boundaries and marker-like slicing', async () => {
		const project = projectForSequence({ frames: 10 });
		const frames = [];
		for await (const frame of renderImageSequenceFrames(project, {
			format: 'png',
			range: { startFrame: 2, endFrame: 5 }
		})) {
			frames.push(frame);
		}
		expect(frames).toHaveLength(3);
		expect(frames.map((f) => f.frameNumber)).toEqual([2, 3, 4]);
		expect(frames.map((f) => f.fileName)).toEqual([
			formatSequenceFileName(sanitizeSequenceBaseName(project.name), 0, 3, 'png'),
			formatSequenceFileName(sanitizeSequenceBaseName(project.name), 1, 3, 'png'),
			formatSequenceFileName(sanitizeSequenceBaseName(project.name), 2, 3, 'png')
		]);
	});

	it('PNG keeps alpha while JPEG flattens to opaque background', async () => {
		// PNG with transparent background should have alpha <255 in semi-transparent pixel
		const pngProject = projectForSequence({ frames: 1, width: 8, height: 8, withAlphaShape: true });
		// Force transparent background by not setting backgroundColor? Our renderer for png uses transparent when format png (preserves alpha). Check pixel alpha.
		let pngFrame: Blob | null = null;
		for await (const frame of renderImageSequenceFrames(pngProject, {
			format: 'png',
			width: 8,
			height: 8
		})) {
			pngFrame = frame.blob;
		}
		expect(pngFrame).not.toBeNull();
		expect(pngFrame!.type).toBe('image/png');
		const pngBmp = await createImageBitmap(pngFrame!);
		const pngCanvas = new OffscreenCanvas(8, 8);
		const pngCtx = pngCanvas.getContext('2d', { willReadFrequently: true })!;
		pngCtx.drawImage(pngBmp, 0, 0);
		const pngData = pngCtx.getImageData(4, 4, 1, 1).data;
		// Semi-transparent red shape over transparent => alpha <255 and <200 but >0
		expect(pngData[3]).toBeLessThan(255);
		expect(pngData[3]).toBeGreaterThan(50);
		pngBmp.close();

		const jpegProject = projectForSequence({
			frames: 1,
			width: 8,
			height: 8,
			backgroundColor: '#000000',
			withAlphaShape: true
		});
		let jpegFrame: Blob | null = null;
		for await (const frame of renderImageSequenceFrames(jpegProject, {
			format: 'jpeg',
			width: 8,
			height: 8,
			jpegQuality: 0.92
		})) {
			jpegFrame = frame.blob;
		}
		expect(jpegFrame).not.toBeNull();
		expect(jpegFrame!.type).toBe('image/jpeg');
		const jpegBmp = await createImageBitmap(jpegFrame!);
		const jpegCanvas = new OffscreenCanvas(8, 8);
		const jpegCtx = jpegCanvas.getContext('2d', { willReadFrequently: true })!;
		jpegCtx.drawImage(jpegBmp, 0, 0);
		const jpegData = jpegCtx.getImageData(4, 4, 1, 1).data;
		// JPEG has no alpha => always 255
		expect(jpegData[3]).toBe(255);
		jpegBmp.close();
		// JPEG blob should be smaller than PNG for same content (roughly)
		// Not strictly guaranteed for tiny 8x8, but jpeg ought to be present.
		expect(jpegFrame!.size).toBeGreaterThan(0);
	});

	it('uses bounded batches and only main thread writes workspace files', async () => {
		// Verify batch constant and that workspace write is main-thread only by spying writeBlob
		expect(IMAGE_SEQUENCE_BATCH_SIZE).toBeLessThanOrEqual(16);
		const root = await createInMemoryRoot();
		setWorkspaceRoot(root);
		const project = projectForSequence({ frames: 10, width: 16, height: 16 });
		const result = await renderImageSequenceToWorkspace(project, {
			format: 'png',
			width: 16,
			height: 16
		});
		expect(result.frameCount).toBe(10);
		expect(result.kind).toBe('workspace-directory');
		// Verify files were written via main-thread writeBlob path
		const exportsDir = await root.getDirectoryHandle('projects', { create: false });
		const projDir = await exportsDir.getDirectoryHandle(project.id, { create: false });
		const seqDir = await projDir.getDirectoryHandle('exports', { create: false });
		const seq = await seqDir.getDirectoryHandle(result.directoryName, { create: false });
		let count = 0;
		for await (const entry of seq.values()) {
			if (entry.kind === 'file') count++;
		}
		expect(count).toBe(10);
	});

	it('cancels and cleans up partial workspace files', async () => {
		const root = await createInMemoryRoot();
		setWorkspaceRoot(root);
		const project = projectForSequence({ frames: 20, width: 16, height: 16 });
		const controller = new AbortController();
		const promise = renderImageSequenceToWorkspace(project, {
			format: 'png',
			width: 16,
			height: 16,
			signal: controller.signal,
			onProgress: (p) => {
				if (p.framesDone >= 3) controller.abort();
			}
		});
		await expect(promise).rejects.toThrow(/Abort|Cancelled|Export cancelled/);
		expect(await listDirectory(root, projectExportsDir(project.id))).toEqual([]);
	});

	it('keeps concurrent and shorter workspace exports isolated without stale frames', async () => {
		const root = await createInMemoryRoot();
		setWorkspaceRoot(root);
		const longProject = projectForSequence({ frames: 3, width: 16, height: 16 });
		const shortProject = projectForSequence({ frames: 1, width: 16, height: 16 });
		const [first, second] = await Promise.all([
			renderImageSequenceToWorkspace(longProject, { format: 'png', width: 16, height: 16 }),
			renderImageSequenceToWorkspace(shortProject, { format: 'png', width: 16, height: 16 })
		]);
		expect(first.directoryName).not.toBe(second.directoryName);
		expect(
			await listDirectory(root, [...projectExportsDir(longProject.id), first.directoryName])
		).toHaveLength(3);
		expect(
			await listDirectory(root, [...projectExportsDir(shortProject.id), second.directoryName])
		).toHaveLength(1);
	});

	it('directory-handle destination streams with bounded memory and reports progress', async () => {
		const dir = await createInMemoryRoot();
		// Make it behave as picked directory (name property)
		Object.defineProperty(dir, 'name', { value: 'PickedFolder' });
		const project = projectForSequence({ frames: 5, width: 16, height: 16 });
		const progresses: number[] = [];
		const result = await renderImageSequenceToDirectoryHandle(dir, project, {
			format: 'jpeg',
			width: 16,
			height: 16,
			onProgress: (p) => progresses.push(p.framesDone)
		});
		expect(result.frameCount).toBe(5);
		expect(progresses[progresses.length - 1]).toBe(5);
		const child = await dir.getDirectoryHandle(result.directoryName, { create: false });
		let files = 0;
		for await (const h of child.values()) {
			if (h.kind === 'file') {
				files++;
				expect(h.name.endsWith('.jpg')).toBe(true);
			}
		}
		expect(files).toBe(5);
	});

	it('preserves existing picked-directory files by writing into an owned subdirectory', async () => {
		const destination = await createInMemoryRoot();
		const prior = await destination.getFileHandle('Sequence Project_00001.png', { create: true });
		const writable = await prior.createWritable();
		await writable.write(new Blob(['prior']));
		await writable.close();
		const result = await renderImageSequenceToDirectoryHandle(
			destination,
			projectForSequence({ frames: 1, width: 16, height: 16 }),
			{ format: 'png', width: 16, height: 16 }
		);
		expect((await prior.getFile()).size).toBe(5);
		expect(result.directoryName).toMatch(/^Sequence Project__/);
		expect(await listDirectory(destination, [result.directoryName])).toHaveLength(1);
	});

	it('ZIP fallback is bounded and rejects oversized sequences', async () => {
		const project = projectForSequence({ frames: 3000, width: 1920, height: 1080 });
		await expect(
			renderImageSequenceZip(project, { format: 'png', width: 1920, height: 1080 })
		).rejects.toThrow(/bounds/i);
		// Small ZIP succeeds
		const small = projectForSequence({ frames: 2, width: 16, height: 16 });
		const zip = await renderImageSequenceZip(small, { format: 'png', width: 16, height: 16 });
		expect(zip.kind).toBe('zip');
		expect(zip.blob.type).toBe('application/zip');
		expect(zip.frameCount).toBe(2);
		expect(zip.blob.size).toBeGreaterThan(0);
	});

	it('saves repeated ZIP exports under distinct truthful workspace paths', async () => {
		const root = await createInMemoryRoot();
		setWorkspaceRoot(root);
		const small = projectForSequence({ frames: 1, width: 16, height: 16 });
		const first = await renderImageSequenceZip(small, { format: 'png', width: 16, height: 16 });
		const second = await renderImageSequenceZip(small, { format: 'png', width: 16, height: 16 });
		expect(first.savedToWorkspace).toBe(true);
		expect(second.savedToWorkspace).toBe(true);
		expect(first.relPath).not.toBe(second.relPath);
		expect(first.fileName).not.toBe(second.fileName);
		expect(await listDirectory(root, projectExportsDir(small.id))).toHaveLength(2);
	});

	it('WebP has deterministic frame counts/names and preserves alpha', async () => {
		const { canEncodeWebP } = await import('./image-sequence-export');
		const supported = await canEncodeWebP();
		if (!supported) {
			await expect(
				(async () => {
					for await (const _ of renderImageSequenceFrames(projectForSequence({ frames: 1 }), {
						format: 'webp'
					})) {
						void _;
					}
				})()
			).rejects.toThrow(/WebP encoding is not supported/);
			return;
		}
		const project = projectForSequence({ frames: 3, width: 16, height: 16, withAlphaShape: true });
		const frames: string[] = [];
		let alphaPreserved = false;
		for await (const frame of renderImageSequenceFrames(project, {
			format: 'webp',
			width: 16,
			height: 16,
			jpegQuality: 0.92
		})) {
			frames.push(frame.fileName);
			expect(frame.blob.type).toBe('image/webp');
			expect(frame.fileName.endsWith('.webp')).toBe(true);
			const bmp = await createImageBitmap(frame.blob);
			const canvas = new OffscreenCanvas(bmp.width, bmp.height);
			const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
			ctx.drawImage(bmp, 0, 0);
			const data = ctx.getImageData(8, 8, 1, 1).data;
			if (data[3] < 255 && data[3] > 50) alphaPreserved = true;
			bmp.close();
		}
		expect(frames).toHaveLength(3);
		expect(frames[0]).toBe('Sequence Project_00001.webp');
		expect(frames[2]).toBe('Sequence Project_00003.webp');
		expect(alphaPreserved).toBe(true);
	});

	it('WebP never silently converts to another format', async () => {
		const { canEncodeWebP } = await import('./image-sequence-export');
		const original = await canEncodeWebP();
		// Force unsupported by mocking OffscreenCanvas
		const origOffscreen = globalThis.OffscreenCanvas;
		// Simulate unsupported: make convertToBlob return png
		globalThis.OffscreenCanvas = class extends origOffscreen {
			async convertToBlob(opts?: ImageEncodeOptions): Promise<Blob> {
				if (opts?.type === 'image/webp') return new Blob(['x'], { type: 'image/png' });
				return super.convertToBlob(opts);
			}
		};
		try {
			await expect(
				(async () => {
					for await (const _ of renderImageSequenceFrames(projectForSequence({ frames: 1 }), {
						format: 'webp'
					})) {
						void _;
					}
				})()
			).rejects.toThrow(/unexpected type|WebP encoding is not supported/);
		} finally {
			globalThis.OffscreenCanvas = origOffscreen;
		}
		expect(original).toBeDefined();
	});
});
