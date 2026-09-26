import { startProfileSpan } from '$lib/performance/profiling';
import { strToU8, Zip, ZipPassThrough } from 'fflate';
import type { ImageEditorDocument, ImageEditorPage } from './types';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { m } from '$lib/paraglide/messages';
import { imageEditorArchiveFilename, imageEditorPageFilename } from './export-names';
import { IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT } from './export-budget';
import { imageEditorPageDimensions } from './page-dimensions';

const ARCHIVE_YIELD_BYTES = 4 * 1024 * 1024;

export interface ImageEditorRenderedPage {
	page: ImageEditorPage;
	filename: string;
	blob: Blob;
}

export async function renderImageEditorPages(
	imageEditorDocument: ImageEditorDocument,
	pageIDs: string[] = imageEditorDocument.pages.map((page) => page.id),
	onProgress?: (completed: number, total: number) => void,
	signal?: AbortSignal
): Promise<ImageEditorRenderedPage[]> {
	const pages = imageEditorDocument.pages.filter((page) => pageIDs.includes(page.id));
	const results: ImageEditorRenderedPage[] = [];
	const maxPixels = pages.reduce((largest, page) => {
		const { width, height } = imageEditorPageDimensions(imageEditorDocument, page);
		return Math.max(largest, width * height);
	}, 0);
	let retainedBytes = 0;
	for (let index = 0; index < pages.length; index++) {
		signal?.throwIfAborted();
		const page = pages[index];
		results.push(
			await renderImageEditorPage(
				imageEditorDocument,
				page,
				imageEditorDocument.pages.indexOf(page),
				signal
			)
		);
		retainedBytes += results.at(-1)!.blob.size;
		if (
			maxPixels * 9 + retainedBytes * (pages.length > 1 ? 3 : 1) >
			IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT
		) {
			throw new Error('The rendered pages exceed the browser export memory limit.');
		}
		onProgress?.(index + 1, pages.length);
		signal?.throwIfAborted();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
	return results;
}

export async function renderImageEditorPage(
	imageEditorDocument: ImageEditorDocument,
	page: ImageEditorPage,
	pageIndex: number,
	signal?: AbortSignal
): Promise<ImageEditorRenderedPage> {
	signal?.throwIfAborted();
	await globalThis.document.fonts?.ready;
	signal?.throwIfAborted();
	const canvas = globalThis.document.createElement('canvas');
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: imageEditorDocument,
		page,
		readOnly: true,
		staticCanvas: true,
		onSelection() {},
		onTransform() {},
		onTextChange() {},
		onMissingMedia() {
			throw new Error(m.image_editor_export_missing_media());
		}
	});
	const finishProfile = startProfileSpan('Image Editor', 'Render page');
	try {
		await adapter.mount();
		signal?.throwIfAborted();
		const format =
			imageEditorDocument.export_defaults.format === 'jpeg'
				? 'image/jpeg'
				: imageEditorDocument.export_defaults.format === 'webp'
					? 'image/webp'
					: 'image/png';
		const outputCanvas =
			format === 'image/jpeg'
				? flattenCanvas(canvas, imageEditorDocument.export_defaults.matte_color || '#ffffff')
				: canvas;
		const blob = await new Promise<Blob>((resolve, reject) => {
			outputCanvas.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error(m.image_editor_page_render_failed())),
				format,
				imageEditorDocument.export_defaults.quality
			);
		});
		signal?.throwIfAborted();
		return {
			page,
			filename: imageEditorPageFilename(
				imageEditorDocument.title,
				page.name,
				pageIndex,
				extensionForFormat(format)
			),
			blob
		};
	} finally {
		adapter.dispose();
		finishProfile?.();
	}
}

function flattenCanvas(source: HTMLCanvasElement, matteColor: string): HTMLCanvasElement {
	const flattened = globalThis.document.createElement('canvas');
	flattened.width = source.width;
	flattened.height = source.height;
	const context = flattened.getContext('2d');
	if (!context) return source;
	context.fillStyle = matteColor;
	context.fillRect(0, 0, flattened.width, flattened.height);
	context.drawImage(source, 0, 0);
	return flattened;
}

