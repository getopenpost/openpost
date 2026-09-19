import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import {
	getWaveform,
	cachedWaveform,
	subscribeWaveform
} from '$lib/video-editor/media/waveform-client';
import type { WaveformData } from '$lib/video-editor/media/waveform-client';
import { planTimelineWaveformDemand } from '$lib/video-editor/timeline/waveform-demand';
import {
	TIMELINE_WAVEFORM_HEIGHT,
	mappedTimelineWaveformSourceBoundaries,
	planTimelineWaveformRenderWindow,
	waveformPolyline
} from '$lib/video-editor/timeline/waveform-render-window';
import { peaksForMappedWindow, peaksForWindow } from '$lib/video-editor/media/peaks';
import { filmstripCache, type FilmstripFrame } from '$lib/video-editor/media/filmstrip-client';
import {
	animatedImageCache,
	type AnimatedImageFrames
} from '$lib/video-editor/media/animated-image-client';
import {
	computeAnimatedImageTiles,
	isAnimatedImageMedia
} from '$lib/video-editor/media/animated-image-plan';
import {
	computeFilmstripTiles,
	visibleFilmstripTargetIndices
} from '$lib/video-editor/media/filmstrip-plan';
import {
	hasVariableSpeed,
	timelineOffsetToSourceFrame
} from '$lib/video-editor/timeline/source-time-map';
import { buildTimelineItemRangeIndex } from '$lib/video-editor/timeline/timeline-viewport';
import type { TimelineItem } from '$lib/video-editor/project/types';

export const FILMSTRIP_TILE_WIDTH_PX = 96;
export const FILMSTRIP_OVERSCAN_PX = FILMSTRIP_TILE_WIDTH_PX * 2;
const WAVEFORM_DEMAND_DELAY_MS = 90;

export interface TimelineMediaTilesInput {
	viewport: () => { scrollLeft: number; width: number };
	pxPerFrame: () => number;
	fps: () => number;
	visibleItemIds: () => Set<string>;
	frameToPx: (frame: number) => number;
	headerWidth: number;
}

/**
 * Media tile data layer for the timeline: waveforms, filmstrips and animated
 * image previews. Owns subscription state, demand scheduling and tile
 * computation; the panel keeps thin $effects that call sync*() so reactivity
 * wiring stays at the seam.
 */
export class TimelineMediaTiles {
	waveforms = $state<Record<string, { data: WaveformData | null; failed: boolean }>>({});
	private waveformUnsubscribers = new Map<string, () => void>();
	private waveformRenderCache = new Map<
		string,
		{
			peaks: Float32Array;
			loadedSamples: number;
			isComplete: boolean;
			key: string;
			value: {
				points: string;
				leftPx: number;
				widthPx: number;
				clipWidthPx: number;
			};
		}
	>();
	private waveformItemRangeIndex = $derived(
		buildTimelineItemRangeIndex(
			timelineStore.items.filter(
				(item) => (item.type === 'video' || item.type === 'audio') && Boolean(item.mediaId)
			)
		)
	);
	private waveformDemandTimer: ReturnType<typeof setTimeout> | null = null;
	private previousWaveformScrollLeft = 0;

	filmstrips = $state<Record<string, { frames: FilmstripFrame[]; failed: boolean }>>({});
	private filmstripUnsubscribers = new Map<string, () => void>();

