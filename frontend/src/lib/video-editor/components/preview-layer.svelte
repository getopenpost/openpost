<!-- One frame-synced visual layer in the composited editor preview. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { CropSettings, ItemTransform, TimelineItem } from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { effectsToCssFilter } from '$lib/video-editor/effects/filter';
	import { SeekScheduler, seekDriftExceeded } from '$lib/video-editor/preview/seek-throttle';
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
	import { audioCrossfadeGainAtFrame } from '$lib/video-editor/audio/transition-crossfade';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { renderSubtitleRaster, renderTextItemRaster } from '$lib/video-editor/media/text-raster';
	import type { ItemEffect } from '$lib/video-editor/effects/types';
	import type { RegisterPreviewSource } from '$lib/video-editor/preview/source-provider';

	let {
		item,
		url,
		canvasWidth,
		canvasHeight,
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
		canvasWidth: number;
		canvasHeight: number;
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
	let imageElement = $state<HTMLImageElement | null>(null);
	let decodedImageElement = $state<HTMLImageElement | null>(null);
	let rasterCanvas = $state<HTMLCanvasElement | null>(null);
	let gpuCanvas = $state<HTMLCanvasElement | null>(null);
	let compositor = $state<GpuCompositor | null>(null);
	let rasterRevision = $state(0);
	let lastRasterCanvas: HTMLCanvasElement | null = null;
	let lastRasterKey = '';
	let lastScopeAt = 0;
	const baseResolved = $derived(resolveAnimatedItemAt(item, timelineStore.currentFrame));
	const resolved = $derived({
		...baseResolved,
		crop: overrideCrop ?? baseResolved.crop,
		text: overrideText ?? baseResolved.text
	});
	const transform = $derived(overrideTransform ?? resolved.transform ?? {});
	const renderEffects = $derived(effectiveEffects ?? resolved.effects ?? []);
	const gpuEffects = $derived.by<GpuRenderEffect[]>(() =>
		renderEffects.flatMap((effect) =>
			effect.type === 'gpu' && effect.enabled
				? [
						{
							effectId: effect.effectId,
							params: { ...getGpuEffectDefaultParams(effect.effectId), ...effect.params }
						}
					]
				: []
		)
	);
	const needsGpu = $derived(
		['video', 'image', 'text', 'subtitle'].includes(item.type) &&
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
			`opacity:${deferEffects ? 0 : Math.max(0, Math.min(1, (transform.opacity ?? 1) * opacityMultiplier))}`,
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
			previewPlaybackSettings.muted
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
	const previewVolume = $derived(previewItemVolumeWithFade(basePreviewVolume, crossfadeGain));

	function paintRaster(canvas: HTMLCanvasElement): void {
		if (resolved.type !== 'text' && resolved.type !== 'subtitle') return;
		const width = Math.max(1, Math.round(transform.width ?? canvasWidth));
		const height = Math.max(1, Math.round(transform.height ?? canvasHeight));
		const rasterKey = JSON.stringify([
			resolved.type,
			resolved.text,
			resolved.label,
			activeSubtitle?.text,
			width,
			height,
			resolved.fontFamily,
			resolved.fontSize,
			resolved.fontWeight,
			resolved.color,
			resolved.backgroundColor,
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
			resolved.subtitleStyleScale
		]);
		if (canvas === lastRasterCanvas && rasterKey === lastRasterKey) return;
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) return;
		if (resolved.type === 'text') {
			renderTextItemRaster(context, resolved, width, height);
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
		const scheduler = new SeekScheduler((target) => {
			video.currentTime = target;
		});
		const sync = () => {
			const frame = untrack(() => timelineStore.currentFrame);
			const speed = item.speed ?? 1;
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : editorSession.fps;
			const sourceTime =
				(item.sourceStart ?? 0) / sourceFps + ((frame - item.from) / editorSession.fps) * speed;
			if (seekDriftExceeded(video.currentTime, sourceTime, 0.08 / Math.max(0.1, speed)))
				scheduler.request(sourceTime);
			video.playbackRate = Math.min(16, Math.max(0.0625, speed));
			if (editorSession.clock.isPlaying && video.paused) void video.play().catch(() => undefined);
			if (!editorSession.clock.isPlaying && !video.paused) video.pause();
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
			scheduler.detach();
		};
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

	function rawSource() {
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
		if ((resolved.type === 'text' || resolved.type === 'subtitle') && rasterCanvas) {
			paintRaster(rasterCanvas);
			return { source: rasterCanvas, width: rasterCanvas.width, height: rasterCanvas.height };
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
		const image = imageElement;
		const decodedImage = decodedImageElement;
		const raster = rasterCanvas;
		const canvas = gpuCanvas;
		const instance = compositor;
		const revision = rasterRevision;
		const effects = gpuEffects;
		const itemType = item.type;
		const blendMode = item.blendMode ?? 'normal';
		if (!canvas || !instance || !needsGpu) return;
		if ((itemType === 'text' || itemType === 'subtitle') && revision === 0) return;
		const draw = () => {
			const source = itemType === 'video' ? video : itemType === 'image' ? decodedImage : raster;
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
			const rendered = instance.render(source, width, height, effects, {
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
			if (image) image.style.visibility = '';
			if (raster) raster.style.visibility = '';
		};
	});

	$effect(() => {
		const image = decodedImageElement;
		const raster = rasterCanvas;
		const revision = rasterRevision;
		if (!selected || needsGpu || deferEffects || item.type === 'video') return;
		const source = item.type === 'image' ? image : raster;
		if (!source || ((item.type === 'text' || item.type === 'subtitle') && revision === 0)) return;
		const frame = requestAnimationFrame(() => publishScopeSample(source));
		return () => cancelAnimationFrame(frame);
	});

	function publishScopeSample(source: CanvasImageSource): void {
		const now = performance.now();
		if (now - lastScopeAt < 200) return;
		lastScopeAt = now;
		const canvas = new OffscreenCanvas(256, 144);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return;
		try {
			context.drawImage(source, 0, 0, 256, 144);
			scopeSamples.publish(item.id, context.getImageData(0, 0, 256, 144));
		} catch {
			scopeSamples.clear(item.id);
		}
	}
</script>

<div
	class="absolute overflow-hidden"
	style={layerStyle}
	style:visibility={hideContent ? 'hidden' : undefined}
	role="presentation"
	aria-hidden={deferEffects ? 'true' : undefined}
	onpointerdown={onselect}
>
	{#if resolved.type === 'video' && url}
		<!-- svelte-ignore a11y_media_has_caption -- captions render as separate layers -->
		<video
			bind:this={mediaElement}
			src={url}
			class="absolute object-fill"
			style={mediaCropStyle}
			playsinline
			volume={previewVolume}
			onloadeddata={onsourcechange}
			onseeked={onsourcechange}
		></video>
	{:else if resolved.type === 'image' && url}
		<img
			bind:this={imageElement}
			src={url}
			alt=""
			class="absolute object-fill"
			style={mediaCropStyle}
		/>
	{:else if resolved.type === 'text'}
		<div class="absolute size-full" role="img" aria-label={resolved.text ?? resolved.label}>
			<canvas bind:this={rasterCanvas} class="size-full object-fill" aria-hidden="true"></canvas>
		</div>
	{:else if resolved.type === 'subtitle'}
		<div class="absolute size-full" role="img" aria-label={activeSubtitle?.text ?? resolved.label}>
			<canvas bind:this={rasterCanvas} class="size-full object-fill" aria-hidden="true"></canvas>
		</div>
	{/if}
	{#if needsGpu}
		<canvas
			bind:this={gpuCanvas}
			data-gpu-preview
			class="absolute object-fill"
			style={resolved.type === 'video' || resolved.type === 'image' ? mediaCropStyle : ''}
			aria-hidden="true"
			hidden
		></canvas>
	{/if}
</div>
