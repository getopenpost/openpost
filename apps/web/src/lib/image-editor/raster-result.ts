import { m } from '$lib/paraglide/messages';
import type { ImageEditorRasterBounds, ImageEditorRasterPlan } from './raster-operations';

/** Keep original handles while extending them to include rotated pixels and effects. */
export async function cropRasterResult(
	plan: ImageEditorRasterPlan,
	blob: Blob,
	signal?: AbortSignal
): Promise<{ blob: Blob; bounds: ImageEditorRasterBounds }> {
	if (plan.kind === 'flatten_page') return { blob, bounds: plan.bounds };
	signal?.throwIfAborted();
	const bitmap = await createImageBitmap(blob);
	try {
		signal?.throwIfAborted();
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap, 0, 0);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		let left = plan.bounds.x;
		let top = plan.bounds.y;
		let right = left + plan.bounds.width;
		let bottom = top + plan.bounds.height;
		for (let y = 0; y < canvas.height; y++) {
			for (let x = 0; x < canvas.width; x++) {
				if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
				left = Math.min(left, x);
				top = Math.min(top, y);
				right = Math.max(right, x + 1);
				bottom = Math.max(bottom, y + 1);
			}
		}
		const bounds = { x: left, y: top, width: right - left, height: bottom - top };
		canvas.width = bounds.width;
		canvas.height = bounds.height;
		context.drawImage(bitmap, -left, -top);
		const cropped = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error(m.image_editor_page_render_failed())),
				'image/png'
			)
		);
		signal?.throwIfAborted();
		return { blob: cropped, bounds };
	} finally {
		bitmap.close();
	}
}
