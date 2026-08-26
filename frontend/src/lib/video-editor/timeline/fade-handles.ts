// Ported from FreeCut (MIT) – src/shared/utils/audio-fade-curve.ts and
// src/features/timeline/utils/audio-fade-curve.ts and src/features/timeline/utils/audio-fade.ts
// Adapted to OpenPost's TimelineItem model and clip-fades math.

import type { TimelineItem } from '../project/types';

export type FadeHandle = 'in' | 'out';

export interface CurveBias {
	curve: number;
	curveX: number;
}

export const AUDIO_FADE_CURVE_X_DEFAULT = 0.52;
export const AUDIO_FADE_CURVE_X_MIN = 0.04;
export const AUDIO_FADE_CURVE_X_MAX = 0.96;
const AUDIO_FADE_CURVE_MIN = -1;
const AUDIO_FADE_CURVE_MAX = 1;
const SOLVE_EPSILON = 0.0001;
const MAX_EXPONENT = 12;
const AUDIO_FADE_CURVE_PATH_SAMPLES = 24;
const AUDIO_FADE_CURVE_EDGE_SNAP_PX = 6;

export function supportsVisualFade(item: TimelineItem): boolean {
	return item.type === 'video' || item.type === 'composition';
}

export function supportsAudioFade(item: TimelineItem): boolean {
	return item.type === 'audio';
}

export function fadeRatio(
	fadeSeconds: number | undefined,
	fps: number,
	maxDurationFrames: number
): number {
	if (!fadeSeconds || fadeSeconds <= 0 || maxDurationFrames <= 0) return 0;
	if (!Number.isFinite(fadeSeconds) || !Number.isFinite(fps) || fps <= 0) return 0;
	return Math.max(0, Math.min(1, (fadeSeconds * fps) / maxDurationFrames));
}

export function fadeSecondsFromOffset(params: {
	handle: FadeHandle;
	clipWidthPixels: number;
	pointerOffsetPixels: number;
	fps: number;
	maxDurationFrames: number;
}): number {
	if (params.clipWidthPixels <= 0 || params.maxDurationFrames <= 0 || params.fps <= 0) return 0;
	const offsetPixels = Math.max(0, Math.min(params.clipWidthPixels, params.pointerOffsetPixels));
	const fadePixels = params.handle === 'in' ? offsetPixels : params.clipWidthPixels - offsetPixels;
	const fadeRatioValue = fadePixels / params.clipWidthPixels;
	const fadeFrames = Math.max(
		0,
		Math.min(params.maxDurationFrames, Math.round(fadeRatioValue * params.maxDurationFrames))
	);
	return fadeFrames / params.fps;
}

export function clampFadeSeconds(
	computed: number,
	otherFade: number | undefined,
	maxDurationFrames: number,
	fps: number
): number {
	if (!Number.isFinite(computed)) return 0;
	const maxSeconds =
		maxDurationFrames > 0 && fps > 0 ? maxDurationFrames / fps : Number.POSITIVE_INFINITY;
	const other = Number.isFinite(otherFade) ? (otherFade ?? 0) : 0;
	const capped = Math.max(0, Math.min(maxSeconds - Math.max(0, other), maxSeconds, computed));
	if (fps > 0) return Math.round(capped * fps) / fps;
	return capped;
}

export function clampAudioFadeCurve(curve: number | undefined): number {
	// SAFETY: Number.isFinite guarantees finite number when true; else fallback to 0
	const value = Number.isFinite(curve) ? (curve as number) : 0;
	return Math.max(
		AUDIO_FADE_CURVE_MIN,
		Math.min(AUDIO_FADE_CURVE_MAX, Math.round(value * 100) / 100)
	);
}

