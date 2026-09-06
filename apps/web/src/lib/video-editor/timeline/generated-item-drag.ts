/** Versioned drag payload for text recipes and generated shape layers. */

import type { ShapeType, TextStylePresetId } from '../project/types';
import type { AddShapeItemStyle } from './actions/items';
import { TEXT_STYLE_PRESETS } from '../typography/text-style-presets';

export const GENERATED_ITEM_DRAG_MIME = 'application/x-openpost-generated-item-v1';

const GENERATED_ITEM_DRAG_VERSION = 1;
const SHAPE_TYPES = [
	'rectangle',
	'circle',
	'triangle',
	'ellipse',
	'star',
	'polygon',
	'heart',
	'path'
] satisfies readonly ShapeType[];

export type GeneratedItemDragData =
	| {
			version: typeof GENERATED_ITEM_DRAG_VERSION;
			kind: 'text';
			label: string;
			presetId?: TextStylePresetId;
	  }
	| {
			version: typeof GENERATED_ITEM_DRAG_VERSION;
			kind: 'shape';
			label: string;
			shapeType: ShapeType;
			style?: AddShapeItemStyle;
	  };

let activeGeneratedItemDrag: GeneratedItemDragData | null = null;

interface UntrustedShapeStyle {
	fillType?: unknown;
	fillColor?: unknown;
	gradientStartColor?: unknown;
	gradientEndColor?: unknown;
	gradientAngle?: unknown;
	sizeMode?: unknown;
}

interface UntrustedGeneratedItemDragData {
	version?: unknown;
	kind?: unknown;
	label?: unknown;
	presetId?: unknown;
	shapeType?: unknown;
	style?: unknown;
}

function isShapeStyle(value: unknown): value is AddShapeItemStyle {
	if (value === undefined) return true;
	if (!value || typeof value !== 'object') return false;
	// SAFETY: The object came from untrusted JSON. Every optional field stays unknown until checked below.
	const style = value as UntrustedShapeStyle;
	return (
		(style.fillType === undefined || style.fillType === 'solid' || style.fillType === 'linear') &&
		(style.fillColor === undefined || typeof style.fillColor === 'string') &&
		(style.gradientStartColor === undefined || typeof style.gradientStartColor === 'string') &&
		(style.gradientEndColor === undefined || typeof style.gradientEndColor === 'string') &&
		(style.gradientAngle === undefined || typeof style.gradientAngle === 'number') &&
		(style.sizeMode === undefined || style.sizeMode === 'default' || style.sizeMode === 'canvas')
	);
}

function isGeneratedItemDragData(value: unknown): value is GeneratedItemDragData {
	if (!value || typeof value !== 'object') return false;
	// SAFETY: The object came from untrusted JSON. Every optional field stays unknown until checked below.
	const candidate = value as UntrustedGeneratedItemDragData;
	if (
		candidate.version !== GENERATED_ITEM_DRAG_VERSION ||
		typeof candidate.label !== 'string' ||
		candidate.label.length === 0
	) {
		return false;
	}
	if (candidate.kind === 'text') {
		return (
			candidate.presetId === undefined ||
			(typeof candidate.presetId === 'string' &&
				TEXT_STYLE_PRESETS.some((preset) => preset.id === candidate.presetId))
		);
	}
	return (
		candidate.kind === 'shape' &&
		typeof candidate.shapeType === 'string' &&
		SHAPE_TYPES.some((shapeType) => shapeType === candidate.shapeType) &&
		isShapeStyle(candidate.style)
	);
}

export function textGeneratedItemDragData(
	label: string,
	presetId?: TextStylePresetId
): GeneratedItemDragData {
	return {
		version: GENERATED_ITEM_DRAG_VERSION,
		kind: 'text',
		label,
		presetId
	};
}

export function shapeGeneratedItemDragData(
	label: string,
	shapeType: ShapeType,
	style?: AddShapeItemStyle
): GeneratedItemDragData {
	return {
		version: GENERATED_ITEM_DRAG_VERSION,
		kind: 'shape',
		label,
		shapeType,
		style
	};
}

export function parseGeneratedItemDragData(raw: string): GeneratedItemDragData | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isGeneratedItemDragData(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function writeGeneratedItemDragData(
	dataTransfer: DataTransfer,
	payload: GeneratedItemDragData
): void {
	activeGeneratedItemDrag = payload;
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(GENERATED_ITEM_DRAG_MIME, JSON.stringify(payload));
}

export function getGeneratedItemDragData(
	dataTransfer?: DataTransfer | null
): GeneratedItemDragData | null {
	const transferred = dataTransfer?.getData(GENERATED_ITEM_DRAG_MIME);
	return parseGeneratedItemDragData(transferred ?? '') ?? activeGeneratedItemDrag;
}

export function clearGeneratedItemDragData(): void {
	activeGeneratedItemDrag = null;
}
