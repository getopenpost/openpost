import { EXPORT_SCALE, MAX_EXPORT_HEIGHT, TEMPLATE_WIDTH } from './document';
import { m } from '$lib/paraglide/messages';

export async function renderScreenshot(element: HTMLElement, height: number): Promise<Blob> {
	const outputHeight = Math.ceil(height * EXPORT_SCALE);
	if (outputHeight < 1 || outputHeight > MAX_EXPORT_HEIGHT) throw new Error(m.templates_too_tall());
	await document.fonts.ready;
	const { toBlob } = await import('html-to-image');
	const blob = await toBlob(element, {
		width: TEMPLATE_WIDTH,
		height: Math.ceil(height),
		pixelRatio: EXPORT_SCALE,
		skipFonts: true,
		style: { transform: 'none', margin: '0' },
		cacheBust: false
	});
	if (!blob) throw new Error(m.image_editor_export_failed());
	return blob;
}
export function downloadScreenshot(blob: Blob, title: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = screenshotFilename(title);
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function screenshotFilename(title: string): string {
	return `${
		title
			.trim()
			.replace(/[^\p{L}\p{N}_. -]/gu, '')
			.slice(0, 100) || 'template'
	}.png`;
}
