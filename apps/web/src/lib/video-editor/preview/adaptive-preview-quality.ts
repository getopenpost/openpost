/** Adaptive preview resolution, derived from FreeCut's MIT-licensed implementation. */

export const PREVIEW_RENDER_SCALES = [0.25, 0.33, 0.5, 1] as const;
export type PreviewRenderScale = (typeof PREVIEW_RENDER_SCALES)[number];

export interface AdaptivePreviewQualityState {
	qualityCap: PreviewRenderScale;
	frameTimeEmaMs: number;
	overBudgetSamples: number;
	underBudgetSamples: number;
	lastQualityChangeAtMs: number;
}

export interface AdaptivePreviewQualityOptions {
	emaAlpha: number;
	degradeThresholdRatio: number;
	recoverThresholdRatio: number;
	degradeSamples: number;
	recoverSamples: number;
	changeCooldownMs: number;
}

export interface AdaptivePreviewQualityResult {
	state: AdaptivePreviewQualityState;
	direction: 'degrade' | 'recover' | null;
}

const DEFAULT_OPTIONS: AdaptivePreviewQualityOptions = {
	emaAlpha: 0.2,
	degradeThresholdRatio: 1.2,
	recoverThresholdRatio: 0.85,
	degradeSamples: 10,
	recoverSamples: 36,
	changeCooldownMs: 1_200
};

export function createAdaptivePreviewQualityState(
	qualityCap: PreviewRenderScale = 1
): AdaptivePreviewQualityState {
	return {
		qualityCap,
		frameTimeEmaMs: 0,
		overBudgetSamples: 0,
		underBudgetSamples: 0,
		lastQualityChangeAtMs: 0
	};
}

export function previewFrameBudgetMs(fps: number, playbackRate: number): number {
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
	return 1_000 / Math.max(1, safeFps * safeRate);
}

function lowerScale(scale: PreviewRenderScale): PreviewRenderScale {
	if (scale === 1) return 0.5;
	if (scale === 0.5) return 0.33;
	return 0.25;
}

function higherScale(scale: PreviewRenderScale): PreviewRenderScale {
	if (scale === 0.25) return 0.33;
	if (scale === 0.33) return 0.5;
	return 1;
}

export function updateAdaptivePreviewQuality(input: {
	state: AdaptivePreviewQualityState;
	sampleMsPerFrame: number;
	frameBudgetMs: number;
	nowMs: number;
	allowRecovery?: boolean;
	options?: Partial<AdaptivePreviewQualityOptions>;
}): AdaptivePreviewQualityResult {
	const options = { ...DEFAULT_OPTIONS, ...input.options };
	const sample = Math.max(0, input.sampleMsPerFrame);
	const ema =
		input.state.frameTimeEmaMs === 0
			? sample
			: input.state.frameTimeEmaMs + (sample - input.state.frameTimeEmaMs) * options.emaAlpha;
	const overThreshold = input.frameBudgetMs * options.degradeThresholdRatio;
	const underThreshold = input.frameBudgetMs * options.recoverThresholdRatio;
	let overBudgetSamples = input.state.overBudgetSamples;
	let underBudgetSamples = input.state.underBudgetSamples;

	if (ema > overThreshold) {
		overBudgetSamples += 1;
		underBudgetSamples = 0;
	} else if (ema < underThreshold) {
		underBudgetSamples += 1;
		overBudgetSamples = 0;
	} else {
		overBudgetSamples = 0;
		underBudgetSamples = 0;
	}

	let qualityCap = input.state.qualityCap;
	let lastQualityChangeAtMs = input.state.lastQualityChangeAtMs;
	let direction: 'degrade' | 'recover' | null = null;
	const canChange = input.nowMs - lastQualityChangeAtMs >= options.changeCooldownMs;

	if (canChange && overBudgetSamples >= options.degradeSamples && qualityCap > 0.25) {
		qualityCap = lowerScale(qualityCap);
		direction = 'degrade';
	} else if (
		(input.allowRecovery ?? true) &&
		canChange &&
		underBudgetSamples >= options.recoverSamples &&
		qualityCap < 1
	) {
		qualityCap = higherScale(qualityCap);
		direction = 'recover';
	}

	if (direction) {
		lastQualityChangeAtMs = input.nowMs;
		overBudgetSamples = 0;
		underBudgetSamples = 0;
	}

	return {
		state: {
			qualityCap,
			frameTimeEmaMs: ema,
			overBudgetSamples,
			underBudgetSamples,
			lastQualityChangeAtMs
		},
		direction
	};
}