export async function renderImageEditorPreview(
	imageEditorDocument: ImageEditorDocument,
	page: ImageEditorPage,
	signal?: AbortSignal
): Promise<Blob> {
	signal?.throwIfAborted();
	await globalThis.document.fonts?.ready;
	signal?.throwIfAborted();
	const canvas = globalThis.document.createElement('canvas');
	const pageSize = imageEditorPageDimensions(imageEditorDocument, page);
	const renderScale = Math.min(1, 512 / Math.max(pageSize.width, pageSize.height));
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: imageEditorDocument,
		page,
		readOnly: true,
		staticCanvas: true,
		renderScale,
		onSelection() {},
		onTransform() {},
		onTextChange() {}
	});
	const finishProfile = startProfileSpan('Image Editor', 'Render preview');
	try {
		signal?.throwIfAborted();
		await adapter.mount();
		signal?.throwIfAborted();
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error(m.image_editor_page_render_failed())),
				'image/webp',
				0.82
			);
		});
		signal?.throwIfAborted();
		return blob;
	} finally {
		adapter.dispose();
		finishProfile?.();
	}
}

export async function downloadRenderedPages(
	pages: ImageEditorRenderedPage[],
	title: string,
	signal?: AbortSignal
): Promise<void> {
	signal?.throwIfAborted();
	if (pages.length === 1) {
		downloadBlob(pages[0].blob, pages[0].filename);
		return;
	}
	const archive = await createRenderedPagesArchive(pages, signal);
	signal?.throwIfAborted();
	downloadBlob(archive, imageEditorArchiveFilename(title));
}

export async function createRenderedPagesArchive(
	pages: ImageEditorRenderedPage[],
	signal?: AbortSignal
): Promise<Blob> {
	signal?.throwIfAborted();
	const retainedPageBytes = pages.reduce((total, page) => total + page.blob.size, 0);
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let archiveBytes = 0;
	let failure: Error | null = null;
	let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let complete!: () => void;
	let rejectComplete!: (error: Error) => void;
	const finished = new Promise<void>((resolve, reject) => {
		complete = resolve;
		rejectComplete = reject;
	});
	void finished.catch(() => undefined);
	const zip = new Zip((error, chunk, final) => {
		if (failure) return;
		if (error) {
			failure = error;
			rejectComplete(error);
			return;
		}
		archiveBytes += chunk.byteLength;
		if (retainedPageBytes + archiveBytes * 2 > IMAGE_EDITOR_EXPORT_WORKING_MEMORY_LIMIT) {
			failure = new Error('The rendered pages exceed the browser archive memory limit.');
			rejectComplete(failure);
			return;
		}
		const owned = new Uint8Array(chunk.byteLength);
		owned.set(chunk);
		chunks.push(owned);
		if (final) complete();
	});
	const onAbort = (): void => {
		failure = new DOMException('Export cancelled.', 'AbortError');
		zip.terminate();
		void activeReader?.cancel(failure).catch(() => undefined);
		rejectComplete(failure);
	};
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		signal?.throwIfAborted();
		for (const page of pages) {
			signal?.throwIfAborted();
			const entry = new ZipPassThrough(page.filename);
			zip.add(entry);
			const reader = page.blob.stream().getReader();
			activeReader = reader;
			let bytesSinceYield = 0;
			try {
				while (true) {
					signal?.throwIfAborted();
					if (failure) throw failure;
					const { done, value } = await reader.read();
					signal?.throwIfAborted();
					if (done) break;
					entry.push(value);
					bytesSinceYield += value.byteLength;
					if (bytesSinceYield >= ARCHIVE_YIELD_BYTES) {
						bytesSinceYield = 0;
						await new Promise<void>((resolve) => setTimeout(resolve, 0));
					}
				}
				entry.push(new Uint8Array(), true);
			} finally {
				activeReader = null;
				reader.releaseLock();
			}
		}
		const manifest = new ZipPassThrough('manifest.txt');
		zip.add(manifest);
		manifest.push(strToU8(m.image_editor_zip_manifest({ count: pages.length })), true);
		zip.end();
		await finished;
		signal?.throwIfAborted();
		return new Blob(chunks, { type: 'application/zip' });
	} catch (cause) {
		zip.terminate();
		throw cause;
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = globalThis.document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extensionForFormat(format: string): string {
	return format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
}
