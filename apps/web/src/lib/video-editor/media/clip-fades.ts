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
	item: Pick<
		TimelineItem,
		'type' | 'from' | 'durationInFrames' | 'fadeIn' | 'fadeOut' | 'videoFadeOffsets'
	>,
	absoluteFrame: number,
	fps: number
): number {
	if (item.type !== 'video' && item.type !== 'composition') return 1;
	const localFrame = absoluteFrame - item.from;
	if (localFrame < 0 || localFrame >= item.durationInFrames) return 0;
	const duration = item.durationInFrames;
	const relativeFrame = localFrame;
	if (item.videoFadeOffsets) {
		return Math.min(
			edgeGain(localFrame / fps + item.videoFadeOffsets.in, item.fadeIn),
			edgeGain((duration - localFrame) / fps + item.videoFadeOffsets.out, item.fadeOut)
		);
	}
	return linearFadeGain(
		relativeFrame,
		duration,
		safeFadeFrames(item.fadeIn, fps, duration),
		safeFadeFrames(item.fadeOut, fps, duration)
	);
}

export function audioClipFadeGainAtFrame(
	item: Pick<
		TimelineItem,
		| 'from'
		| 'durationInFrames'
		| 'audioFadeOffsets'
		| 'audioFadeIn'
		| 'audioFadeOut'
		| 'audioFadeInCurve'
		| 'audioFadeOutCurve'
		| 'audioFadeInCurveX'
		| 'audioFadeOutCurveX'
	>,
	absoluteFrame: number,
	fps: number,
	options: { includeEnd?: boolean } = {}
): number {
	const localFrame = absoluteFrame - item.from;
	if (
		localFrame < 0 ||
		localFrame > item.durationInFrames ||
		(localFrame === item.durationInFrames && !options.includeEnd)
	)
		return 1;
	const duration = item.durationInFrames;
	const relativeFrame = localFrame;
	if (item.audioFadeOffsets) {
		const into = edgeGain(localFrame / fps + item.audioFadeOffsets.in, item.audioFadeIn);
		const remaining = edgeGain(
			(duration - localFrame) / fps + item.audioFadeOffsets.out,
			item.audioFadeOut
		);
		return Math.min(
			audioFadeInCurveGain(into, item.audioFadeInCurve, item.audioFadeInCurveX),
			audioFadeOutCurveGain(1 - remaining, item.audioFadeOutCurve, item.audioFadeOutCurveX)
		);
	}
	const fadeInFrames = safeFadeFrames(item.audioFadeIn, fps, duration);
	const fadeOutFrames = safeFadeFrames(item.audioFadeOut, fps, duration);
	if (fadeInFrames <= 0 || fadeOutFrames <= 0 || fadeInFrames >= duration - fadeOutFrames) {
		if (fadeInFrames > 0 && fadeOutFrames <= 0 && relativeFrame < fadeInFrames) {
			return audioFadeInCurveGain(
				relativeFrame / fadeInFrames,
				item.audioFadeInCurve,
				item.audioFadeInCurveX
			);
		}
		if (fadeOutFrames > 0 && fadeInFrames <= 0 && relativeFrame > duration - fadeOutFrames) {
			return audioFadeOutCurveGain(
				(relativeFrame - (duration - fadeOutFrames)) / fadeOutFrames,
				item.audioFadeOutCurve,
				item.audioFadeOutCurveX
			);
		}
		return linearFadeGain(relativeFrame, duration, fadeInFrames, fadeOutFrames);
	}
	if (relativeFrame < fadeInFrames) {
		return audioFadeInCurveGain(
			relativeFrame / fadeInFrames,
			item.audioFadeInCurve,
			item.audioFadeInCurveX
		);
	}
	const fadeOutStart = duration - fadeOutFrames;
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

function edgeGain(seconds: number, fadeSeconds: number | undefined): number {
	return fadeSeconds && fadeSeconds > 0 ? clamp01(seconds / fadeSeconds) : 1;
}

/** Preserve the authored envelope when retaining a window of a clip. */
export function sliceClipFades(
	item: TimelineItem,
	start: number,
	end: number,
	fps: number
): Partial<TimelineItem> {
	const patch: Partial<TimelineItem> = {};
	for (const kind of ['video', 'audio'] as const) {
		const inKey = kind === 'video' ? 'fadeIn' : 'audioFadeIn';
		const outKey = kind === 'video' ? 'fadeOut' : 'audioFadeOut';
		const offsetKey = kind === 'video' ? 'videoFadeOffsets' : 'audioFadeOffsets';
		const offsets = item[offsetKey];
		if (!offsets && !item[inKey] && !item[outKey]) continue;
		if (!offsets) {
			let into = safeFadeFrames(item[inKey], fps, item.durationInFrames);
			let out = safeFadeFrames(item[outKey], fps, item.durationInFrames);
			// Legacy overlapping fades form a linear triangle, even for shaped audio.
			if (into > 0 && out > 0 && into >= item.durationInFrames - out) {
				const midpoint = item.durationInFrames / 2;
				const peak = Math.min(1, midpoint / Math.max(into, 1));
				into = out = Math.max(midpoint, 1) / peak;
				if (kind === 'audio') {
					patch.audioFadeInCurve = 0;
					patch.audioFadeOutCurve = 0;
				}
			}
			patch[inKey] = into / fps;
			patch[outKey] = out / fps;
		}
		patch[offsetKey] = {
			in: (offsets?.in ?? 0) + start / fps,
			out: (offsets?.out ?? 0) + (item.durationInFrames - end) / fps
		};
	}
	return patch;
}
