import { strToU8, zipSync } from 'fflate';
import type { ImageEditorDocument, ImageEditorPage } from './types';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { m } from '$lib/paraglide/messages';

export interface ImageEditorRenderedPage {
	page: ImageEditorPage;
	filename: string;
	blob: Blob;
}

export async function renderImageEditorPages(
	imageEditorDocument: ImageEditorDocument,
	pageIDs: string[] = imageEditorDocument.pages.map((page) => page.id),
	onProgress?: (completed: number, total: number) => void
): Promise<ImageEditorRenderedPage[]> {
	const pages = imageEditorDocument.pages.filter((page) => pageIDs.includes(page.id));
	const results: ImageEditorRenderedPage[] = [];
	for (let index = 0; index < pages.length; index++) {
		const page = pages[index];
		results.push(
			await renderImageEditorPage(
				imageEditorDocument,
				page,
				imageEditorDocument.pages.indexOf(page)
			)
		);
		onProgress?.(index + 1, pages.length);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
	return results;
}

export async function renderImageEditorPage(
	imageEditorDocument: ImageEditorDocument,
	page: ImageEditorPage,
	pageIndex: number
): Promise<ImageEditorRenderedPage> {
	await globalThis.document.fonts?.ready;
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
	await adapter.mount();
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
	adapter.dispose();
	return {
		page,
		filename: `${sanitizeFilename(imageEditorDocument.title)}-page-${String(pageIndex + 1).padStart(2, '0')}.${extensionForFormat(format)}`,
		blob
	};
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
	await adapter.mount();
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(result) =>
				result ? resolve(result) : reject(new Error(m.image_editor_page_render_failed())),
			'image/webp',
			0.82
		);
	});
	adapter.dispose();
	return blob;
}

export function downloadRenderedPages(pages: ImageEditorRenderedPage[], title: string): void {
	if (pages.length === 1) {
		downloadBlob(pages[0].blob, pages[0].filename);
		return;
	}
	Promise.all(
		pages.map(
			async (page) => [page.filename, new Uint8Array(await page.blob.arrayBuffer())] as const
		)
	)
		.then((entries) => {
			const files = Object.fromEntries(entries);
			const zipped = zipSync({
				...files,
				'manifest.txt': strToU8(m.image_editor_zip_manifest({ count: pages.length }))
			});
			downloadBlob(
				new Blob([zipped.slice().buffer], { type: 'application/zip' }),
				`${sanitizeFilename(title)}.zip`
			);
		})
		.catch(() => undefined);
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = globalThis.document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(value: string): string {
	return (
		value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'openpost-design'
	);
}

function extensionForFormat(format: string): string {
	return format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
}
