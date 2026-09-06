import type { ImageEditorCrop, ImageEditorLayer, ImageEditorTransform } from './types';

export interface ImageEditorCropWindow {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ImageEditorCropApplication {
	transform: ImageEditorTransform;
	crop: ImageEditorCrop;
}

const MINIMUM_CROP_FRACTION = 0.005;

export function normalizeImageEditorCropWindow(
	window: ImageEditorCropWindow,
	minimum = MINIMUM_CROP_FRACTION
): ImageEditorCropWindow {
	const x = clamp(window.x, 0, 1 - minimum);
	const y = clamp(window.y, 0, 1 - minimum);
	return {
		x,
		y,
		width: clamp(window.width, minimum, 1 - x),
		height: clamp(window.height, minimum, 1 - y)
	};
}

export function imageEditorCropWindowForAspect(
	transform: ImageEditorTransform,
	aspect: number
): ImageEditorCropWindow {
	if (!Number.isFinite(aspect) || aspect <= 0) return { x: 0, y: 0, width: 1, height: 1 };
	const currentAspect = transform.width / Math.max(1, transform.height);
	if (currentAspect > aspect) {
		const width = aspect / currentAspect;
		return { x: (1 - width) / 2, y: 0, width, height: 1 };
	}
	const height = currentAspect / aspect;
	return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function applyImageEditorCropWindow(
	layer: Pick<ImageEditorLayer, 'transform' | 'image'>,
	window: ImageEditorCropWindow,
	sourceWindow: ImageEditorCropWindow = window
): ImageEditorCropApplication {
	if (!layer.image) throw new Error('Image crop requires an image layer.');
	const current = layer.image.crop;
	const visualX = window.x;
	const visualY = window.y;
	const sourceX = layer.transform.flip_x ? 1 - sourceWindow.x - sourceWindow.width : sourceWindow.x;
	const sourceY = layer.transform.flip_y
		? 1 - sourceWindow.y - sourceWindow.height
		: sourceWindow.y;
	const crop = {
		x: clamp(current.x + sourceX * current.width, 0, 1),
		y: clamp(current.y + sourceY * current.height, 0, 1),
		width: clamp(current.width * sourceWindow.width, MINIMUM_CROP_FRACTION, 1),
		height: clamp(current.height * sourceWindow.height, MINIMUM_CROP_FRACTION, 1)
	};
	crop.width = Math.min(crop.width, 1 - crop.x);
	crop.height = Math.min(crop.height, 1 - crop.y);

	const localX = visualX * layer.transform.width;
	const localY = visualY * layer.transform.height;
	const radians = (layer.transform.rotation * Math.PI) / 180;
	const offsetX = localX * Math.cos(radians) - localY * Math.sin(radians);
	const offsetY = localX * Math.sin(radians) + localY * Math.cos(radians);
	return {
		crop,
		transform: {
			...layer.transform,
			x: layer.transform.x + offsetX,
			y: layer.transform.y + offsetY,
			width: Math.max(1, layer.transform.width * window.width),
			height: Math.max(1, layer.transform.height * window.height)
		}
	};
}

export function resetImageEditorCrop(
	layer: Pick<ImageEditorLayer, 'transform' | 'image'>
): ImageEditorCropApplication {
	if (!layer.image) throw new Error('Image crop requires an image layer.');
	const current = layer.image.crop;
	const width = 1 / current.width;
	const height = 1 / current.height;
	const sourceX = -current.x / current.width;
	const sourceY = -current.y / current.height;
	return applyImageEditorCropWindow(layer, {
		x: layer.transform.flip_x ? 1 - sourceX - width : sourceX,
		y: layer.transform.flip_y ? 1 - sourceY - height : sourceY,
		width,
		height
	});
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
