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
import { writeBlob, removeEntry, exists } from '../workspace-fs/fs-primitives';
import { projectExportsDir } from '../workspace-fs/paths';
import { requireWorkspaceRoot, getWorkspaceRoot } from '../workspace-fs/root';

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
	relPath: string;
	blob: Blob;
	frameCount: number;
	totalBytes: number;
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

export function resolveSequenceRange(
	project: Project,
	range: ImageSequenceExportOptions['range']
): { startFrame: number; endFrame: number; totalFrames: number } {
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
	const dirSegments = [...projectExportsDir(project.id), baseName];
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
		const relPath = `projects/${project.id}/exports/${baseName}`;
		return {
			kind: 'workspace-directory',
			directoryName: baseName,
			relPath,
			frameCount: written,
			totalBytes
		};
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			for (const fileName of writtenFiles) {
				try {
					await removeEntry(root, [...dirSegments, fileName]);
				} catch {
					// Cleanup best-effort
				}
			}
			try {
				if (!(await exists(root, dirSegments))) {
					// Already cleaned
				} else {
					const remaining = await exists(root, dirSegments);
					if (remaining && writtenFiles.length > 0) {
						// Leave directory if other files existed previously; don't remove entire dir blindly.
					}
				}
			} catch {
				// Cleanup best-effort
			}
		}
		throw error;
	}
}

/** Directory-handle writer when File System Access is available */
export async function renderImageSequenceToDirectoryHandle(
	directoryHandle: FileSystemDirectoryHandle,
	project: Project,
	options: ImageSequenceExportOptions
): Promise<ImageSequenceDirectoryHandleResult> {
	const { totalFrames } = resolveSequenceRange(project, options.range);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');
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
			directoryName: directoryHandle.name,
			frameCount: written,
			totalBytes
		};
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			for (const fileName of createdFiles) {
				try {
					await directoryHandle.removeEntry(fileName);
				} catch {
					// best-effort cleanup
				}
			}
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
		// Report encoding phase while collecting
		report(options, 'encoding', frame.index + 1, totalFrames);
		if (totalBytes > ZIP_MAX_ESTIMATED_BYTES) {
			throw new Error('ZIP fallback exceeds safe size during collection.');
		}
	}
	report(options, 'finalizing', totalFrames, totalFrames);
	const { zipSync } = await import('fflate');
	// SAFETY: zipSync with level 0 (store) for already-compressed images is most efficient and lossless.
	const zipped = zipSync(entries, { level: 0 });
	const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
	const fileName = `${baseName}.zip`;
	// Only the main thread writes workspace files
	const root = getWorkspaceRoot();
	if (root) {
		const segments = [...projectExportsDir(project.id), fileName];
		// Write via main-thread workspace if available; otherwise return blob for download.
		try {
			await writeBlob(root, segments, blob);
		} catch {
			// Workspace write is best-effort for ZIP fallback; download remains available.
		}
	}
	const relPath = `projects/${project.id}/exports/${fileName}`;
	return { kind: 'zip', fileName, relPath, blob, frameCount: totalFrames, totalBytes: blob.size };
}

export function getDirectoryPickerAvailable(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickSequenceDirectory(): Promise<FileSystemDirectoryHandle | null> {
	if (!getDirectoryPickerAvailable()) return null;
	try {
		// SAFETY: showDirectoryPicker is feature-detected above.
		const handle = await (
			window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
		).showDirectoryPicker();
		return handle;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return null;
	}
}