	animatedImages = $state<Record<string, { frames: AnimatedImageFrames | null; failed: boolean }>>(
		{}
	);
	private animatedImageUnsubscribers = new Map<string, () => void>();
	constructor(private readonly input: TimelineMediaTilesInput) {}
	syncWaveformDemand(): void | (() => void) {
		this.clearWaveformDemandTimer();
		if (!editorSettings.showWaveforms) {
			this.clearWaveformSubscriptions();
			return;
		}
		const currentScrollLeft = this.input.viewport().scrollLeft;
		const mediaIds = planTimelineWaveformDemand({
			itemIndex: this.waveformItemRangeIndex,
			scrollLeft: currentScrollLeft,
			previousScrollLeft: this.previousWaveformScrollLeft,
			viewportWidth: this.input.viewport().width,
			headerWidth: this.input.headerWidth,
			pixelsPerFrame: this.input.pxPerFrame()
		});
		this.previousWaveformScrollLeft = currentScrollLeft;
		if (this.input.viewport().width <= this.input.headerWidth) return;
		this.waveformDemandTimer = setTimeout(() => {
			this.waveformDemandTimer = null;
			this.reconcileWaveformDemand(mediaIds);
		}, WAVEFORM_DEMAND_DELAY_MS);
		return () => this.clearWaveformDemandTimer();
	}
	pruneWaveformRenderCache(itemIds: Set<string>): void {
		for (const itemId of this.waveformRenderCache.keys()) {
			if (!itemIds.has(itemId)) this.waveformRenderCache.delete(itemId);
		}
	}
	private reconcileWaveformDemand(mediaIds: readonly string[]): void {
		const neededMediaIds = new Set(mediaIds);
		for (const [mediaId, unsubscribe] of this.waveformUnsubscribers) {
			if (neededMediaIds.has(mediaId)) continue;
			unsubscribe();
			this.waveformUnsubscribers.delete(mediaId);
			delete this.waveforms[mediaId];
		}

		for (const mediaId of mediaIds) {
			const media = mediaPool.get(mediaId);
			const hasAudio =
				media?.audioCodecSupported !== false &&
				(media?.tags.includes('audio') || Boolean(media?.audioCodec));
			if (!media || !hasAudio || this.waveformUnsubscribers.has(mediaId)) continue;
			this.waveforms[mediaId] = { data: null, failed: false };
			this.waveformUnsubscribers.set(
				mediaId,
				subscribeWaveform(mediaId, (data) => {
					this.waveforms[mediaId] = { data, failed: false };
				})
			);
			void getWaveform(media)
				.then((data) => {
					if (!this.waveformUnsubscribers.has(mediaId)) return;
					this.waveforms[mediaId] = { data, failed: false };
				})
				.catch(() => {
					if (!this.waveformUnsubscribers.has(mediaId)) return;
					this.waveforms[mediaId] = { data: null, failed: true };
				});
		}
	}
	timelineWaveform(item: TimelineItem): {
		points: string;
		leftPx: number;
		widthPx: number;
		clipWidthPx: number;
	} | null {
		if (!item.mediaId) return null;
		const entry = this.waveforms[item.mediaId];
		const data = entry?.data ?? cachedWaveform(item.mediaId);
		if (!data) return null;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : this.input.fps();
		const sourceStart = item.sourceStart ?? 0;
		const sourceEnd =
			item.sourceEnd ??
			sourceStart + (item.durationInFrames / this.input.fps()) * (item.speed ?? 1) * sourceFps;
		const variableSpeed = hasVariableSpeed(item);
		const window = planTimelineWaveformRenderWindow({
			clipFromFrame: item.from,
			clipDurationFrames: item.durationInFrames,
			sourceStartFrame: sourceStart,
			sourceEndFrame: sourceEnd,
			pixelsPerFrame: this.input.pxPerFrame(),
			scrollLeft: this.input.viewport().scrollLeft,
			viewportWidth: this.input.viewport().width,
			headerWidth: this.input.headerWidth,
			reversed: item.isReversed === true
		});
		if (!window) return null;
		const renderKey = [
			window.leftPx,
			window.widthPx,
			window.startSourceFrame,
			window.endSourceFrame,
			sourceFps,
			window.reverseColumns,
			...(variableSpeed
				? (item.speedRamp ?? []).flatMap((point) => [point.sourceFrame, point.speed, point.easing])
				: [])
		].join(':');
		const cached = this.waveformRenderCache.get(item.id);
		if (
			cached?.peaks === data.peaks &&
			cached.loadedSamples === data.loadedSamples &&
			cached.isComplete === data.isComplete &&
			cached.key === renderKey
		)
			return cached.value;
		const columns = variableSpeed
			? peaksForMappedWindow(
					data,
					mappedTimelineWaveformSourceBoundaries({
						window,
						clipDurationFrames: item.durationInFrames,
						sourceFrameAtTimelineOffset: (timelineOffset) =>
							timelineOffsetToSourceFrame(item, timelineOffset, this.input.fps()) +
							(item.isReversed ? 1 : 0)
					}),
					sourceFps
				)
			: peaksForWindow(
					data,
					window.startSourceFrame,
					window.endSourceFrame,
					sourceFps,
					window.widthPx
				);
		const value = {
			points: waveformPolyline(
				columns,
				TIMELINE_WAVEFORM_HEIGHT,
				variableSpeed ? false : window.reverseColumns
			),
			leftPx: window.leftPx,
			widthPx: window.widthPx,
			clipWidthPx: window.clipWidthPx
		};
		this.waveformRenderCache.set(item.id, {
			peaks: data.peaks,
			loadedSamples: data.loadedSamples,
			isComplete: data.isComplete,
			key: renderKey,
			value
		});
		return value;
	}
	syncFilmstrips(): void {
		if (!editorSettings.showFilmstrips) {
			for (const [mediaId, unsubscribe] of this.filmstripUnsubscribers) {
				unsubscribe();
				filmstripCache.abort(mediaId);
			}
			this.filmstripUnsubscribers.clear();
			for (const mediaId of Object.keys(this.filmstrips)) delete this.filmstrips[mediaId];
			return;
		}
		if (this.input.viewport().width <= 0) return;
		const collected = this.collectVisibleFilmstripTargets();
		this.pruneStaleFilmstripSubscriptions(collected.visibleMedia);
		this.ensureFilmstripSubscriptions(collected.visibleMedia, collected.visibleTargets);
	}

