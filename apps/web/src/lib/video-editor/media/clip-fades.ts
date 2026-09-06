/** Shared clip fade math for preview and rendered export. */

import type { TimelineItem } from '../project/types';

export const AUDIO_FADE_CURVE_X_DEFAULT = 0.52;
const AUDIO_FADE_CURVE_X_MIN = 0.04;
const AUDIO_FADE_CURVE_X_MAX = 0.96;
const SOLVE_EPSILON = 0.0001;
const MAX_EXPONENT = 12;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function safeFadeFrames(seconds: number | undefined, fps: number, duration: number): number {
	if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0 || duration <= 0) return 0;
	return Math.min(duration, Math.max(0, (seconds ?? 0) * fps));
}

function linearFadeGain(
	relativeFrame: number,
	duration: number,
	fadeInFrames: number,
	fadeOutFrames: number
): number {
	const hasFadeIn = fadeInFrames > 0;
	const hasFadeOut = fadeOutFrames > 0;
	if (!hasFadeIn && !hasFadeOut) return 1;
	const fadeOutStart = duration - fadeOutFrames;

	if (hasFadeIn && hasFadeOut) {
		if (fadeInFrames >= fadeOutStart) {
			const midpoint = duration / 2;
			const peak = Math.min(1, midpoint / Math.max(fadeInFrames, 1));
			if (relativeFrame <= midpoint) {
				return clamp01((relativeFrame / Math.max(midpoint, 1)) * peak);
			}
			return clamp01(((duration - relativeFrame) / Math.max(duration - midpoint, 1)) * peak);
		}
		if (relativeFrame < fadeInFrames) return clamp01(relativeFrame / fadeInFrames);
		if (relativeFrame < fadeOutStart) return 1;
		return clamp01((duration - relativeFrame) / Math.max(fadeOutFrames, 1));
	}
	if (hasFadeIn) return clamp01(relativeFrame / fadeInFrames);
	if (relativeFrame <= fadeOutStart) return 1;
	return clamp01((duration - relativeFrame) / Math.max(fadeOutFrames, 1));
}

function clampCurve(value: number | undefined): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(-1, Math.round((value ?? 0) * 100) / 100));
}

function clampCurveX(value: number | undefined): number {
	if (!Number.isFinite(value)) return AUDIO_FADE_CURVE_X_DEFAULT;
	return Math.min(
		AUDIO_FADE_CURVE_X_MAX,
		Math.max(AUDIO_FADE_CURVE_X_MIN, Math.round((value ?? 0) * 1000) / 1000)
	);
}

function solveExponent(base: number, target: number): number {
	const safeBase = Math.min(1 - SOLVE_EPSILON, Math.max(SOLVE_EPSILON, base));
	const safeTarget = Math.min(1 - SOLVE_EPSILON, Math.max(SOLVE_EPSILON, target));
	const exponent = Math.log(safeTarget) / Math.log(safeBase);
	return Number.isFinite(exponent) ? Math.min(MAX_EXPONENT, Math.max(1, exponent)) : MAX_EXPONENT;
}

export function audioFadeInCurveGain(
	progress: number,
	curve: number | undefined,
	curveX: number | undefined
): number {
	const x = clampCurveX(curveX);
	const shape = clampCurve(curve);
	const y = shape >= 0 ? x + shape * (1 - x) : x + shape * x;
	const normalized = clamp01(progress);
	if (Math.abs(y - x) <= SOLVE_EPSILON) return normalized;
	if (y > x) return 1 - Math.pow(1 - normalized, solveExponent(1 - x, 1 - y));
	return Math.pow(normalized, solveExponent(x, y));
}

export function audioFadeOutCurveGain(
	progress: number,
	curve: number | undefined,
	curveX: number | undefined
): number {
	const x = clampCurveX(curveX);
	const shape = clampCurve(curve);
	const linearY = 1 - x;
	const y = shape >= 0 ? linearY + shape * (1 - linearY) : linearY + shape * linearY;
	const normalized = clamp01(progress);
	if (Math.abs(y - linearY) <= SOLVE_EPSILON) return 1 - normalized;
	if (y > linearY) return 1 - Math.pow(normalized, solveExponent(x, 1 - y));
	return Math.pow(1 - normalized, solveExponent(1 - x, y));
}

export function visualClipFadeOpacityAtFrame(
	item: Pick<TimelineItem, 'type' | 'from' | 'durationInFrames' | 'fadeIn' | 'fadeOut'>,
	absoluteFrame: number,
	fps: number
): number {
	if (item.type !== 'video' && item.type !== 'composition') return 1;
	const relativeFrame = absoluteFrame - item.from;
	if (relativeFrame < 0 || relativeFrame >= item.durationInFrames) return 0;
	return linearFadeGain(
		relativeFrame,
		item.durationInFrames,
		safeFadeFrames(item.fadeIn, fps, item.durationInFrames),
		safeFadeFrames(item.fadeOut, fps, item.durationInFrames)
	);
}

export function audioClipFadeGainAtFrame(
	item: Pick<
		TimelineItem,
		| 'from'
		| 'durationInFrames'
		| 'audioFadeIn'
		| 'audioFadeOut'
		| 'audioFadeInCurve'
		| 'audioFadeOutCurve'
		| 'audioFadeInCurveX'
		| 'audioFadeOutCurveX'
	>,
	absoluteFrame: number,
	fps: number
): number {
	const relativeFrame = absoluteFrame - item.from;
	if (relativeFrame < 0 || relativeFrame >= item.durationInFrames) return 1;
	const fadeInFrames = safeFadeFrames(item.audioFadeIn, fps, item.durationInFrames);
	const fadeOutFrames = safeFadeFrames(item.audioFadeOut, fps, item.durationInFrames);
	if (
		fadeInFrames <= 0 ||
		fadeOutFrames <= 0 ||
		fadeInFrames >= item.durationInFrames - fadeOutFrames
	) {
		if (fadeInFrames > 0 && fadeOutFrames <= 0 && relativeFrame < fadeInFrames) {
			return audioFadeInCurveGain(
				relativeFrame / fadeInFrames,
				item.audioFadeInCurve,
				item.audioFadeInCurveX
			);
		}
		if (
			fadeOutFrames > 0 &&
			fadeInFrames <= 0 &&
			relativeFrame > item.durationInFrames - fadeOutFrames
		) {
			return audioFadeOutCurveGain(
				(relativeFrame - (item.durationInFrames - fadeOutFrames)) / fadeOutFrames,
				item.audioFadeOutCurve,
				item.audioFadeOutCurveX
			);
		}
		return linearFadeGain(relativeFrame, item.durationInFrames, fadeInFrames, fadeOutFrames);
	}
	if (relativeFrame < fadeInFrames) {
		return audioFadeInCurveGain(
			relativeFrame / fadeInFrames,
			item.audioFadeInCurve,
			item.audioFadeInCurveX
		);
	}
	const fadeOutStart = item.durationInFrames - fadeOutFrames;
	if (relativeFrame > fadeOutStart) {
		return audioFadeOutCurveGain(
			(relativeFrame - fadeOutStart) / fadeOutFrames,
			item.audioFadeOutCurve,
			item.audioFadeOutCurveX
		);
	}
	return 1;
}

export function linearGainToDb(gain: number): number {
	if (!Number.isFinite(gain) || gain <= 0) return -60;
	return Math.min(12, Math.max(-60, 20 * Math.log10(gain)));
}

export function dbToLinearGain(db: number): number {
	if (!Number.isFinite(db)) return 1;
	return Math.pow(10, Math.min(12, Math.max(-60, db)) / 20);
}
