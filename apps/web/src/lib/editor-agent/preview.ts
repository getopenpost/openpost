import { EditorAgentOperationError } from './browser-relay';

const PREVIEW_MAX_EDGE = 640;
const PREVIEW_MAX_BYTES = 768 * 1024;

export async function encodeEditorPreview(
	blob: Blob
): Promise<{ mime_type: string; width_px: number; height_px: number; image_base64: string }> {
	const bitmap = await createImageBitmap(blob);
	try {
		const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context)
			throw new EditorAgentOperationError('render_unavailable', 'Preview canvas is unavailable');
		context.drawImage(bitmap, 0, 0, width, height);
		const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
		if (encoded.size > PREVIEW_MAX_BYTES)
			throw new EditorAgentOperationError(
				'preview_too_large',
				'Preview exceeds the safe response limit'
			);
		const bytes = new Uint8Array(await encoded.arrayBuffer());
		let binary = '';
		for (let start = 0; start < bytes.length; start += 8192) {
			binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
		}
		return {
			mime_type: 'image/jpeg',
			width_px: width,
			height_px: height,
			image_base64: btoa(binary)
		};
	} finally {
		bitmap.close();
	}
}
