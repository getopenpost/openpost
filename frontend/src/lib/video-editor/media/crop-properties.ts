import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '$lib/video-editor/project/defaults';
import type { CropSettings, KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';

export type CropKeyframeProperty = Extract<
	KeyframeProperty,
	'cropLeft' | 'cropRight' | 'cropTop' | 'cropBottom' | 'cropSoftness'
>;

export interface CropSourceDimensions {
	width: number;
	height: number;
}

const MAX_EDGE_SUM = 0.999;

export function cropSourceDimensions(
	item: TimelineItem,
	fallbackWidth = DEFAULT_PROJECT_WIDTH,
	fallbackHeight = DEFAULT_PROJECT_HEIGHT
): CropSourceDimensions {
	return {
		width: Math.max(
			1,
			item.compositionWidth ?? item.sourceWidth ?? item.transform?.width ?? fallbackWidth
		),
		height: Math.max(
			1,
			item.compositionHeight ?? item.sourceHeight ?? item.transform?.height ?? fallbackHeight
		)
	};
}

export function cropSoftnessReferenceDimension(dimensions: CropSourceDimensions): number {
	return Math.max(1, Math.min(dimensions.width, dimensions.height));
}

export function cropPropertyValuePixels(
	crop: CropSettings | undefined,
	property: CropKeyframeProperty,
	dimensions: CropSourceDimensions
): number {
	switch (property) {
		case 'cropLeft':
			return clamp01(crop?.left ?? 0) * dimensions.width;
		case 'cropRight':
			return clamp01(crop?.right ?? 0) * dimensions.width;
		case 'cropTop':
			return clamp01(crop?.top ?? 0) * dimensions.height;
		case 'cropBottom':
			return clamp01(crop?.bottom ?? 0) * dimensions.height;
		case 'cropSoftness':
			return clampSigned01(crop?.softness ?? 0) * cropSoftnessReferenceDimension(dimensions);
	}
}

export function cropWithPropertyPixels(
	crop: CropSettings | undefined,
	property: CropKeyframeProperty,
	pixels: number,
	dimensions: CropSourceDimensions
): CropSettings {
	const current = normalizeCrop(crop);
	switch (property) {
		case 'cropLeft':
			return normalizeCrop({ ...current, left: clamp01(pixels / dimensions.width) });
		case 'cropRight':
			return normalizeCrop({ ...current, right: clamp01(pixels / dimensions.width) });
		case 'cropTop':
			return normalizeCrop({ ...current, top: clamp01(pixels / dimensions.height) });
		case 'cropBottom':
			return normalizeCrop({ ...current, bottom: clamp01(pixels / dimensions.height) });
		case 'cropSoftness':
			return normalizeCrop({
				...current,
				softness: clampSigned01(pixels / cropSoftnessReferenceDimension(dimensions))
			});
	}
}

export function cropRatioValueToPixels(
	item: TimelineItem,
	property: CropKeyframeProperty,
	ratio: number,
	fallbackWidth?: number,
	fallbackHeight?: number
): number {
	const dimensions = cropSourceDimensions(item, fallbackWidth, fallbackHeight);
	const crop = cropWithRatioValue(item.crop, property, ratio);
	return cropPropertyValuePixels(crop, property, dimensions);
}

function cropWithRatioValue(
	crop: CropSettings | undefined,
	property: CropKeyframeProperty,
	value: number
): CropSettings {
	const current = normalizeCrop(crop);
	switch (property) {
		case 'cropLeft':
			return { ...current, left: value };
		case 'cropRight':
			return { ...current, right: value };
		case 'cropTop':
			return { ...current, top: value };
		case 'cropBottom':
			return { ...current, bottom: value };
		case 'cropSoftness':
			return { ...current, softness: value };
	}
}

function normalizeCrop(crop: CropSettings | undefined): CropSettings {
	const [left, right] = clampAxisPair(clamp01(crop?.left ?? 0), clamp01(crop?.right ?? 0));
	const [top, bottom] = clampAxisPair(clamp01(crop?.top ?? 0), clamp01(crop?.bottom ?? 0));
	return {
		left,
		right,
		top,
		bottom,
		...(crop?.softness !== undefined && { softness: clampSigned01(crop.softness) })
	};
}

function clampAxisPair(start: number, end: number): [number, number] {
	const total = start + end;
	if (total <= MAX_EDGE_SUM) return [start, end];
	if (total <= 0) return [0, 0];
	const scale = MAX_EDGE_SUM / total;
	return [start * scale, end * scale];
}

function clamp01(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.min(1, value);
}

function clampSigned01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(-1, value));
}
