/**
 * PNG/JPEG frame-sequence export: exact frame numbers, FPS, dimensions,
 * color/alpha, effects/transitions/compositions preserved via the same
 * TimelineFrameRenderer full-quality path used for video.
 *
 * Bounded memory: frames are emitted one-by-one (or in small batches from a
 * worker) and written incrementally on the main thread. No bulk retention.
 */

import { TimelineFrameRenderer } from './render-export';
import type { Project } from '../project/types';
import type { RenderExportProgress } from './render-export';
import { outputDurationFrames } from './render-plan';
import { sanitizeWorkspaceFileName } from '../workspace-fs/paths';
import { writeBlob, removeEntry, exists, listDirectory } from '../workspace-fs/fs-primitives';
import { projectExportsDir } from '../workspace-fs/paths';
import { requireWorkspaceRoot, getWorkspaceRoot } from '../workspace-fs/root';
import { withKeyLock } from '../workspace-fs/with-key-lock';

export type ImageSequenceFormat = 'png' | 'jpeg' | 'webp';

/**
 * Alpha semantics:
 * - PNG: lossless, preserves full alpha channel. Background is transparent when
 *   preserveAlpha is true (transparent clear). No quality parameter.
 * - JPEG: lossy, no alpha. Always flattened to opaque backgroundColor
 *   (project background or #000). Quality 0-1 via jpegQuality.
 * - WebP: lossy/lossless with alpha support. When preserveAlpha is true,
 *   transparent regions are preserved using WebP alpha. Quality 0-1 controls
 *   lossy compression (alpha remains). Falls back with honest error if the
 *   browser cannot encode image/webp.
 */