	private collectVisibleFilmstripTargets() {
		const visibleTargets = new Map<string, Set<number>>();
		const visibleMedia = new Map<string, NonNullable<ReturnType<typeof mediaPool.get>>>();
		const viewportStart = this.input.viewport().scrollLeft + this.input.headerWidth;
		const viewportEnd = this.input.viewport().scrollLeft + this.input.viewport().width;
		for (const itemId of this.input.visibleItemIds()) {
			const item = timelineStore.itemById.get(itemId);
			if (!item) continue;
			if (item.type !== 'video' || !item.mediaId) continue;
			const mediaId = item.mediaId;
			const media = mediaPool.get(mediaId);
			if (!media?.tags.includes('video')) continue;
			const clipLeft = this.input.headerWidth + this.input.frameToPx(item.from);
			const clipWidth = this.input.frameToPx(item.durationInFrames);
			const visibleStartPx = Math.max(0, viewportStart - clipLeft - FILMSTRIP_OVERSCAN_PX);
			const visibleEndPx = Math.min(clipWidth, viewportEnd - clipLeft + FILMSTRIP_OVERSCAN_PX);
			if (visibleEndPx <= visibleStartPx) continue;
			const sourceFps =
				item.sourceFps && item.sourceFps > 0 ? item.sourceFps : Math.max(1, this.input.fps());
			const sourceStartSeconds = (item.sourceStart ?? 0) / sourceFps;
			const clipSpanSeconds =
				item.sourceEnd !== undefined
					? Math.max(0, item.sourceEnd - (item.sourceStart ?? 0)) / sourceFps
					: (item.durationInFrames / this.input.fps()) * (item.speed ?? 1);
			const sourceSecondAtTimelineRatio = hasVariableSpeed(item)
				? (ratio: number) =>
						timelineOffsetToSourceFrame(item, ratio * item.durationInFrames, this.input.fps()) /
						sourceFps
				: undefined;
			const targets = visibleFilmstripTargetIndices({
				sourceStartSeconds,
				clipSpanSeconds,
				clipWidthPx: clipWidth,
				visibleStartPx,
				visibleEndPx,
				tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
				totalSourceFrames: Math.max(1, Math.ceil(media.duration)),
				reversed: item.isReversed,
				sourceSecondAtTimelineRatio
			});
			if (targets.length === 0) continue;
			visibleMedia.set(mediaId, media);
			const merged = visibleTargets.get(mediaId) ?? new Set<number>();
			for (const target of targets) merged.add(target);
			visibleTargets.set(mediaId, merged);
		}
		return { visibleTargets, visibleMedia };
	}

