import type {
	ImageEditorLayerEffects,
	ImageEditorLayerStrokeEffect,
	ImageEditorLayerMask,
	ImageEditorShadowEffect,
	ImageEditorTextCurve
} from './types';

export const DEFAULT_SHADOW_EFFECT: ImageEditorShadowEffect = {
	color: '#000000',
	opacity: 0.35,
	blur: 24,
	angle: 45,
	distance: 16
};

export const DEFAULT_STROKE_EFFECT: ImageEditorLayerStrokeEffect = {
	color: '#f97316',
	opacity: 1,
	width: 4,
	position: 'inside'
};

export function defaultLayerEffects(): ImageEditorLayerEffects {
	return { blend_mode: 'normal' };
}

export function defaultTextCurve(): ImageEditorTextCurve {
	return { type: 'none', strength: 0.65, offset: 0, reverse: false };
}

export function defaultLayerMask(): ImageEditorLayerMask {
	return { shape: 'rectangle', inset: 0, radius: 32 };
}

export interface ImageEditorShadowOffset {
	x: number;
	y: number;
}

export function shadowOffset(effect: ImageEditorShadowEffect): ImageEditorShadowOffset {
	const radians = (effect.angle * Math.PI) / 180;
	return {
		x: Math.cos(radians) * effect.distance,
		y: Math.sin(radians) * effect.distance
	};
}

export function shadowColor(effect: ImageEditorShadowEffect): string {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(effect.color);
	if (!match) return `rgba(0, 0, 0, ${clamp(effect.opacity, 0, 1)})`;
	return `rgba(${Number.parseInt(match[1], 16)}, ${Number.parseInt(match[2], 16)}, ${Number.parseInt(match[3], 16)}, ${clamp(effect.opacity, 0, 1)})`;
}

export function createTextCurvePath(
	width: number,
	height: number,
	curve: ImageEditorTextCurve
): string | null {
	if (curve.type === 'none') return null;
	const safeWidth = Math.max(1, width);
	const safeHeight = Math.max(1, height);
	const strength = clamp(curve.strength, 0.05, 1);
	const centerX = safeWidth / 2;
	const centerY = safeHeight / 2;
	const depth = Math.max(8, Math.min(safeHeight * 0.8, safeWidth * 0.28) * strength);

	if (curve.type === 'arc_up') {
		const edgeY = centerY + depth / 2;
		return `M 0 ${edgeY} Q ${centerX} ${edgeY - depth * 1.5} ${safeWidth} ${edgeY}`;
	}
	if (curve.type === 'arc_down') {
		const edgeY = centerY - depth / 2;
		return `M 0 ${edgeY} Q ${centerX} ${edgeY + depth * 1.5} ${safeWidth} ${edgeY}`;
	}
	if (curve.type === 'wave') {
		const amplitude = Math.max(6, Math.min(safeHeight * 0.42, safeWidth * 0.12) * strength);
		return [
			`M 0 ${centerY}`,
			`C ${safeWidth / 8} ${centerY - amplitude} ${safeWidth * 0.375} ${centerY - amplitude} ${safeWidth / 2} ${centerY}`,
			`C ${safeWidth * 0.625} ${centerY + amplitude} ${safeWidth * 0.875} ${centerY + amplitude} ${safeWidth} ${centerY}`
		].join(' ');
	}

	const padding = Math.max(4, Math.min(safeWidth, safeHeight) * 0.04);
	const radiusX =
		curve.type === 'circle'
			? Math.max(1, Math.min(safeWidth, safeHeight) / 2 - padding)
			: Math.max(1, safeWidth / 2 - padding);
	const radiusY = curve.type === 'circle' ? radiusX : Math.max(1, safeHeight / 2 - padding);
	return [
		`M ${centerX - radiusX} ${centerY}`,
		`A ${radiusX} ${radiusY} 0 1 1 ${centerX + radiusX} ${centerY}`,
		`A ${radiusX} ${radiusY} 0 1 1 ${centerX - radiusX} ${centerY}`
	].join(' ');
}

export function textCurveStartOffset(width: number, curve: ImageEditorTextCurve): number {
	return clamp(curve.offset, -1, 1) * Math.max(1, width);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
