<!-- One frame-synced visual layer in the composited editor preview. -->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { CropSettings, ItemTransform, TimelineItem } from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { effectsToCssFilter } from '$lib/video-editor/effects/filter';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
	import { frameToSourceSeconds } from '$lib/video-editor/media/render-plan';
	import {
		audioClipFadeGainAtFrame,
		visualClipFadeOpacityAtFrame
	} from '$lib/video-editor/media/clip-fades';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		conformReversePreview,
		reverseConformObjectUrl,
		sourceSecondsToReverseConformSeconds,
		type ReverseConformResult
	} from '$lib/video-editor/media/reverse-conform-service';
	import {
		createGpuCompositor,
		type GpuCompositor,
		type GpuRenderEffect
	} from '$lib/video-editor/effects/gpu/compositor';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { isNonNormalBlend } from '$lib/video-editor/effects/gpu/blend-modes';
	import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
	import { selectCuesAtFrame } from '$lib/video-editor/media/render-plan';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import {
		previewItemVolume,
		previewItemVolumeWithFade
	} from '$lib/video-editor/preview/playback-settings';
	import {
		audioCrossfadeGainAtFrame,
		hasLinkedAudioCompanion
	} from '$lib/video-editor/audio/transition-crossfade';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { requiresProcessedPreviewAudio } from '$lib/video-editor/audio/preview-processing';
	import { renderSubtitleRaster, renderTextItemRaster } from '$lib/video-editor/media/text-raster';
	import { isTextMotionActive } from '$lib/video-editor/timeline/text-motion-eval';
	import { renderShapeItemRaster } from '$lib/video-editor/shapes/render';
	import type { ItemEffect } from '$lib/video-editor/effects/types';
	import type { RegisterPreviewSource } from '$lib/video-editor/preview/source-provider';
	import { TimelineFrameRenderer } from '$lib/video-editor/media/render-export';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { applyCompositionControlOverrides } from '$lib/video-editor/sequences/composition-controls';
	import {
		LottieRenderer,
		mapTimelineFrameToLottieFrame
	} from '$lib/video-editor/lottie/frame-provider';
	import {
		resolveLottieRenderSpec,
		type LottieRenderSpec
	} from '$lib/video-editor/lottie/render-spec';
	import { replaceTextSpanCopy } from '$lib/video-editor/typography/text-item-spans';
	import { filmstripCache } from '$lib/video-editor/media/filmstrip-client';
	import {
		animatedImageCache,
		type AnimatedImageFrames
	} from '$lib/video-editor/media/animated-image-client';
	import {
		animatedFrameIndexForItem,
		isAnimatedImageMedia
	} from '$lib/video-editor/media/animated-image-plan';
	import {
		cloneFilmstripFallback,
		nearestFilmstripFallback,
		PROXY_SEEK_STALL_MS
	} from '$lib/video-editor/preview/scrub-proxy-fallback';
	import { clonePrewarmedPreviewFrame } from '$lib/video-editor/preview/decoder-prewarm-client';

	let {
		item,
		url,
		audioUrl,
		canvasWidth,
		canvasHeight,
		previewScale = 1,
		allowPrewarmFallback = true,
		opacityMultiplier = 1,
		effectiveEffects,
		deferEffects = false,
		registersource,
		onsourcechange,
		overrideTransform,
		overrideCrop,
		overrideText,
		hideContent = false,
		selected = false,
		onselect
	}: {
		item: TimelineItem;
		url?: string | null;
		audioUrl?: string | null;
		canvasWidth: number;
		canvasHeight: number;
		previewScale?: number;
		allowPrewarmFallback?: boolean;
		opacityMultiplier?: number;
		effectiveEffects?: ItemEffect[];
		deferEffects?: boolean;
		registersource?: RegisterPreviewSource;
		onsourcechange?: () => void;
		overrideTransform?: ItemTransform;
		overrideCrop?: CropSettings;
		overrideText?: string;
		hideContent?: boolean;
		selected?: boolean;
		onselect: () => void;
	} = $props();
	let mediaElement = $state<HTMLVideoElement | null>(null);
	let proxyAudioElement = $state<HTMLAudioElement | null>(null);
	let proxyFallbackCanvas = $state<HTMLCanvasElement | null>(null);
	let proxyFallbackVisible = $state(false);
	let proxyFallbackKind = $state<'initial' | 'seek' | null>(null);
	let proxyFallbackRevision = $state(0);
	let proxyFallbackGeneration = 0;
	let proxyFallbackTimer: ReturnType<typeof setTimeout> | null = null;
	let reverseConform = $state<ReverseConformResult | null>(null);
	let reverseConformUrl = $state<string | null>(null);
	let imageElement = $state<HTMLImageElement | null>(null);
	let decodedImageElement = $state<HTMLImageElement | null>(null);
	let animatedCanvas = $state<HTMLCanvasElement | null>(null);
	const isAnimatedImageItem = $derived(
		item.type === 'image' && isAnimatedImageMedia(mediaPool.get(item.mediaId ?? ''))
	);
	let animatedFrames = $state<AnimatedImageFrames | null>(null);
	let animatedRevision = $state(0);
	let rasterCanvas = $state<HTMLCanvasElement | null>(null);
	let gpuCanvas = $state<HTMLCanvasElement | null>(null);
	let compositionCanvas = $state<HTMLCanvasElement | null>(null);
	let lottieCanvas = $state<HTMLCanvasElement | null>(null);
	let lottieRenderer = $state<LottieRenderer | null>(null);
	let lottieBytes = $state<Uint8Array | null>(null);
	let lottieSpec = $state<LottieRenderSpec | null>(null);
	let lottieReadyRevision = $state(0);
	let lottieRevision = $state(0);
	let compositor = $state<GpuCompositor | null>(null);
	let rasterRevision = $state(0);
	let compositionRevision = $state(0);
	let renderCompositionFrame = $state<(() => void) | null>(null);
	let lastRasterCanvas: HTMLCanvasElement | null = null;
	let lastRasterKey = '';
	let lastScopeAt = 0;
	const baseResolved = $derived(
		resolveAnimatedItemAt(item, timelineStore.currentFrame, {
			fps: timelineStore.fps,
			frameWidth: canvasWidth,
			frameHeight: canvasHeight,
			items: timelineStore.items
		})
	);
	const resolved = $derived({
		...baseResolved,
		crop: overrideCrop ?? baseResolved.crop,
		text: overrideText ?? baseResolved.text,
		textSpans:
			overrideText !== undefined && baseResolved.textSpans
				? replaceTextSpanCopy(baseResolved.textSpans, overrideText)
				: baseResolved.textSpans
	});
	const transform = $derived(overrideTransform ?? resolved.transform ?? {});
	const renderEffects = $derived(effectiveEffects ?? resolved.effects ?? []);
	const gpuEffects = $derived.by<GpuRenderEffect[]>(() =>
		renderEffects.flatMap((effect) =>
			effect.type === 'gpu' && effect.enabled
				? [
						{
							effectId: effect.effectId,
							params: {
								...getGpuEffectDefaultParams(effect.effectId),
								...effect.params
							}
						}
					]
				: []
		)
	);
	const needsGpu = $derived(
		['video', 'image', 'lottie', 'text', 'subtitle', 'shape'].includes(item.type) &&
			!deferEffects &&
			(gpuEffects.length > 0 || isNonNormalBlend(item.blendMode))
	);
	const layerStyle = $derived.by(() => {
		const width = transform.width ?? canvasWidth;
		const height = transform.height ?? canvasHeight;
		const anchorX = transform.anchorX ?? width / 2;
		const anchorY = transform.anchorY ?? height / 2;
		return [
			`left:${50 + ((transform.x ?? 0) / canvasWidth) * 100}%`,
			`top:${50 + ((transform.y ?? 0) / canvasHeight) * 100}%`,
			`width:${(width / canvasWidth) * 100}%`,
			`height:${(height / canvasHeight) * 100}%`,
			`transform:translate(${(-anchorX / width) * 100}%,${(-anchorY / height) * 100}%) rotate(${transform.rotation ?? 0}deg) scaleX(${transform.flipHorizontal ? -1 : 1}) scaleY(${transform.flipVertical ? -1 : 1})`,
			`opacity:${
				deferEffects
					? 0
					: Math.max(
							0,
							Math.min(
								1,
								(transform.opacity ?? 1) *
									opacityMultiplier *
									visualClipFadeOpacityAtFrame(
										resolved,
										timelineStore.currentFrame,
										timelineStore.fps
									)
							)
						)
			}`,
			`border-radius:${(Math.max(0, transform.cornerRadius ?? 0) / canvasWidth) * 100}cqw`,
			`filter:${deferEffects ? 'none' : effectsToCssFilter(renderEffects)}`
		].join(';');
	});
	const mediaCropStyle = $derived.by(() => {
		const crop = resolved.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
		const left = Math.min(0.999, Math.max(0, crop.left));
		const right = Math.min(0.999, Math.max(0, crop.right));
		const top = Math.min(0.999, Math.max(0, crop.top));
		const bottom = Math.min(0.999, Math.max(0, crop.bottom));
		const visibleWidth = Math.max(0.001, 1 - left - right);
		const visibleHeight = Math.max(0.001, 1 - top - bottom);
		return [
			`left:${(-left / visibleWidth) * 100}%`,
			`top:${(-top / visibleHeight) * 100}%`,
			`width:${100 / visibleWidth}%`,
			`height:${100 / visibleHeight}%`
		].join(';');
	});
	const activeSubtitle = $derived(
		resolved.type === 'subtitle'
			? selectCuesAtFrame(resolved.cues ?? [], timelineStore.currentFrame)[0]
			: undefined
	);
	const basePreviewVolume = $derived(
		previewItemVolume(
			resolved,
			timelineStore.tracks,
			previewPlaybackSettings.volume,
			previewPlaybackSettings.muted || hasLinkedAudioCompanion(resolved, timelineStore.items)
		)
	);
	const crossfadeGain = $derived(
		audioCrossfadeGainAtFrame(
			resolved,
			timelineStore.currentFrame,
			transitionsStore.list,
			timelineStore.itemById
		)
	);
	const clipFadeGain = $derived(
		audioClipFadeGainAtFrame(resolved, timelineStore.currentFrame, timelineStore.fps)
	);
	const previewVolume = $derived(
		previewItemVolumeWithFade(basePreviewVolume, crossfadeGain, clipFadeGain)
	);
	const previewMediaUrl = $derived(
		item.type === 'video' && item.isReversed && reverseConformUrl ? reverseConformUrl : url
	);
	const usesSeparateProxyAudio = $derived(
		item.type === 'video' &&
			!item.isReversed &&
			Boolean(previewMediaUrl && audioUrl && previewMediaUrl !== audioUrl)
	);
	const usesProcessedAudio = $derived(item.type === 'video' && requiresProcessedPreviewAudio(item));

	$effect(() => {
		const mediaId = item.mediaId;
		if (item.type !== 'video' || !item.isReversed || !mediaId) {
			reverseConform = null;
			reverseConformUrl = null;
			return;
		}
		const media = mediaPool.get(mediaId);
		if (!media) return;
		let stale = false;
		void conformReversePreview(media)
			.then((result) => {
				if (stale) return;
				reverseConform = result;
				reverseConformUrl = reverseConformObjectUrl(result);
			})
			.catch(() => undefined);
		return () => {
			stale = true;
		};
	});

	function clearProxySeekFallback(): void {
		proxyFallbackGeneration += 1;
		if (proxyFallbackTimer !== null) clearTimeout(proxyFallbackTimer);
		proxyFallbackTimer = null;
		if (!proxyFallbackVisible) return;
		proxyFallbackVisible = false;
		proxyFallbackKind = null;
		proxyFallbackRevision += 1;
		onsourcechange?.();
	}

	async function cachedSeekFallback(timestampSeconds: number): Promise<ImageBitmap | null> {
		if (!item.mediaId) return null;
		const prewarmed = allowPrewarmFallback
			? await clonePrewarmedPreviewFrame(
					item.mediaId,
					timestampSeconds,
					Math.max(1 / Math.max(1, item.sourceFps ?? editorSession.fps), 1 / 120)
				)
			: null;
		if (prewarmed) return prewarmed;
		if (!usesSeparateProxyAudio) return null;
		const filmstrip = filmstripCache.cachedFilmstrip(item.mediaId);
		const frame = filmstrip ? nearestFilmstripFallback(filmstrip.frames, timestampSeconds) : null;
		return frame ? cloneFilmstripFallback(frame) : null;
	}

	function presentSeekFallback(
		bitmap: ImageBitmap,
		generation: number,
		isStillPending: () => boolean,
		kind: 'initial' | 'seek'
	): void {
		if (generation !== proxyFallbackGeneration || !isStillPending()) {
			bitmap.close();
			return;
		}
		const canvas = proxyFallbackCanvas;
		if (!canvas) {
			bitmap.close();
			return;
		}
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		context?.drawImage(bitmap, 0, 0);
		bitmap.close();
		if (!context) return;
		proxyFallbackVisible = true;
		proxyFallbackKind = kind;
		proxyFallbackRevision += 1;
		onsourcechange?.();
	}

	function scheduleSeekFallback(timestampSeconds: number): void {
		if (editorSession.clock.isPlaying || !item.mediaId) return;
		const generation = ++proxyFallbackGeneration;
		if (proxyFallbackTimer !== null) clearTimeout(proxyFallbackTimer);
		proxyFallbackTimer = setTimeout(() => {
			proxyFallbackTimer = null;
			if (generation !== proxyFallbackGeneration || !mediaElement?.seeking) return;
			void cachedSeekFallback(timestampSeconds)
				.then((bitmap) => {
					if (bitmap)
						presentSeekFallback(bitmap, generation, () => mediaElement?.seeking === true, 'seek');
				})
				.catch(() => undefined);
		}, PROXY_SEEK_STALL_MS);
	}

	$effect(() => {
		const video = mediaElement;
		const frame = timelineStore.currentFrame;
		const boundaryFallbackEnd = item.from + Math.ceil(editorSession.fps / 4);
		if (
			video &&
			frame > boundaryFallbackEnd &&
			video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA &&
			proxyFallbackVisible &&
			proxyFallbackKind === 'initial'
		) {
			clearProxySeekFallback();
			return;
		}
		if (
			resolved.type !== 'video' ||
			!video ||
			!item.mediaId ||
			!allowPrewarmFallback ||
			video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ||
			frame < item.from ||
			frame > boundaryFallbackEnd
		)
			return;
		const generation = ++proxyFallbackGeneration;
		const timestampSeconds = frameToSourceSeconds(item, frame, editorSession.fps);
		void clonePrewarmedPreviewFrame(
			item.mediaId,
			timestampSeconds,
			Math.max(1 / Math.max(1, item.sourceFps ?? editorSession.fps), 1 / 120)
		)
			.then((bitmap) => {
				if (bitmap)
					presentSeekFallback(
						bitmap,
						generation,
						() => video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA,
						'initial'
					);
			})
			.catch(() => undefined);
	});

	function handleVideoSettled(): void {
		clearProxySeekFallback();
		onsourcechange?.();
	}

	onDestroy(clearProxySeekFallback);

	function paintRaster(canvas: HTMLCanvasElement): void {
		if (!['text', 'subtitle', 'shape'].includes(resolved.type)) return;
		const width = Math.max(1, Math.round(transform.width ?? canvasWidth));
		const height = Math.max(1, Math.round(transform.height ?? canvasHeight));
		const rasterKey = JSON.stringify([
			resolved.type,
			resolved.text,
			resolved.textSpans,
			resolved.spanLayout,
			resolved.label,
			activeSubtitle?.text,
			width,
			height,
			resolved.fontFamily,
			resolved.fontSize,
			resolved.fontWeight,
			resolved.fontStyle,
			resolved.underline,
			resolved.color,
			resolved.backgroundColor,
			resolved.backgroundFit,
			resolved.textAlign,
			resolved.verticalAlign,
			resolved.lineHeight,
			resolved.letterSpacing,
			resolved.textShadow,
			resolved.strokeWidth,
			resolved.strokeColor,
			resolved.paddingX,
			resolved.paddingY,
			resolved.borderRadius,
			resolved.textStylePresetId,
			resolved.textStyleScale,
			resolved.textMotion,
			resolved.textMotion &&
			isTextMotionActive(
				resolved.textMotion,
				timelineStore.currentFrame - resolved.from,
				resolved.durationInFrames
			)
				? timelineStore.currentFrame
				: null,
			resolved.subtitleStyleScale,
			resolved.shapeType,
			resolved.fillColor,
			resolved.fillEnabled,
			resolved.fillType,
			resolved.gradientStartColor,
			resolved.gradientEndColor,
			resolved.gradientAngle,
			resolved.strokeEnabled,
			resolved.strokeColor,
			resolved.strokeWidth,
			resolved.strokeLineCap,
			resolved.strokeLineJoin,
			resolved.strokeMiterLimit,
			resolved.shapeCornerRadius,
			resolved.shapeDirection,
			resolved.shapePoints,
			resolved.shapeInnerRadius,
			resolved.pathVertices,
			resolved.pathClosed,
			resolved.isMask
		]);
		if (canvas === lastRasterCanvas && rasterKey === lastRasterKey) return;
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) return;
		if (resolved.type === 'shape') {
			renderShapeItemRaster(context, resolved, width, height);
		} else if (resolved.type === 'text') {
			renderTextItemRaster(context, resolved, width, height, {
				absoluteFrame: timelineStore.currentFrame
			});
		} else if (activeSubtitle) {
			renderSubtitleRaster(context, activeSubtitle.text, resolved, width, height);
		} else {
			context.clearRect(0, 0, width, height);
		}
		lastRasterCanvas = canvas;
		lastRasterKey = rasterKey;
		rasterRevision = untrack(() => rasterRevision) + 1;
		onsourcechange?.();
	}

	$effect(() => {
		const canvas = rasterCanvas;
		if (canvas) paintRaster(canvas);
	});

	$effect(() => {
		const video = mediaElement;
		if (!video || item.type !== 'video') return;
		const videoScheduler = new SeekScheduler((target) => {
			video.currentTime = target;
		});
		const audio = usesSeparateProxyAudio && !usesProcessedAudio ? proxyAudioElement : null;
		if (usesProcessedAudio && proxyAudioElement && !proxyAudioElement.paused)
			proxyAudioElement.pause();
		const audioScheduler = audio
			? new SeekScheduler((target) => {
					audio.currentTime = target;
				})
			: null;
		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const speed = item.speed ?? 1;
			const originalSourceTime = frameToSourceSeconds(item, frame, editorSession.fps);
			const conform = reverseConform;
			const sourceTime =
				item.isReversed && conform
					? sourceSecondsToReverseConformSeconds(conform, originalSourceTime)
					: originalSourceTime;
			if (seekDriftExceeded(video.currentTime, sourceTime, 0.08 / Math.max(0.1, speed))) {
				videoScheduler.request(sourceTime);
				scheduleSeekFallback(originalSourceTime);
			}
			video.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (audio) {
				if (seekDriftExceeded(audio.currentTime, sourceTime, 0.08 / Math.max(0.1, speed)))
					audioScheduler?.request(sourceTime);
				audio.playbackRate = video.playbackRate;
			}
			if (editorSession.clock.isPlaying && video.paused && (!item.isReversed || conform !== null))
				void video.play().catch(() => undefined);
			if (editorSession.clock.isPlaying) clearProxySeekFallback();
			if (editorSession.clock.isPlaying && audio?.paused) void audio.play().catch(() => undefined);
			if (item.isReversed && !conform && !video.paused) video.pause();
			if (!editorSession.clock.isPlaying && !video.paused) video.pause();
			if (!editorSession.clock.isPlaying && audio && !audio.paused) audio.pause();
			if (selected && !needsGpu && !deferEffects)
				requestAnimationFrame(() => publishScopeSample(video));
		};
		sync();
		const offFrame = editorSession.clock.on('framechange', sync);
		const offPlay = editorSession.clock.on('play', sync);
		const offPause = editorSession.clock.on('pause', sync);
		return () => {
			offFrame();
			offPlay();
			offPause();
			videoScheduler.detach();
			audioScheduler?.detach();
		};
	});

	$effect(() => {
		const canvas = compositionCanvas;
		const compositionId = item.compositionId;
		if (item.type !== 'composition' || !compositionId || !canvas || !editorSession.project) return;
		const composition = sequenceStore.compositionById.get(compositionId);
		if (!composition) return;
		const compositionItems = applyCompositionControlOverrides(
			composition.items,
			composition.compositionControls,
			item.compositionControlOverrides
		);
		const renderer = new TimelineFrameRenderer(
			{
				...editorSession.project,
				metadata: {
					width: composition.width,
					height: composition.height,
					fps: composition.fps,
					backgroundColor: composition.backgroundColor ?? '#000000'
				},
				timeline: {
					items: compositionItems,
					tracks: composition.tracks,
					transitions: composition.transitions,
					compositions: sequenceStore.compositions
				}
			},
			{ width: composition.width, height: composition.height }
		);
		canvas.width = composition.width;
		canvas.height = composition.height;
		let disposed = false;
		let request = 0;
		const draw = async () => {
			const revision = ++request;
			const frame = untrack(() => timelineStore.currentFrame);
			const sourceFps = item.sourceFps ?? composition.fps;
			const nestedFrame = Math.max(
				0,
				Math.floor(
					(item.sourceStart ?? 0) +
						((frame - item.from) / editorSession.fps) * (item.speed ?? 1) * sourceFps
				)
			);
			const source = await renderer.render(nestedFrame);
			if (disposed || revision !== request) return;
			const context = canvas.getContext('2d');
			if (!context) return;
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(source, 0, 0, canvas.width, canvas.height);
			compositionRevision += 1;
			onsourcechange?.();
		};
		renderCompositionFrame = () => void draw();
		void draw();
		return () => {
			disposed = true;
			if (renderCompositionFrame) renderCompositionFrame = null;
			renderer.dispose();
		};
	});

	$effect(() => {
		const frame = timelineStore.currentFrame;
		const render = renderCompositionFrame;
		if (frame >= 0) render?.();
	});

	$effect(() => {
		const sourceUrl = url;
		lottieBytes = null;
		if (item.type !== 'lottie' || !sourceUrl) return;
		let disposed = false;
		void fetch(sourceUrl)
			.then((response) => response.arrayBuffer())
			.then((buffer) => {
				if (!disposed) lottieBytes = new Uint8Array(buffer);
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	});

	$effect(() => {
		const bytes = lottieBytes;
		const animationId = item.lottieAnimationId;
		const themeId = item.lottieThemeId;
		const textOverrides = item.lottieTextOverrides;
		const colorOverrides = item.lottieColorOverrides;
		const slotOverrides = item.lottieSlotOverrides;
		lottieSpec = null;
		if (item.type !== 'lottie' || !bytes) return;
		let disposed = false;
		void Promise.resolve(
			resolveLottieRenderSpec(bytes, {
				animationId,
				themeId,
				textOverrides,
				colorOverrides,
				slotOverrides
			})
		)
			.then((spec) => {
				if (!disposed) lottieSpec = spec;
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	});

	$effect(() => {
		const canvas = lottieCanvas;
		const sourceUrl = url;
		const spec = lottieSpec;
		if (item.type !== 'lottie' || !canvas || !sourceUrl || !spec) return;
		lottieReadyRevision = 0;
		lottieRevision = 0;
		const renderer = new LottieRenderer(canvas, {
			...(spec.data ? { data: spec.data } : { src: sourceUrl }),
			themeData: spec.themeData ?? undefined,
			slots: spec.slots ?? undefined
		});
		lottieRenderer = renderer;
		let disposed = false;
		void renderer.ready.then(() => {
			if (!disposed) lottieReadyRevision = untrack(() => lottieReadyRevision) + 1;
		});
		return () => {
			disposed = true;
			renderer.destroy();
			if (lottieRenderer === renderer) lottieRenderer = null;
		};
	});

	$effect(() => {
		const renderer = lottieRenderer;
		const canvas = lottieCanvas;
		const ready = lottieReadyRevision;
		const frame = timelineStore.currentFrame;
		if (!renderer || !canvas || !ready || item.type !== 'lottie' || !renderer.isLoaded) return;
		const width = Math.max(1, Math.round(transform.width ?? item.sourceWidth ?? canvasWidth));
		const height = Math.max(1, Math.round(transform.height ?? item.sourceHeight ?? canvasHeight));
		renderer.resize(width, height);
		renderer.renderFrame(
			mapTimelineFrameToLottieFrame({
				localFrame: frame - item.from + (item.lottiePhaseOffset ?? 0),
				projectFps: editorSession.fps,
				speed: item.speed ?? 1,
				totalFrames: item.lottieTotalFrames ?? 1,
				frameRate: item.lottieFrameRate ?? item.sourceFps ?? 30,
				loop: item.lottieLoop ?? true,
				reversed: item.lottieReversed,
				loopMode: item.lottieLoopMode,
				segmentStart: item.lottieSegmentStart,
				segmentEnd: item.lottieSegmentEnd
			})
		);
		lottieRevision = untrack(() => lottieRevision) + 1;
		onsourcechange?.();
		if (selected && !needsGpu && !deferEffects) publishScopeSample(canvas);
	});

	$effect(() => {
		const image = imageElement;
		const imageUrl = url;
		decodedImageElement = null;
		if (!image || !imageUrl) return;
		let disposed = false;
		const decode = () => {
			void image
				.decode()
				.then(() => {
					if (!disposed) {
						decodedImageElement = image;
						onsourcechange?.();
					}
				})
				.catch(() => undefined);
		};
		if (image.complete) decode();
		else image.addEventListener('load', decode);
		return () => {
			disposed = true;
			image.removeEventListener('load', decode);
		};
	});

	// Animated GIF/WebP: subscribe to extracted frames and paint the exact
	// frame for the current timeline position (speed- and reverse-aware).
	// While extraction runs or fails, the static <img> first frame stays
	// visible as the fallback.
	$effect(() => {
		if (!isAnimatedImageItem || !item.mediaId) {
			animatedFrames = null;
			animatedRevision = 0;
			return;
		}
		animatedRevision = 0;
		let disposed = false;
		const unsubscribe = animatedImageCache.subscribe(item.mediaId, (frames) => {
			if (disposed || !frames.isComplete) return;
			animatedFrames = frames;
			animatedRevision += 1;
			onsourcechange?.();
		});
		const media = mediaPool.get(item.mediaId);
		if (media) void animatedImageCache.getAnimatedImage(media).catch(() => undefined);
		return () => {
			disposed = true;
			unsubscribe();
		};
	});

	$effect(() => {
		const canvas = animatedCanvas;
		const frames = animatedFrames;
		const revision = animatedRevision;
		if (!canvas || !frames || revision === 0) return;
		if (canvas.width !== frames.width) canvas.width = frames.width;
		if (canvas.height !== frames.height) canvas.height = frames.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		let pendingRaf: number | null = null;
		const draw = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const bitmap =
				frames.frames[
					animatedFrameIndexForItem({
						frame,
						fromFrame: item.from,
						fps: editorSession.fps,
						speed: item.speed ?? 1,
						reversed: item.isReversed === true,
						totalDurationMs: frames.totalDurationMs,
						cumulativeDelaysMs: frames.cumulativeDelaysMs
					})
				];
			if (!bitmap) return;
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(bitmap, 0, 0);
			onsourcechange?.();
			if (selected && !needsGpu && !deferEffects) publishScopeSample(canvas);
		};
		draw();
		const scheduleDraw = () => {
			if (pendingRaf !== null) return;
			pendingRaf = requestAnimationFrame(() => {
				pendingRaf = null;
				draw();
			});
		};
		const offFrame = editorSession.clock.on('framechange', scheduleDraw);
		const offPlay = editorSession.clock.on('play', draw);
		return () => {
			offFrame();
			offPlay();
			if (pendingRaf !== null) {
				cancelAnimationFrame(pendingRaf);
				pendingRaf = null;
			}
		};
	});

	function rawSource() {
		if (resolved.type === 'image' && animatedCanvas && animatedFrames && animatedRevision > 0) {
			return {
				source: animatedCanvas,
				width: animatedCanvas.width,
				height: animatedCanvas.height
			};
		}
		if (
			resolved.type === 'video' &&
			proxyFallbackVisible &&
			proxyFallbackCanvas?.width &&
			proxyFallbackCanvas.height
		) {
			return {
				source: proxyFallbackCanvas,
				width: proxyFallbackCanvas.width,
				height: proxyFallbackCanvas.height
			};
		}
		if (resolved.type === 'video' && mediaElement?.videoWidth && mediaElement.videoHeight) {
			return {
				source: mediaElement,
				width: mediaElement.videoWidth,
				height: mediaElement.videoHeight
			};
		}
		if (resolved.type === 'image' && decodedImageElement) {
			return {
				source: decodedImageElement,
				width: decodedImageElement.naturalWidth,
				height: decodedImageElement.naturalHeight
			};
		}
		if (resolved.type === 'lottie' && lottieCanvas && lottieRevision > 0) {
			return {
				source: lottieCanvas,
				width: lottieCanvas.width,
				height: lottieCanvas.height
			};
		}
		if (['text', 'subtitle', 'shape'].includes(resolved.type) && rasterCanvas) {
			paintRaster(rasterCanvas);
			return {
				source: rasterCanvas,
				width: rasterCanvas.width,
				height: rasterCanvas.height
			};
		}
		if (resolved.type === 'composition' && compositionCanvas && compositionRevision > 0) {
			return {
				source: compositionCanvas,
				width: compositionCanvas.width,
				height: compositionCanvas.height
			};
		}
		return null;
	}

	$effect(() => {
		const register = registersource;
		const itemId = item.id;
		if (!register) return;
		register(itemId, rawSource);
		return () => register(itemId, null);
	});

	$effect(() => {
		const canvas = gpuCanvas;
		if (!canvas || !needsGpu) return;
		const instance = createGpuCompositor(canvas);
		if (!instance) return;
		compositor = instance;
		return () => {
			instance.dispose();
			if (compositor === instance) compositor = null;
		};
	});

	$effect(() => {
		const video = mediaElement;
		const fallback = proxyFallbackCanvas;
		const image = imageElement;
		const decodedImage = decodedImageElement;
		const raster = rasterCanvas;
		const nested = compositionCanvas;
		const lottie = lottieCanvas;
		const canvas = gpuCanvas;
		const instance = compositor;
		const revision = rasterRevision;
		const animationRevision = lottieRevision;
		const fallbackRevision = proxyFallbackRevision;
		const effects = gpuEffects;
		const itemType = item.type;
		const blendMode = item.blendMode ?? 'normal';
		if (!canvas || !instance || !needsGpu) return;
		if (['text', 'subtitle', 'shape'].includes(itemType) && revision === 0) return;
		if (itemType === 'lottie' && animationRevision === 0) return;
		if (itemType === 'composition' && compositionRevision === 0) return;
		const draw = () => {
			const source =
				itemType === 'video'
					? proxyFallbackVisible && fallbackRevision > 0
						? fallback
						: video
					: itemType === 'image'
						? animatedRevision > 0 && animatedCanvas
							? animatedCanvas
							: decodedImage
						: itemType === 'lottie'
							? lottie
							: itemType === 'composition'
								? nested
								: raster;
			if (!source) return;
			const width =
				source instanceof HTMLVideoElement
					? source.videoWidth
					: source instanceof HTMLImageElement
						? source.naturalWidth
						: source.width;
			const height =
				source instanceof HTMLVideoElement
					? source.videoHeight
					: source instanceof HTMLImageElement
						? source.naturalHeight
						: source.height;
			if (!width || !height) return;
			const renderWidth = Math.max(1, Math.round(width * previewScale));
			const renderHeight = Math.max(1, Math.round(height * previewScale));
			const rendered = instance.render(source, renderWidth, renderHeight, effects, {
				time: untrack(() => timelineStore.currentFrame) / editorSession.fps,
				blendMode
			});
			canvas.hidden = !rendered;
			if (itemType === 'image' && image) image.style.visibility = rendered ? 'hidden' : '';
			else if (source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement)
				source.style.visibility = rendered ? 'hidden' : '';
			if (selected) publishScopeSample(rendered ? canvas : source);
		};
		draw();
		const offFrame = editorSession.clock.on('framechange', () => requestAnimationFrame(draw));
		const offPlay = editorSession.clock.on('play', draw);
		return () => {
			offFrame();
			offPlay();
			canvas.hidden = true;
			if (video) video.style.visibility = '';
			if (fallback) fallback.style.visibility = '';
			if (image) image.style.visibility = '';
			if (raster) raster.style.visibility = '';
			if (lottie) lottie.style.visibility = '';
		};
	});

	$effect(() => {
		const image = decodedImageElement;
		const raster = rasterCanvas;
		const revision = rasterRevision;
		if (!selected || needsGpu || deferEffects || item.type === 'video' || item.type === 'lottie')
			return;
		const source =
			item.type === 'image'
				? animatedRevision > 0 && animatedCanvas
					? animatedCanvas
					: image
				: item.type === 'composition'
					? compositionCanvas
					: raster;
		if (!source || (['text', 'subtitle', 'shape'].includes(item.type) && revision === 0)) return;
		const frame = requestAnimationFrame(() => publishScopeSample(source));
		return () => cancelAnimationFrame(frame);
	});

	function publishScopeSample(source: CanvasImageSource): void {
		const now = performance.now();
		if (now - lastScopeAt < (editorSession.clock.isPlaying ? 66 : 200)) return;
		lastScopeAt = now;
		const canvas = new OffscreenCanvas(256, 144);
		const context = canvas.getContext('2d');
		if (!context) return;
		try {
			context.drawImage(source, 0, 0, 256, 144);
			scopeSamples.publishCanvas(item.id, canvas);
		} catch {
			scopeSamples.clear(item.id);
		}
	}
</script>

<div
	class="absolute overflow-hidden"
	data-preview-item={item.id}
	style={layerStyle}
	style:visibility={hideContent || resolved.isMask ? 'hidden' : undefined}
	role="presentation"
	aria-hidden={deferEffects ? 'true' : undefined}
	onpointerdown={onselect}
>
	{#if resolved.type === 'video' && previewMediaUrl}
		<!-- svelte-ignore a11y_media_has_caption -- captions render as separate layers -->
		<video
			bind:this={mediaElement}
			src={previewMediaUrl}
			class="absolute object-fill"
			style={mediaCropStyle}
			playsinline
			volume={usesSeparateProxyAudio || usesProcessedAudio ? 0 : previewVolume}
			data-proxy-preview={usesSeparateProxyAudio ? 'true' : undefined}
			onloadeddata={handleVideoSettled}
			onseeked={handleVideoSettled}
		></video>
		{#if usesSeparateProxyAudio && audioUrl}
			<!-- svelte-ignore a11y_media_has_caption -- proxy visuals keep source audio hidden -->
			<audio
				bind:this={proxyAudioElement}
				src={audioUrl}
				volume={usesProcessedAudio ? 0 : previewVolume}
			></audio>
		{/if}
	{:else if resolved.type === 'image' && url}
		<img
			bind:this={imageElement}
			src={url}
			alt=""
			class="absolute object-fill"
			style={mediaCropStyle}
			hidden={animatedRevision > 0}
		/>
		{#if isAnimatedImageItem}
			<canvas
				bind:this={animatedCanvas}
				class="absolute object-fill"
				style={mediaCropStyle}
				hidden={!animatedFrames || animatedRevision === 0}
				aria-hidden="true"
				data-animated-frame-canvas={item.id}
			></canvas>
		{/if}
	{:else if resolved.type === 'lottie' && url}
		<canvas bind:this={lottieCanvas} class="absolute object-fill" style={mediaCropStyle}></canvas>
	{:else if resolved.type === 'composition'}
		<canvas bind:this={compositionCanvas} class="absolute object-fill" style={mediaCropStyle}
		></canvas>
	{:else if resolved.type === 'text'}
		<div class="absolute size-full" role="img" aria-label={resolved.text ?? resolved.label}>
			<canvas bind:this={rasterCanvas} class="size-full object-fill" aria-hidden="true"></canvas>
		</div>
	{:else if resolved.type === 'subtitle'}
		<div class="absolute size-full" role="img" aria-label={activeSubtitle?.text ?? resolved.label}>
			<canvas bind:this={rasterCanvas} class="size-full object-fill" aria-hidden="true"></canvas>
		</div>
	{:else if resolved.type === 'shape'}
		<div class="absolute size-full" role="img" aria-label={resolved.label}>
			<canvas bind:this={rasterCanvas} class="size-full object-fill" aria-hidden="true"></canvas>
		</div>
	{/if}
	{#if needsGpu}
		<canvas
			bind:this={gpuCanvas}
			data-gpu-preview
			class="absolute object-fill"
			style={['video', 'image', 'lottie'].includes(resolved.type) ? mediaCropStyle : ''}
			aria-hidden="true"
			hidden
		></canvas>
	{/if}
	{#if resolved.type === 'video'}
		<canvas
			bind:this={proxyFallbackCanvas}
			class="absolute object-fill"
			style={mediaCropStyle}
			hidden={!proxyFallbackVisible || needsGpu || deferEffects}
			aria-hidden="true"
			data-proxy-seek-fallback
			data-seek-fallback
		></canvas>
	{/if}
</div>