export function clampAudioFadeCurveX(curveX: number | undefined): number {
	// SAFETY: Number.isFinite guarantees finite number when true; else fallback to default
	const value = Number.isFinite(curveX) ? (curveX as number) : AUDIO_FADE_CURVE_X_DEFAULT;
	return Math.max(
		AUDIO_FADE_CURVE_X_MIN,
		Math.min(AUDIO_FADE_CURVE_X_MAX, Math.round(value * 1000) / 1000)
	);
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function clampUnitForSolve(value: number): number {
	return Math.max(SOLVE_EPSILON, Math.min(1 - SOLVE_EPSILON, value));
}

function solvePowerExponent(base: number, target: number): number {
	const exponent = Math.log(clampUnitForSolve(target)) / Math.log(clampUnitForSolve(base));
	if (!Number.isFinite(exponent)) return MAX_EXPONENT;
	return Math.max(1, Math.min(MAX_EXPONENT, exponent));
}

export function evaluateAudioFadeInCurve(
	progress: number,
	curve: number | undefined,
	curveX: number | undefined
): number {
	const normalizedProgress = clamp01(progress);
	const pointX = clampAudioFadeCurveX(curveX);
	const pointY = (() => {
		const x = clampAudioFadeCurveX(curveX);
		const shape = clampAudioFadeCurve(curve);
		return shape >= 0 ? x + shape * (1 - x) : x + shape * x;
	})();
	if (Math.abs(pointY - pointX) <= SOLVE_EPSILON) return normalizedProgress;
	if (pointY > pointX) {
		const exponent = solvePowerExponent(1 - pointX, 1 - pointY);
		return 1 - Math.pow(1 - normalizedProgress, exponent);
	}
	const exponent = solvePowerExponent(pointX, pointY);
	return Math.pow(normalizedProgress, exponent);
}

export function evaluateAudioFadeOutCurve(
	progress: number,
	curve: number | undefined,
	curveX: number | undefined
): number {
	const normalizedProgress = clamp01(progress);
	const pointX = clampAudioFadeCurveX(curveX);
	const pointY = (() => {
		const x = clampAudioFadeCurveX(curveX);
		const shape = clampAudioFadeCurve(curve);
		const linearY = 1 - x;
		return shape >= 0 ? linearY + shape * (1 - linearY) : linearY + shape * linearY;
	})();
	const linearY = 1 - clampAudioFadeCurveX(curveX);
	if (Math.abs(pointY - linearY) <= SOLVE_EPSILON) return 1 - normalizedProgress;
	if (pointY > linearY) {
		const exponent = solvePowerExponent(pointX, 1 - pointY);
		return 1 - Math.pow(normalizedProgress, exponent);
	}
	const exponent = solvePowerExponent(1 - pointX, pointY);
	return Math.pow(1 - normalizedProgress, exponent);
}

export interface AudioFadeCurveControlPoint {
	x: number;
	y: number;
}

function formatPathValue(value: number): string {
	return Number(value.toFixed(2)).toString();
}

export function getAudioFadeCurveControlPoint(params: {
	handle: FadeHandle;
	fadePixels: number;
	clipWidthPixels: number;
	curve: number | undefined;
	curveX?: number;
}): AudioFadeCurveControlPoint {
	const fadePixels = Math.max(0, Math.min(params.fadePixels, params.clipWidthPixels));
	const startX = params.handle === 'in' ? 0 : Math.max(0, params.clipWidthPixels - fadePixels);
	const endX = params.handle === 'in' ? fadePixels : params.clipWidthPixels;
	const normalizedCurveX = clampAudioFadeCurveX(params.curveX);
	const absoluteX = startX + (endX - startX) * normalizedCurveX;
	const curveValue =
		params.handle === 'in'
			? evaluateAudioFadeInCurve(normalizedCurveX, params.curve, normalizedCurveX)
			: evaluateAudioFadeOutCurve(normalizedCurveX, params.curve, normalizedCurveX);
	return {
		x: Math.max(Math.min(startX, endX), Math.min(Math.max(startX, endX), absoluteX)),
		y: Math.max(0, Math.min(100, 100 - curveValue * 100))
	};
}

export function getAudioFadeCurvePath(params: {
	handle: FadeHandle;
	fadePixels: number;
	clipWidthPixels: number;
	curve: number | undefined;
	curveX?: number;
}): string {
	const fadePixels = Math.max(0, Math.min(params.fadePixels, params.clipWidthPixels));
	if (fadePixels <= 0) return '';
	const startX = params.handle === 'in' ? 0 : Math.max(0, params.clipWidthPixels - fadePixels);
	const endX = params.handle === 'in' ? fadePixels : params.clipWidthPixels;
	const points: string[] = [];
	for (let index = 0; index <= AUDIO_FADE_CURVE_PATH_SAMPLES; index += 1) {
		const progress = index / AUDIO_FADE_CURVE_PATH_SAMPLES;
		const x = startX + (endX - startX) * progress;
		const curveValue =
			params.handle === 'in'
				? evaluateAudioFadeInCurve(progress, params.curve, params.curveX)
				: evaluateAudioFadeOutCurve(progress, params.curve, params.curveX);
		const y = 100 - curveValue * 100;
		points.push(`${formatPathValue(x)} ${formatPathValue(y)}`);
	}
	if (params.handle === 'in') {
		return `M 0 0 L ${formatPathValue(fadePixels)} 0 L ${points.slice().reverse().join(' L ')} Z`;
	}
	return `M ${formatPathValue(startX)} 0 L ${points.join(' L ')} L ${formatPathValue(params.clipWidthPixels)} 0 Z`;
}

export function getAudioFadeCurveFromOffset(params: {
	handle: FadeHandle;
	pointerOffsetX: number;
	pointerOffsetY: number;
	fadePixels: number;
	clipWidthPixels: number;
	rowHeight: number;
}): CurveBias {
	if (!Number.isFinite(params.rowHeight) || params.rowHeight <= 0 || params.fadePixels <= 0) {
		return { curve: 0, curveX: AUDIO_FADE_CURVE_X_DEFAULT };
	}
	const fadePixels = Math.max(0, Math.min(params.fadePixels, params.clipWidthPixels));
	const startX = params.handle === 'in' ? 0 : Math.max(0, params.clipWidthPixels - fadePixels);
	const endX = params.handle === 'in' ? fadePixels : params.clipWidthPixels;
	const edgeSnapDistance = Math.min(
		AUDIO_FADE_CURVE_EDGE_SNAP_PX,
		Math.max(0, (endX - startX) / 2)
	);
	let curveX: number;
	if (params.pointerOffsetX <= startX + edgeSnapDistance) {
		curveX = AUDIO_FADE_CURVE_X_MIN;
	} else if (params.pointerOffsetX >= endX - edgeSnapDistance) {
		curveX = AUDIO_FADE_CURVE_X_MAX;
	} else {
		curveX = clampAudioFadeCurveX((params.pointerOffsetX - startX) / Math.max(1, endX - startX));
	}
	const edgeDistance = Math.min(curveX, 1 - curveX);
	const edgeDampingRamp = Math.min(1, edgeDistance * 5);
	const edgeDampingExponent = 1 + (1 - edgeDampingRamp) * 2;
	const y = Math.max(0, Math.min(100, (params.pointerOffsetY / params.rowHeight) * 100));
	const startY = params.handle === 'in' ? 100 : 0;
	const endY = params.handle === 'in' ? 0 : 100;
	const linearY = startY + (endY - startY) * curveX;
	if (y <= linearY) {
		const range = Math.max(1, linearY);
		const raw = (linearY - y) / range;
		return { curve: clampAudioFadeCurve(Math.pow(raw, edgeDampingExponent)), curveX };
	}
	const range = Math.max(1, 100 - linearY);
	const raw = (y - linearY) / range;
	return { curve: clampAudioFadeCurve(-Math.pow(raw, edgeDampingExponent)), curveX };
}

export function formatFadeSeconds(seconds: number): string {
	const v = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
	return `${v.toFixed(2)}s`;
}