export interface ImageSequenceExportOptions {
	format: ImageSequenceFormat;
	width?: number;
	height?: number;
	range?: { startFrame: number; endFrame: number };
	jpegQuality?: number;
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

export interface ImageSequenceFrame {
	index: number;
	frameNumber: number;
	fileName: string;
	blob: Blob;
}

export interface ImageSequenceWorkspaceResult {
	kind: 'workspace-directory';
	directoryName: string;
	relPath: string;
	frameCount: number;
	totalBytes: number;
}

export interface ImageSequenceZipResult {
	kind: 'zip';
	fileName: string;
	relPath: string | null;
	blob: Blob;
	frameCount: number;
	totalBytes: number;
	savedToWorkspace: boolean;
}

export interface ImageSequenceDirectoryHandleResult {
	kind: 'directory-handle';
	directoryName: string;
	frameCount: number;
	totalBytes: number;
}

export type ImageSequenceResult =
	| ImageSequenceWorkspaceResult
	| ImageSequenceZipResult
	| ImageSequenceDirectoryHandleResult;

export const IMAGE_SEQUENCE_BATCH_SIZE = 8;
export const ZIP_MAX_FRAMES = 2500;
export const ZIP_MAX_ESTIMATED_BYTES = 500 * 1024 * 1024;

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function report(
	options: Pick<ImageSequenceExportOptions, 'onProgress'>,
	phase: RenderExportProgress['phase'],
	framesDone: number,
	totalFrames: number
): void {
	options.onProgress?.({
		phase,
		framesDone,
		totalFrames,
		progress: totalFrames > 0 ? framesDone / totalFrames : 0
	});
}

export function sanitizeSequenceBaseName(projectName: string): string {
	const sanitized = sanitizeWorkspaceFileName(projectName);
	const base = sanitized.replace(/\.[^.]+$/, '');
	if (!base || base === 'source' || base === 'source.bin') return 'sequence';
	return base;
}

export function formatSequenceFileName(
	baseName: string,
	index: number,
	totalFrames: number,
	format: ImageSequenceFormat
): string {
	const pad = Math.max(5, String(totalFrames).length);
	const ext = format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
	return `${baseName}_${String(index + 1).padStart(pad, '0')}.${ext}`;
}

export function estimateSequenceBytes(
	format: ImageSequenceFormat,
	width: number,
	height: number,
	frameCount: number
): number {
	const bytesPerPixel = format === 'png' ? 0.55 : format === 'webp' ? 0.28 : 0.18;
	return Math.ceil(width * height * bytesPerPixel * frameCount);
}

export function resolveSequenceRange(project: Project, range: ImageSequenceExportOptions['range']) {
	const full = outputDurationFrames(project.timeline?.items ?? []);
	const startFrame = Math.max(0, Math.floor(range?.startFrame ?? 0));
	const endFrame = Math.min(full, Math.ceil(range?.endFrame ?? full));
	const totalFrames = Math.max(0, endFrame - startFrame);
	return { startFrame, endFrame, totalFrames };
}

export function isZipFallbackSafe(
	format: ImageSequenceFormat,
	width: number,
	height: number,
	frameCount: number
): boolean {
	if (frameCount > ZIP_MAX_FRAMES) return false;
	return estimateSequenceBytes(format, width, height, frameCount) <= ZIP_MAX_ESTIMATED_BYTES;
}

/** Allocate a unique owned directory for one export, never colliding with prior exports. */
export async function allocateUniqueWorkspaceSequenceDirectory(
	root: FileSystemDirectoryHandle,
	projectId: string,
	baseName: string
): Promise<{ dirName: string; dirSegments: string[] }> {
	const lockKey = `sequence-dir:${projectId}:${baseName}`;
	return withKeyLock(lockKey, async () => {
		const baseSegments = projectExportsDir(projectId);
		const candidate = `${baseName}__${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
		const dirSegments = [...baseSegments, candidate];
		let dir: FileSystemDirectoryHandle = root;
		for (const seg of dirSegments) {
			dir = await dir.getDirectoryHandle(seg, { create: true });
		}
		return { dirName: candidate, dirSegments };
	});
}

export async function allocateUniqueSequenceSubdirectory(
	parent: FileSystemDirectoryHandle,
	baseName: string
): Promise<{ directoryName: string; directoryHandle: FileSystemDirectoryHandle }> {
	return withKeyLock(`sequence-picked-dir:${parent.name}:${baseName}`, async () => {
		const directoryName = `${baseName}__${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
		const directoryHandle = await parent.getDirectoryHandle(directoryName, { create: true });
		return { directoryName, directoryHandle };
	});
}

async function writeUniqueWorkspaceSequenceZip(
	root: FileSystemDirectoryHandle,
	projectId: string,
	baseName: string,
	blob: Blob
): Promise<{ fileName: string; relPath: string }> {
	return withKeyLock(`sequence-zip:${projectId}:${baseName}`, async () => {
		const exportSegments = projectExportsDir(projectId);
		let fileName = `${baseName}.zip`;
		while (await exists(root, [...exportSegments, fileName])) {
			fileName = `${baseName}__${Date.now()}-${crypto.randomUUID().slice(0, 8)}.zip`;
		}
		await writeBlob(root, [...exportSegments, fileName], blob);
		return {
			fileName,
			relPath: `projects/${projectId}/exports/${fileName}`
		};
	});
}

/** Explicit WebP encoding capability probe. Never silent-falls back. */
export async function canEncodeWebP(): Promise<boolean> {
	try {
		if (typeof OffscreenCanvas === 'undefined') return false;
		const canvas = new OffscreenCanvas(1, 1);
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		ctx.fillStyle = 'rgba(0,0,0,0)';
		ctx.fillRect(0, 0, 1, 1);
		const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
		return blob.type === 'image/webp';
	} catch {
		return false;
	}
}

export async function canEncodeImageSequenceFormat(format: ImageSequenceFormat): Promise<boolean> {
	if (format === 'png' || format === 'jpeg') return true;
	if (format === 'webp') return canEncodeWebP();
	return false;
}

export async function* renderImageSequenceFrames(
	project: Project,
	options: ImageSequenceExportOptions
): AsyncGenerator<ImageSequenceFrame> {
	const fps = project.metadata.fps;
	if (!Number.isFinite(fps) || fps <= 0) throw new Error('Project FPS is invalid.');
	if (options.format === 'webp' && !(await canEncodeWebP())) {
		throw new Error('WebP encoding is not supported in this browser. Choose PNG or JPEG.');
	}
	const width = options.width ?? project.metadata.width;
	const height = options.height ?? project.metadata.height;
	const { startFrame, endFrame, totalFrames } = resolveSequenceRange(project, options.range);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');
	if ((project.timeline?.items ?? []).length === 0)
		throw new Error('This timeline has nothing to render.');
	const baseName = sanitizeSequenceBaseName(project.name);

	report(options, 'preparing', 0, totalFrames);
	const preserveAlpha = options.format === 'png' || options.format === 'webp';
	const renderProject: Project = preserveAlpha
		? {
				...project,
				metadata: { ...project.metadata, width, height }
			}
		: project;

	const renderer = new TimelineFrameRenderer(renderProject, {
		width,
		height,
		backgroundColor: preserveAlpha ? null : (project.metadata.backgroundColor ?? '#000000'),
		burnSubtitles: true
	});

	try {
		report(options, 'rendering', 0, totalFrames);
		for (let offset = 0; offset < totalFrames; offset++) {
			throwIfAborted(options.signal);
			const frameNumber = startFrame + offset;
			const fileName = formatSequenceFileName(baseName, offset, totalFrames, options.format);
			const canvas = await renderer.render(frameNumber);
			const type =
				options.format === 'png'
					? 'image/png'
					: options.format === 'webp'
						? 'image/webp'
						: 'image/jpeg';
			const quality =
				options.format === 'jpeg' || options.format === 'webp'
					? (options.jpegQuality ?? 0.92)
					: undefined;
			const blob = await canvas.convertToBlob(quality !== undefined ? { type, quality } : { type });
			if (!blob || blob.size === 0) throw new Error(`Frame ${frameNumber} produced no data.`);
			const expectedType = type;
			if (blob.type !== expectedType) {
				throw new Error(
					`Frame ${frameNumber} produced unexpected type ${blob.type}. WebP may be unsupported in this browser; no silent fallback was performed.`
				);
			}
			yield { index: offset, frameNumber, fileName, blob };
			report(options, 'rendering', offset + 1, totalFrames);
		}
		report(options, 'finalizing', totalFrames, totalFrames);
	} finally {
		renderer.dispose();
	}
}

/** Main-thread workspace writer: streams frames into projects/{id}/exports/{baseName}/ */
export async function renderImageSequenceToWorkspace(
	project: Project,
	options: ImageSequenceExportOptions
): Promise<ImageSequenceWorkspaceResult> {
	const width = options.width ?? project.metadata.width;
	const height = options.height ?? project.metadata.height;
	const { totalFrames } = resolveSequenceRange(project, options.range);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');
	const baseName = sanitizeSequenceBaseName(project.name);
	const root = requireWorkspaceRoot();
	const { dirName, dirSegments } = await allocateUniqueWorkspaceSequenceDirectory(
		root,
		project.id,
		baseName
	);
	let written = 0;
	let totalBytes = 0;
	const writtenFiles: string[] = [];
	try {
		for await (const frame of renderImageSequenceFrames(project, options)) {
			throwIfAborted(options.signal);
			const segments = [...dirSegments, frame.fileName];
			await writeBlob(root, segments, frame.blob);
			writtenFiles.push(frame.fileName);
			written += 1;
			totalBytes += frame.blob.size;
		}
		const relPath = `projects/${project.id}/exports/${dirName}`;
		return {
			kind: 'workspace-directory',
			directoryName: dirName,
			relPath,
			frameCount: written,
			totalBytes
		};
	} catch (error) {
		for (const fileName of writtenFiles) {
			try {
				await removeEntry(root, [...dirSegments, fileName]);
			} catch {
				// Cleanup is best-effort; the unique directory cannot contain an older export.
			}
		}
		try {
			const entries = await listDirectory(root, dirSegments);
			if (entries.length === 0) await removeEntry(root, dirSegments);
		} catch {
			// A failed empty-directory cleanup does not hide the original render error.
		}
		throw error;
	}
}

/** Directory-handle writer when File System Access is available */
export async function renderImageSequenceToDirectoryHandle(
	destinationHandle: FileSystemDirectoryHandle,
	project: Project,
	options: ImageSequenceExportOptions
): Promise<ImageSequenceDirectoryHandleResult> {
	const { totalFrames } = resolveSequenceRange(project, options.range);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');
	const allocated = await allocateUniqueSequenceSubdirectory(
		destinationHandle,
		sanitizeSequenceBaseName(project.name)
	);
	const directoryHandle = allocated.directoryHandle;
	let written = 0;
	let totalBytes = 0;
	const createdFiles: string[] = [];
	try {
		for await (const frame of renderImageSequenceFrames(project, options)) {
			throwIfAborted(options.signal);
			const fileHandle = await directoryHandle.getFileHandle(frame.fileName, { create: true });
			const writable = await fileHandle.createWritable();
			try {
				await writable.write(frame.blob);
				await writable.close();
			} catch (error) {
				try {
					await writable.abort();
				} catch {
					// ignore abort error
				}
				throw error;
			}
			createdFiles.push(frame.fileName);
			written += 1;
			totalBytes += frame.blob.size;
		}
		return {
			kind: 'directory-handle',
			directoryName: allocated.directoryName,
			frameCount: written,
			totalBytes
		};
	} catch (error) {
		for (const fileName of createdFiles) {
			try {
				await directoryHandle.removeEntry(fileName);
			} catch {
				// Cleanup is best-effort; the unique directory cannot contain older output.
			}
		}
		try {
			await destinationHandle.removeEntry(allocated.directoryName);
		} catch {
			// Keep the original render error when the empty directory cannot be removed.
		}
		throw error;
	}
}

/** Bounded ZIP fallback */
export async function renderImageSequenceZip(
	project: Project,
	options: ImageSequenceExportOptions
): Promise<ImageSequenceZipResult> {
	const width = options.width ?? project.metadata.width;
	const height = options.height ?? project.metadata.height;
	const { totalFrames } = resolveSequenceRange(project, options.range);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');
	if (!isZipFallbackSafe(options.format, width, height, totalFrames)) {
		throw new Error('ZIP fallback exceeds safe bounds. Choose a directory export.');
	}
	const baseName = sanitizeSequenceBaseName(project.name);
	const entries: Record<string, Uint8Array> = {};
	let totalBytes = 0;
	report(options, 'preparing', 0, totalFrames);
	for await (const frame of renderImageSequenceFrames(project, options)) {
		throwIfAborted(options.signal);
		entries[frame.fileName] = new Uint8Array(await frame.blob.arrayBuffer());
		totalBytes += entries[frame.fileName]!.length;
		report(options, 'encoding', frame.index + 1, totalFrames);
		if (totalBytes > ZIP_MAX_ESTIMATED_BYTES) {
			throw new Error('ZIP fallback exceeds safe size during collection.');
		}
	}
	report(options, 'finalizing', totalFrames, totalFrames);
	const { zipSync } = await import('fflate');
	const zipped = zipSync(entries, { level: 0 });
	const blob = new Blob([zipped.buffer], { type: 'application/zip' });
	let fileName = `${baseName}.zip`;
	let savedToWorkspace = false;
	let relPath: string | null = null;
	const root = getWorkspaceRoot();
	if (root) {
		try {
			const saved = await writeUniqueWorkspaceSequenceZip(root, project.id, baseName, blob);
			fileName = saved.fileName;
			savedToWorkspace = true;
			relPath = saved.relPath;
		} catch {
			savedToWorkspace = false;
			relPath = null;
		}
	} else {
		savedToWorkspace = false;
		relPath = null;
	}
	return {
		kind: 'zip',
		fileName,
		relPath,
		blob,
		frameCount: totalFrames,
		totalBytes: blob.size,
		savedToWorkspace
	};
}

export function getDirectoryPickerAvailable(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickSequenceDirectory(): Promise<FileSystemDirectoryHandle | null> {
	if (!getDirectoryPickerAvailable()) return null;
	try {
		return await window.showDirectoryPicker();
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return null;
	}
}
