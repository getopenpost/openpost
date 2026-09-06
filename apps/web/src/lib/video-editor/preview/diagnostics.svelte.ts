import { browser } from '$app/environment';
import {
	buildPreviewDiagnosticReport,
	emptyPreviewFrameSampleState,
	previewHealth,
	recordPreviewFrameSample,
	type PreviewDiagnosticSnapshot,
	type PreviewRenderPath
} from './diagnostics';

const STORAGE_KEY = 'openpost-video-editor-diagnostics';

interface StoredDiagnosticSettings {
	performanceOverlay?: boolean;
	clipTimingOverlay?: boolean;
}

function readStoredSettings(): StoredDiagnosticSettings {
	if (!browser) return {};
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		if (!parsed || typeof parsed !== 'object') return {};
		return {
			performanceOverlay:
				'performanceOverlay' in parsed && typeof parsed.performanceOverlay === 'boolean'
					? parsed.performanceOverlay
					: undefined,
			clipTimingOverlay:
				'clipTimingOverlay' in parsed && typeof parsed.clipTimingOverlay === 'boolean'
					? parsed.clipTimingOverlay
					: undefined
		};
	} catch {
		return {};
	}
}

const stored = readStoredSettings();
const overlays = $state({
	performance: stored.performanceOverlay ?? false,
	clipTiming: stored.clipTimingOverlay ?? false
});
let frameSamples = $state(emptyPreviewFrameSampleState());

interface PreviewRuntimeState {
	playing: boolean;
	targetFps: number;
	playbackRate: number;
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

const runtime: PreviewRuntimeState = $state({
	playing: false,
	targetFps: 30,
	playbackRate: 1,
	renderPath: 'direct',
	renderTimeMs: null,
	renderWidth: 0,
	renderHeight: 0,
	activeLayers: 0,
	qualityMode: 'auto',
	qualityScale: 1,
	readyProxies: 0,
	pendingProxies: 0,
	webgl2Ready: false,
	webgpuTransitionsReady: false,
	lastFallback: null
});

function persist(): void {
	if (!browser) return;
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				performanceOverlay: overlays.performance,
				clipTimingOverlay: overlays.clipTiming
			})
		);
	} catch {
		// Overlays still work for this session when storage is blocked.
	}
}

function snapshot(): PreviewDiagnosticSnapshot {
	return {
		...runtime,
		frameTimeEmaMs: frameSamples.frameTimeEmaMs,
		frameBudgetMs: frameSamples.frameBudgetMs,
		samples: frameSamples.samples,
		skippedFrames: frameSamples.skippedFrames
	};
}

export const previewDiagnostics = {
	get performanceOverlay(): boolean {
		return overlays.performance;
	},
	get clipTimingOverlay(): boolean {
		return overlays.clipTiming;
	},
	get snapshot(): PreviewDiagnosticSnapshot {
		return snapshot();
	},
	get health() {
		return previewHealth(snapshot());
	},
	setPerformanceOverlay(enabled: boolean): void {
		overlays.performance = enabled;
		persist();
	},
	setClipTimingOverlay(enabled: boolean): void {
		overlays.clipTiming = enabled;
		persist();
	},
	setPlaying(playing: boolean): void {
		runtime.playing = playing;
		if (!playing) {
			frameSamples.lastFrame = null;
			frameSamples.lastAtMs = null;
		}
	},
	recordFrame(frame: number, atMs: number, fps: number, playbackRate: number): void {
		runtime.targetFps = fps;
		runtime.playbackRate = playbackRate;
		frameSamples = recordPreviewFrameSample(frameSamples, { frame, atMs, fps, playbackRate });
	},
	recordRender(renderTimeMs: number | null, fallback: string | null): void {
		runtime.renderTimeMs = renderTimeMs;
		runtime.lastFallback = fallback;
	},
	setGpuStatus(webgl2Ready: boolean, webgpuTransitionsReady: boolean): void {
		runtime.webgl2Ready = webgl2Ready;
		runtime.webgpuTransitionsReady = webgpuTransitionsReady;
	},
	updateRuntime(input: {
		renderPath: PreviewRenderPath;
		renderWidth: number;
		renderHeight: number;
		activeLayers: number;
		qualityMode: 'auto' | 'full';
		qualityScale: number;
		readyProxies: number;
		pendingProxies: number;
		webgl2Ready: boolean;
		webgpuTransitionsReady: boolean;
	}): void {
		Object.assign(runtime, input);
	},
	resetCounters(): void {
		frameSamples = emptyPreviewFrameSampleState();
		runtime.renderTimeMs = null;
		runtime.lastFallback = null;
	},
	report(): string {
		return buildPreviewDiagnosticReport(snapshot());
	}
};