	private pruneStaleFilmstripSubscriptions(
		visibleMedia: Map<string, NonNullable<ReturnType<typeof mediaPool.get>>>
	): void {
		for (const [mediaId, unsubscribe] of this.filmstripUnsubscribers) {
			if (visibleMedia.has(mediaId)) continue;
			unsubscribe();
			this.filmstripUnsubscribers.delete(mediaId);
			filmstripCache.abort(mediaId);
			delete this.filmstrips[mediaId];
		}
	}

	private ensureFilmstripSubscriptions(
		visibleMedia: Map<string, NonNullable<ReturnType<typeof mediaPool.get>>>,
		visibleTargets: Map<string, Set<number>>
	): void {
		for (const [mediaId, media] of visibleMedia) {
			if (!this.filmstripUnsubscribers.has(mediaId)) {
				this.filmstrips[mediaId] = { frames: [], failed: false };
				this.filmstripUnsubscribers.set(
					mediaId,
					filmstripCache.subscribe(mediaId, (filmstrip) => {
						this.filmstrips[mediaId] = {
							frames: filmstrip.frames.map((frame) => ({ ...frame })),
							failed: false
						};
					})
				);
			}
			filmstripCache
				.getFilmstrip(media, {
					targetFrameIndices: [...(visibleTargets.get(mediaId) ?? [])],
					allowExtraction: editorSettings.extractFilmstrips
				})
				.catch((error: Error) => {
					if (error instanceof DOMException && error.name === 'AbortError') return;
					if (!this.filmstripUnsubscribers.has(mediaId)) return;
					this.filmstrips[mediaId] = {
						frames: this.filmstrips[mediaId]?.frames ?? [],
						failed: true
					};
				});
		}
	}
	/** Shared viewport span math for per-item tile computation. */
	private itemViewportSpan(item: Pick<TimelineItem, 'from' | 'durationInFrames'>) {
		const clipWidth = this.input.frameToPx(item.durationInFrames);
		const clipLeft = this.input.headerWidth + this.input.frameToPx(item.from);
		const viewportStart = this.input.viewport().scrollLeft + this.input.headerWidth;
		const viewportEnd = this.input.viewport().scrollLeft + this.input.viewport().width;
		return { clipLeft, clipWidth, viewportStart, viewportEnd };
	}

