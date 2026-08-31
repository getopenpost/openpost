import { readCurveChannelPoints, type CurveChannel } from './gpu/curves';
import { getGpuEffect, getGpuEffectDefaultParams } from './gpu/registry';
import type { GpuParamValues } from './gpu/types';
import type { ItemEffect } from './types';

export interface ColorGradeThumbnailTreatment {
	hasGrade: boolean;
	filter: string;
	overlayBackground: string | null;
}

interface TreatmentState {
	brightness: number;
	contrast: number;
	saturation: number;
	hueRotation: number;
	sepia: number;
	grayscale: number;
	invert: number;
	overlays: Array<{ hue: number; alpha: number }>;
}

const EMPTY_TREATMENT: ColorGradeThumbnailTreatment = {
	hasGrade: false,
	filter: '',
	overlayBackground: null
};

function clamp(value: number, minimum: number, maximum: number): number {
	if (!Number.isFinite(value)) return minimum;
	return Math.max(minimum, Math.min(maximum, value));
}

function readNumber(params: GpuParamValues, key: string, fallback: number): number {
	const value = params[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function addOverlay(state: TreatmentState, hue: number, alpha: number): void {
	const safeAlpha = clamp(alpha, 0, 0.45);
	if (safeAlpha < 0.01) return;
	state.overlays.push({ hue: ((hue % 360) + 360) % 360, alpha: safeAlpha });
}

function applyTemperatureTint(
	state: TreatmentState,
	temperature: number,
	tint: number,
	scale: number
): void {
	if (Math.abs(temperature) > 0.001) {
		addOverlay(state, temperature > 0 ? 34 : 210, Math.abs(temperature) * scale);
	}
	if (Math.abs(tint) > 0.001) {
		addOverlay(state, tint > 0 ? 315 : 125, Math.abs(tint) * scale);
	}
}

function applyColorWheels(state: TreatmentState, params: GpuParamValues): void {
	const exposure = readNumber(params, 'exposure', 0);
	const lift = readNumber(params, 'lift', 0);
	const offset = readNumber(params, 'offset', 0);
	const gain = readNumber(params, 'gain', 1);
	const gamma = readNumber(params, 'gamma', 1);
	const blackPoint = readNumber(params, 'blackPoint', 0);
	const whitePoint = readNumber(params, 'whitePoint', 1);

	state.brightness *= clamp(
		Math.pow(2, exposure) *
			(1 + lift * 0.28 + offset * 0.18) *
			(1 + (gain - 1) * 0.12) *
			(1 + (gamma - 1) * 0.08),
		0.12,
		4
	);
	state.contrast *= clamp(readNumber(params, 'contrast', 1), 0.1, 3);
	state.contrast *= clamp(1 / Math.max(0.08, whitePoint - blackPoint), 0.35, 3);
	state.saturation *= clamp(
		1 + readNumber(params, 'saturation', 0) / 100 + readNumber(params, 'colorBoost', 0) / 150,
		0,
		4
	);
	state.hueRotation += (readNumber(params, 'hue', 50) - 50) * 3.6;
	state.brightness *= clamp(
		1 + (readNumber(params, 'shadows', 0) + readNumber(params, 'highlights', 0)) / 360,
		0.35,
		2
	);

	applyTemperatureTint(
		state,
		readNumber(params, 'temperature', 0),
		readNumber(params, 'tint', 0),
		0.0024
	);
	addOverlay(
		state,
		readNumber(params, 'offsetHue', 0),
		readNumber(params, 'offsetAmount', 0) * 0.22
	);
	addOverlay(
		state,
		readNumber(params, 'shadowsHue', 0),
		readNumber(params, 'shadowsAmount', 0) * 0.09
	);
	addOverlay(
		state,
		readNumber(params, 'midtonesHue', 0),
		readNumber(params, 'midtonesAmount', 0) * 0.12
	);
	addOverlay(
		state,
		readNumber(params, 'highlightsHue', 0),
		readNumber(params, 'highlightsAmount', 0) * 0.09
	);
}

function curveDelta(params: GpuParamValues, channel: CurveChannel): number {
	const points = readCurveChannelPoints(params, channel);
	const shadow = points.reduce((nearest, point) =>
		Math.abs(point.x - 0.25) < Math.abs(nearest.x - 0.25) ? point : nearest
	);
	const highlight = points.reduce((nearest, point) =>
		Math.abs(point.x - 0.75) < Math.abs(nearest.x - 0.75) ? point : nearest
	);
	return shadow.y - shadow.x + highlight.y - highlight.x;
}

function applyCurves(state: TreatmentState, params: GpuParamValues): void {
	const masterPoints = readCurveChannelPoints(params, 'master');
	const masterDelta = curveDelta(params, 'master');
	const highlight = masterPoints.reduce((nearest, point) =>
		Math.abs(point.x - 0.75) < Math.abs(nearest.x - 0.75) ? point : nearest
	);
	state.brightness *= clamp(1 + masterDelta * 0.45, 0.25, 2.5);
	state.contrast *= clamp(1 + (highlight.y - 0.75) * 1.2, 0.3, 2.6);

	const channels = (['red', 'green', 'blue'] as const)
		.map((channel) => [channel, curveDelta(params, channel)] as const)
		.toSorted((left, right) => Math.abs(right[1]) - Math.abs(left[1]));
	const strongest = channels[0];
	if (!strongest || Math.abs(strongest[1]) < 0.025) return;
	const hue = {
		red: strongest[1] > 0 ? 0 : 180,
		green: strongest[1] > 0 ? 120 : 300,
		blue: strongest[1] > 0 ? 230 : 45
	}[strongest[0]];
	addOverlay(state, hue, Math.abs(strongest[1]) * 0.2);
}

function applyGenericColorEffect(
	state: TreatmentState,
	effectId: string,
	params: GpuParamValues
): void {
	switch (effectId) {
		case 'gpu-brightness':
			state.brightness *= clamp(1 + readNumber(params, 'amount', 0), 0, 3);
			break;
		case 'gpu-contrast':
			state.contrast *= clamp(readNumber(params, 'amount', 1), 0, 3);
			break;
		case 'gpu-exposure':
			state.brightness *= clamp(
				Math.pow(2, readNumber(params, 'exposure', 0)) + readNumber(params, 'offset', 0),
				0,
				4
			);
			state.brightness *= clamp(1 + (readNumber(params, 'gamma', 1) - 1) * 0.1, 0.5, 1.6);
			break;
		case 'gpu-hue-shift':
			state.hueRotation += readNumber(params, 'shift', 0) * 360;
			break;
		case 'gpu-saturation':
			state.saturation *= clamp(readNumber(params, 'amount', 1), 0, 4);
			break;
		case 'gpu-temperature':
			applyTemperatureTint(
				state,
				readNumber(params, 'temperature', 0),
				readNumber(params, 'tint', 0),
				0.24
			);
			break;
		case 'gpu-grayscale':
			state.grayscale = clamp(state.grayscale + readNumber(params, 'amount', 1), 0, 1);
			break;
		case 'gpu-sepia':
			state.sepia = clamp(state.sepia + readNumber(params, 'amount', 1), 0, 1);
			break;
		case 'gpu-invert':
			state.invert = 1;
			break;
		case 'gpu-levels': {
			const inputBlack = readNumber(params, 'inputBlack', 0);
			const inputWhite = readNumber(params, 'inputWhite', 1);
			state.contrast *= clamp(1 / Math.max(0.08, inputWhite - inputBlack), 0.25, 3);
			state.brightness *= clamp(
				readNumber(params, 'outputWhite', 1) - readNumber(params, 'outputBlack', 0),
				0.1,
				2
			);
			break;
		}
	}
}

/** Approximate the active grade while the exact GPU tile is rendering or unavailable. */
export function resolveColorGradeThumbnailTreatment(
	effects: readonly ItemEffect[] | undefined
): ColorGradeThumbnailTreatment {
	const gradeEffects = (effects ?? []).filter(
		(effect) =>
			effect.enabled && effect.type === 'gpu' && getGpuEffect(effect.effectId)?.category === 'color'
	);
	if (gradeEffects.length === 0) return EMPTY_TREATMENT;

	const state: TreatmentState = {
		brightness: 1,
		contrast: 1,
		saturation: 1,
		hueRotation: 0,
		sepia: 0,
		grayscale: 0,
		invert: 0,
		overlays: []
	};
	for (const effect of gradeEffects) {
		if (effect.type !== 'gpu') continue;
		const params = { ...getGpuEffectDefaultParams(effect.effectId), ...effect.params };
		if (effect.effectId === 'gpu-color-wheels') applyColorWheels(state, params);
		else if (effect.effectId === 'gpu-curves') applyCurves(state, params);
		else applyGenericColorEffect(state, effect.effectId, params);
	}

	const filter = [
		state.invert > 0 ? `invert(${Math.round(state.invert * 100)}%)` : null,
		state.grayscale > 0 ? `grayscale(${Math.round(state.grayscale * 100)}%)` : null,
		state.sepia > 0 ? `sepia(${Math.round(state.sepia * 100)}%)` : null,
		`brightness(${clamp(state.brightness, 0, 4).toFixed(3)})`,
		`contrast(${clamp(state.contrast, 0, 4).toFixed(3)})`,
		`saturate(${clamp(state.saturation, 0, 4).toFixed(3)})`,
		Math.abs(state.hueRotation) > 0.01 ? `hue-rotate(${Math.round(state.hueRotation)}deg)` : null
	]
		.filter(Boolean)
		.join(' ');
	const overlayBackground = state.overlays.length
		? state.overlays
				.map(
					({ hue, alpha }) =>
						`linear-gradient(hsla(${Math.round(hue)}, 90%, 55%, ${alpha}), hsla(${Math.round(hue)}, 90%, 55%, ${alpha}))`
				)
				.join(', ')
		: null;
	return { hasGrade: true, filter, overlayBackground };
}

/** Resolve the ordered enabled GPU stack for exact tile rendering. */
export function colorGradeTileEffects(effects: readonly ItemEffect[] | undefined) {
	return (effects ?? []).flatMap((effect) =>
		effect.enabled && effect.type === 'gpu'
			? [{ effectId: effect.effectId, params: { ...effect.params } }]
			: []
	);
}
