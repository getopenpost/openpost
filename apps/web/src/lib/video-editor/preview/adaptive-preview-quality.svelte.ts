/** Reactive runtime that applies the pure adaptive quality planner to live playback. */
import {
	type AdaptivePreviewQualityState,
	createAdaptivePreviewQualityState,
	previewFrameBudgetMs,
	updateAdaptivePreviewQuality,
	type PreviewRenderScale
} from './adaptive-preview-quality';

interface AdaptivePreviewRuntime {
	adaptive: AdaptivePreviewQualityState;
	lastFrame: { frame: number; atMs: number } | null;
}

const runtime = $state<AdaptivePreviewRuntime>({
	adaptive: createAdaptivePreviewQualityState(),
	lastFrame: null
});

export const adaptivePreviewQuality = {
	get scale(): PreviewRenderScale {
		return runtime.adaptive.qualityCap;
	},
	get frameTimeEmaMs(): number {
		return runtime.adaptive.frameTimeEmaMs;
	},
	recordFrame(frame: number, atMs: number, fps: number, playbackRate: number): void {
		const previous = runtime.lastFrame;
		runtime.lastFrame = { frame, atMs };
		if (!previous || previous.frame === frame || atMs <= previous.atMs) return;
		const frameDelta = Math.max(1, Math.abs(frame - previous.frame));
		const result = updateAdaptivePreviewQuality({
			state: runtime.adaptive,
			sampleMsPerFrame: (atMs - previous.atMs) / frameDelta,
			frameBudgetMs: previewFrameBudgetMs(fps, playbackRate),
			nowMs: atMs
		});
		runtime.adaptive = result.state;
	},
	reset(): void {
		runtime.adaptive = createAdaptivePreviewQualityState();
		runtime.lastFrame = null;
	},
	__setScaleForTesting(scale: PreviewRenderScale): void {
		runtime.adaptive = createAdaptivePreviewQualityState(scale);
	}
};
