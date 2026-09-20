import { strToU8, zipSync } from 'fflate';
import type { ImageEditorDocument, ImageEditorPage } from './types';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { m } from '$lib/paraglide/messages';
import { imageEditorArchiveFilename, imageEditorPageFilename } from './export-names';

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
		onTextChange() {}
	});
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
	page: ImageEditorPage
): Promise<Blob> {
	await globalThis.document.fonts?.ready;
	const canvas = globalThis.document.createElement('canvas');
	const renderScale = Math.min(
		1,
		512 / Math.max(imageEditorDocument.width_px, imageEditorDocument.height_px)
	);
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
	try {
		await adapter.mount();
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error(m.image_editor_page_render_failed())),
				'image/webp',
				0.82
			);
		});
	} finally {
		adapter.dispose();
	}
}

export async function downloadRenderedPages(
	pages: ImageEditorRenderedPage[],
	title: string
): Promise<void> {
	if (pages.length === 1) {
		downloadBlob(pages[0].blob, pages[0].filename);
		return;
	}
	const entries = await Promise.all(
		pages.map(
			async (page) => [page.filename, new Uint8Array(await page.blob.arrayBuffer())] as const
		)
	);
	const files = Object.fromEntries(entries);
	const zipped = zipSync({
		...files,
		'manifest.txt': strToU8(m.image_editor_zip_manifest({ count: pages.length }))
	});
	downloadBlob(
		new Blob([zipped.slice().buffer], { type: 'application/zip' }),
		imageEditorArchiveFilename(title)
	);
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