	filmstripTilesFor(item: TimelineItem): ReturnType<typeof computeFilmstripTiles> | null {
		if (!item.mediaId) return null;
		const entry = this.filmstrips[item.mediaId];
		if (!entry || entry.failed || entry.frames.length === 0) return null;
		const sourceFps =
			item.sourceFps && item.sourceFps > 0 ? item.sourceFps : Math.max(1, this.input.fps());
		const startSeconds = (item.sourceStart ?? 0) / sourceFps;
		const spanSeconds =
			item.sourceEnd !== undefined
				? Math.max(0, item.sourceEnd - (item.sourceStart ?? 0)) / sourceFps
				: (item.durationInFrames / this.input.fps()) * (item.speed ?? 1);
		if (!(spanSeconds > 0)) return null;
		const { clipLeft, clipWidth, viewportStart, viewportEnd } = this.itemViewportSpan(item);
		const visibleStartPx = Math.max(0, viewportStart - clipLeft - FILMSTRIP_OVERSCAN_PX);
		const visibleEndPx = Math.min(clipWidth, viewportEnd - clipLeft + FILMSTRIP_OVERSCAN_PX);
		if (visibleEndPx <= visibleStartPx) return null;
		return computeFilmstripTiles(
			entry.frames,
			startSeconds,
			spanSeconds,
			clipWidth,
			item.isReversed,
			{
				tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
				visibleStartPx,
				visibleEndPx,
				sourceSecondAtTimelineRatio: hasVariableSpeed(item)
					? (ratio: number) =>
							timelineOffsetToSourceFrame(item, ratio * item.durationInFrames, this.input.fps()) /
							sourceFps
					: undefined
			}
		);
	}
	filmstripBitmapFor(mediaId: string | undefined, index: number): ImageBitmap | undefined {
		if (!mediaId) return undefined;
		return this.filmstrips[mediaId]?.frames.find((frame) => frame.index === index)?.bitmap;
	}
	syncAnimatedImages(): void {
		if (!editorSettings.showFilmstrips || !editorSettings.extractFilmstrips) {
			for (const [, unsubscribe] of this.animatedImageUnsubscribers) {
				unsubscribe();
			}
			this.animatedImageUnsubscribers.clear();
			for (const mediaId of Object.keys(this.animatedImages)) delete this.animatedImages[mediaId];
			return;
		}
		const visibleAnimatedMedia = new Map<string, NonNullable<ReturnType<typeof mediaPool.get>>>();
		for (const itemId of this.input.visibleItemIds()) {
			const item = timelineStore.itemById.get(itemId);
			if (!item) continue;
			if (item.type !== 'image' || !item.mediaId) continue;
			const media = mediaPool.get(item.mediaId);
			if (!isAnimatedImageMedia(media)) continue;
			// SAFETY: isAnimatedImageMedia just proved the entry exists.
			visibleAnimatedMedia.set(item.mediaId, media!);
		}
		for (const [mediaId, unsubscribe] of this.animatedImageUnsubscribers) {
			if (visibleAnimatedMedia.has(mediaId)) continue;
			unsubscribe();
			this.animatedImageUnsubscribers.delete(mediaId);
			delete this.animatedImages[mediaId];
		}
		for (const [mediaId, media] of visibleAnimatedMedia) {
			if (!this.animatedImageUnsubscribers.has(mediaId)) {
				this.animatedImages[mediaId] = { frames: null, failed: false };
				this.animatedImageUnsubscribers.set(
					mediaId,
					animatedImageCache.subscribe(mediaId, (frames) => {
						this.animatedImages[mediaId] = { frames, failed: false };
					})
				);
			}
			void animatedImageCache.getAnimatedImage(media).catch(() => {
				if (!this.animatedImageUnsubscribers.has(mediaId)) return;
				this.animatedImages[mediaId] = { frames: null, failed: true };
			});
		}
	}
	animatedImageTilesFor(item: {
		from: number;
		mediaId?: string;
		speed?: number;
		isReversed?: boolean;
		durationInFrames: number;
	}): ReturnType<typeof computeAnimatedImageTiles> | null {
		if (!item.mediaId) return null;
		const entry = this.animatedImages[item.mediaId];
		const framesData = entry?.frames;
		if (entry?.failed || !framesData?.isComplete) return null;
		const { clipLeft, clipWidth, viewportStart, viewportEnd } = this.itemViewportSpan(item);
		if (!(clipWidth > 0)) return null;
		const visibleStartPx = Math.max(0, viewportStart - clipLeft - FILMSTRIP_OVERSCAN_PX);
		const visibleEndPx = Math.min(clipWidth, viewportEnd - clipLeft + FILMSTRIP_OVERSCAN_PX);
		return computeAnimatedImageTiles({
			cumulativeDelaysMs: framesData.cumulativeDelaysMs,
			totalDurationMs: framesData.totalDurationMs,
			clipSpanSeconds: item.durationInFrames / this.input.fps(),
			speed: item.speed ?? 1,
			reversed: item.isReversed === true,
			clipWidthPx: clipWidth,
			tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
			visibleStartPx,
			visibleEndPx
		});
	}
	animatedImageBitmapFor(mediaId: string | undefined, index: number): ImageBitmap | undefined {
		if (!mediaId) return undefined;
		return this.animatedImages[mediaId]?.frames?.frames[index];
	}
	dispose(): void {
		for (const unsubscribe of this.filmstripUnsubscribers.values()) unsubscribe();
		this.clearWaveformDemandTimer();
		this.clearWaveformSubscriptions();
	}
	private clearWaveformDemandTimer(): void {
		if (this.waveformDemandTimer === null) return;
		clearTimeout(this.waveformDemandTimer);
		this.waveformDemandTimer = null;
	}
	private clearWaveformSubscriptions(): void {
		for (const unsubscribe of this.waveformUnsubscribers.values()) unsubscribe();
		this.waveformUnsubscribers.clear();
		this.waveformRenderCache.clear();
		for (const mediaId of Object.keys(this.waveforms)) delete this.waveforms[mediaId];
	}
}
