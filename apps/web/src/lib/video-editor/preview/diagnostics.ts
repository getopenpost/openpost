export type PreviewRenderPath = 'direct' | 'composited';

export interface PreviewFrameSampleState {
	lastFrame: number | null;
	lastAtMs: number | null;
	frameTimeEmaMs: number;
	frameBudgetMs: number;
	samples: number;
	skippedFrames: number;
}

export interface PreviewFrameSampleInput {
	frame: number;
	atMs: number;
	fps: number;
	playbackRate: number;
}

export interface PreviewDiagnosticSnapshot {
	playing: boolean;
	targetFps: number;
	playbackRate: number;
	frameTimeEmaMs: number;
	frameBudgetMs: number;
	samples: number;
	skippedFrames: number;
	renderPath: PreviewRenderPath;
	renderTimeMs: number | null;
	renderWidth: number;
	renderHeight: number;
	activeLayers: number;
	qualityMode: 'auto' | 'full';
	qualityScale: number;
	readyProxies: number;
	pendingProxies: number;
	webgl2Ready: boolean;
	webgpuTransitionsReady: boolean;
	lastFallback: string | null;
}

export type PreviewHealth = 'waiting' | 'smooth' | 'reduced' | 'under-load';

export function emptyPreviewFrameSampleState(): PreviewFrameSampleState {
	return {
		lastFrame: null,
		lastAtMs: null,
		frameTimeEmaMs: 0,
		frameBudgetMs: 1000 / 30,
		samples: 0,
		skippedFrames: 0
	};
}

export function recordPreviewFrameSample(
	state: PreviewFrameSampleState,
	input: PreviewFrameSampleInput
): PreviewFrameSampleState {
	const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
	const playbackRate =
		Number.isFinite(input.playbackRate) && input.playbackRate > 0 ? input.playbackRate : 1;
	const frameBudgetMs = 1000 / (fps * playbackRate);
	const nextAnchor = {
		...state,
		lastFrame: input.frame,
		lastAtMs: input.atMs,
		frameBudgetMs
	};
	if (state.lastFrame === null || state.lastAtMs === null) return nextAnchor;

	const frameDelta = input.frame - state.lastFrame;
	const elapsedMs = input.atMs - state.lastAtMs;
	// A seek, loop wrap, hidden-tab catch-up, or stale clock sample starts a new window.
	if (frameDelta <= 0 || elapsedMs <= 0 || elapsedMs > 1_000) return nextAnchor;

	const sampleMsPerFrame = elapsedMs / frameDelta;
	const frameTimeEmaMs =
		state.samples === 0
			? sampleMsPerFrame
			: state.frameTimeEmaMs + (sampleMsPerFrame - state.frameTimeEmaMs) * 0.2;
	return {
		...nextAnchor,
		frameTimeEmaMs,
		samples: state.samples + 1,
		skippedFrames: state.skippedFrames + Math.max(0, frameDelta - 1)
	};
}

export function previewHealth(snapshot: PreviewDiagnosticSnapshot): PreviewHealth {
	if (!snapshot.playing || snapshot.samples === 0) return 'waiting';
	if (snapshot.frameTimeEmaMs > snapshot.frameBudgetMs * 1.2) return 'under-load';
	if (snapshot.qualityMode === 'auto' && snapshot.qualityScale < 1) return 'reduced';
	return 'smooth';
}

export function buildPreviewDiagnosticReport(snapshot: PreviewDiagnosticSnapshot): string {
	return JSON.stringify(
		{
			version: 1,
			preview: {
				playing: snapshot.playing,
				targetFps: snapshot.targetFps,
				playbackRate: snapshot.playbackRate,
				frameTimeMs: Number(snapshot.frameTimeEmaMs.toFixed(2)),
				frameBudgetMs: Number(snapshot.frameBudgetMs.toFixed(2)),
				sampleCount: snapshot.samples,
				skippedFrames: snapshot.skippedFrames,
				qualityMode: snapshot.qualityMode,
				qualityScale: snapshot.qualityScale
			},
			renderer: {
				path: snapshot.renderPath,
				renderTimeMs:
					snapshot.renderTimeMs === null ? null : Number(snapshot.renderTimeMs.toFixed(2)),
				width: snapshot.renderWidth,
				height: snapshot.renderHeight,
				activeLayers: snapshot.activeLayers,
				webgl2Ready: snapshot.webgl2Ready,
				webgpuTransitionsReady: snapshot.webgpuTransitionsReady,
				lastFallback: snapshot.lastFallback
			},
			media: {
				readyProxies: snapshot.readyProxies,
				pendingProxies: snapshot.pendingProxies
			}
		},
		null,
		2
	);
}
