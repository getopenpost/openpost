import { strToU8, zipSync } from 'fflate';
import type { StudioDocument, StudioPage } from './types';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { m } from '$lib/paraglide/messages';

export interface StudioRenderedPage {
	page: StudioPage;
	filename: string;
	blob: Blob;
}

export async function renderStudioPages(
	studioDocument: StudioDocument,
	pageIDs: string[] = studioDocument.pages.map((page) => page.id),
	onProgress?: (completed: number, total: number) => void
): Promise<StudioRenderedPage[]> {
	const pages = studioDocument.pages.filter((page) => pageIDs.includes(page.id));
	const results: StudioRenderedPage[] = [];
	for (let index = 0; index < pages.length; index++) {
		const page = pages[index];
		results.push(await renderStudioPage(studioDocument, page, studioDocument.pages.indexOf(page)));
		onProgress?.(index + 1, pages.length);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
	return results;
}

export async function renderStudioPage(
	studioDocument: StudioDocument,
	page: StudioPage,
	pageIndex: number
): Promise<StudioRenderedPage> {
	await globalThis.document.fonts?.ready;
	const canvas = globalThis.document.createElement('canvas');
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: studioDocument,
		page,
		readOnly: true,
		staticCanvas: true,
		onSelection() {},
		onTransform() {},
		onTextChange() {}
	});
	await adapter.mount();
	const format =
		studioDocument.export_defaults.format === 'jpeg'
			? 'image/jpeg'
			: studioDocument.export_defaults.format === 'webp'
				? 'image/webp'
				: 'image/png';
	const outputCanvas =
		format === 'image/jpeg'
			? flattenCanvas(canvas, studioDocument.export_defaults.matte_color || '#ffffff')
			: canvas;
	const blob = await new Promise<Blob>((resolve, reject) => {
		outputCanvas.toBlob(
			(result) => (result ? resolve(result) : reject(new Error(m.studio_page_render_failed()))),
			format,
			studioDocument.export_defaults.quality
		);
	});
	adapter.dispose();
	return {
		page,
		filename: `${sanitizeFilename(studioDocument.title)}-page-${String(pageIndex + 1).padStart(2, '0')}.${extensionForFormat(format)}`,
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

export async function renderStudioPreview(
	studioDocument: StudioDocument,
	page: StudioPage
): Promise<Blob> {
	await globalThis.document.fonts?.ready;
	const canvas = globalThis.document.createElement('canvas');
	const renderScale = Math.min(
		1,
		512 / Math.max(studioDocument.width_px, studioDocument.height_px)
	);
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: studioDocument,
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
			(result) => (result ? resolve(result) : reject(new Error(m.studio_page_render_failed()))),
			'image/webp',
			0.82
		);
	});
	adapter.dispose();
	return blob;
}

export function downloadRenderedPages(pages: StudioRenderedPage[], title: string): void {
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
				'manifest.txt': strToU8(m.studio_zip_manifest({ count: pages.length }))
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
