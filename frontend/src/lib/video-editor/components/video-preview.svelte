<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		captionDisplayText,
		isPrimarySequenceClip,
		type PrimarySequenceClip,
		type VariantID,
		type VideoPresentation,
		type VideoProjectDocumentV1,
		type VisualTrackItem
	} from '@openpost/video-project';
	import { evaluateAudio, evaluateFrame, type EvaluatedPrimaryLayer } from '../render-graph';
	import { localVideoSourceURL } from '../source-url';
	import { subscribeToSourceArtifacts } from '../artifacts';
	import { VideoEditorPreviewEngine, type PreviewEngineDiagnostics } from '../preview-engine';
	import { m } from '$lib/paraglide/messages';
	import PlayIcon from 'lucide-svelte/icons/play';

	interface Props {
		project: VideoProjectDocumentV1;
		projectID?: string;
		variantID: VariantID;
		playheadUS: number;
		playing: boolean;
		selectedClipID?: string;
		selectedVisualItemID?: string;
		onSelectClip?: (clipID: string) => void;
		onSelectVisualItem?: (itemID: string) => void;
		onTransform?: (positionX: number, positionY: number) => void;
		onTransformVisual?: (itemID: string, positionX: number, positionY: number) => void;
	}

	let {
		project,
		projectID = '',
		variantID,
		playheadUS,
		playing,
		selectedClipID = '',
		selectedVisualItemID = '',
		onSelectClip,
		onSelectVisualItem,
		onTransform,
		onTransformVisual
	}: Props = $props();
	let sourceURL = $state('');
	let sourceError = $state('');
	let loadedSourceID = $state('');
	let overlaySourceURLs = $state<Record<string, string>>({});
	let previewCanvas: HTMLCanvasElement;
	let previewEngine = $state.raw<VideoEditorPreviewEngine | undefined>();
	let previewWorkerReady = $state(false);
	let previewWorkerError = $state('');
	let previewDiagnostics = $state<PreviewEngineDiagnostics | undefined>();
	let previewRenderedTimestampUS = $state(0);
	let artifactRevision = $state(0);
	let dragging = $state<{
		kind: 'clip' | 'visual';
		id: string;
		startClientX: number;
		startClientY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null>(null);
	const frame = $derived(evaluateFrame(project, variantID, playheadUS));
	const audioFrame = $derived(evaluateAudio(project, playheadUS, playheadUS + 100_000));
	const primary = $derived(frame.primary_layers.at(-1));
	const activeVideoSourceCount = $derived.by(() => {
		const sourceIDs = new Set<string>();
		for (const layer of frame.primary_layers) {
			const source = project.sources[layer.source_id];
			if (source && source.kind !== 'image') sourceIDs.add(source.id);
		}
		for (const layer of frame.visual_layers) {
			if (layer.item.type !== 'media' && layer.item.type !== 'camera') continue;
			const source = project.sources[layer.item.source_id];
			if (source && source.kind !== 'image') sourceIDs.add(source.id);
		}
		return sourceIDs.size;
	});
	const nativePlayback = $derived(
		playing && activeVideoSourceCount > 0 && activeVideoSourceCount <= 3
	);
	const dipTransition = $derived(
		frame.primary_layers.find(
			(layer) => layer.transition?.type === 'dip-black' || layer.transition?.type === 'dip-white'
		)?.transition
	);
	const variant = $derived(project.variants.find((item) => item.id === variantID)!);

	onMount(() => {
		const proxyStates = new Map<string, string>();
		const unsubscribeArtifacts = subscribeToSourceArtifacts((progress) => {
			if (progress.project_id !== projectID || !project.sources[progress.source_id]) return;
			const previous = proxyStates.get(progress.source_id);
			const next = progress.artifact.proxy_state;
			proxyStates.set(progress.source_id, next);
			if (previous === next || (next !== 'ready' && next !== 'pending' && next !== 'not-needed')) {
				return;
			}
			loadedSourceID = '';
			overlaySourceURLs = {};
			artifactRevision += 1;
		});
		try {
			previewEngine = new VideoEditorPreviewEngine(
				previewCanvas,
				projectID || undefined,
				(state) => {
					previewWorkerReady = state.ready;
					previewRenderedTimestampUS = state.rendered_timestamp_us;
					previewWorkerError = state.error ?? '';
					previewDiagnostics = state.diagnostics;
				}
			);
		} catch (cause) {
			previewWorkerError =
				cause instanceof Error ? cause.message : 'The bounded preview renderer is unavailable.';
		}
		return unsubscribeArtifacts;
	});

	onDestroy(() => previewEngine?.dispose());

	$effect(() => {
		const engine = previewEngine;
		const document = project;
		void artifactRevision;
		if (!engine) return;
		void engine.configure(document).catch((cause) => {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			previewWorkerReady = false;
			previewWorkerError =
				cause instanceof Error ? cause.message : 'The bounded preview renderer stopped.';
		});
	});

	$effect(() => {
		if (!nativePlayback) previewEngine?.render(variantID, playheadUS, playing);
	});

	$effect(() => {
		const layer = primary;
		void artifactRevision;
		const source = layer ? project.sources[layer.source_id] : undefined;
		if (!source) {
			sourceURL = '';
			loadedSourceID = '';
			return;
		}
		if (loadedSourceID !== source.id) {
			void localVideoSourceURL(source, projectID, true)
				.then((url) => {
					sourceURL = url;
					loadedSourceID = source.id;
					sourceError = '';
				})
				.catch((cause) => {
					sourceError = cause instanceof Error ? cause.message : m.video_editor_project_missing();
				});
		}
	});

	$effect(() => {
		void artifactRevision;
		const sources = [
			...frame.primary_layers.map((layer) => project.sources[layer.source_id]),
			...frame.visual_layers.flatMap((layer) =>
				layer.item.type === 'media' || layer.item.type === 'camera'
					? [project.sources[layer.item.source_id]]
					: []
			),
			...audioFrame.sources.map((audio) => project.sources[audio.source_id])
		].filter((source) => source && !overlaySourceURLs[source.id]);
		for (const source of sources) {
			void localVideoSourceURL(source!, projectID, true).then((url) => {
				overlaySourceURLs = { ...overlaySourceURLs, [source!.id]: url };
			});
		}
	});

	$effect(() => {
		const elements = Array.from(
			document.querySelectorAll<HTMLAudioElement>('[data-video-editor-audio]')
		);
		for (const audio of audioFrame.sources) {
			const element = elements.find(
				(candidate) => candidate.dataset.videoEditorAudio === audio.item_id
			);
			if (!element) continue;
			const expected = audio.source_time_us / 1_000_000;
			if (Math.abs(element.currentTime - expected) > (playing ? 1 : 0.025)) {
				element.currentTime = expected;
			}
			element.playbackRate = audio.playback_rate;
			element.volume = Math.max(0, Math.min(1, audio.gain));
			if (playing) void element.play().catch(() => undefined);
			else element.pause();
		}
		for (const element of elements) {
			if (!audioFrame.sources.some((audio) => audio.item_id === element.dataset.videoEditorAudio)) {
				element.pause();
			}
		}
	});

	$effect(() => {
		for (const layer of frame.primary_layers) {
			const video = document.querySelector<HTMLVideoElement>(
				`[data-video-editor-primary="${layer.clip_id}"]`
			);
			if (!video) continue;
			const expected = layer.source_time_us / 1_000_000;
			const enteringNativePlayback = video.dataset.nativePlayback !== 'true';
			if (
				(!nativePlayback || enteringNativePlayback) &&
				Math.abs(video.currentTime - expected) > 0.025
			) {
				video.currentTime = expected;
			}
			video.dataset.nativePlayback = nativePlayback ? 'true' : 'false';
			const clip = project.primary_sequence.find((candidate) => candidate.id === layer.clip_id);
			video.playbackRate = clip && isPrimarySequenceClip(clip) ? clip.speed : 1;
			if (nativePlayback) void video.play().catch(() => undefined);
			else video.pause();
		}
	});

	$effect(() => {
		for (const layer of frame.visual_layers) {
			if (layer.item.type !== 'media' && layer.item.type !== 'camera') continue;
			const element = document.querySelector<HTMLVideoElement>(
				`[data-video-editor-overlay="${layer.item.id}"]`
			);
			if (!element) continue;
			const expected =
				(layer.item.source_in_us + layer.local_time_us * layer.item.speed) / 1_000_000;
			const enteringNativePlayback = element.dataset.nativePlayback !== 'true';
			if (
				(!nativePlayback || enteringNativePlayback) &&
				Math.abs(element.currentTime - expected) > 0.025
			) {
				element.currentTime = expected;
			}
			element.dataset.nativePlayback = nativePlayback ? 'true' : 'false';
			element.playbackRate = layer.item.speed;
			if (nativePlayback) void element.play().catch(() => undefined);
			else element.pause();
		}
	});

	function presentationStyle(layer: EvaluatedPrimaryLayer): string {
		const presentation = layer.presentation;
		const transitionShift =
			layer.transition?.type === 'slide' || layer.transition?.type === 'push'
				? layer.transition.role === 'incoming'
					? 1 - layer.transition.progress
					: -layer.transition.progress
				: 0;
		const zoomBlur =
			layer.transition?.type === 'zoom-blur'
				? layer.transition.role === 'incoming'
					? 1 - layer.transition.progress
					: layer.transition.progress
				: 0;
		const x = (presentation.position_x + transitionShift) * 100;
		const y = presentation.position_y * 100;
		const crop = presentation.crop;
		return [
			`left:${x}%`,
			`top:${y}%`,
			`width:${100 / Math.max(0.01, crop.width)}%`,
			`height:${100 / Math.max(0.01, crop.height)}%`,
			`transform:translate(-50%,-50%) scale(${presentation.scale * (1 + zoomBlur * 0.12)}) rotate(${presentation.rotation}deg)`,
			`opacity:${presentation.opacity * layer.opacity}`,
			`object-position:${(crop.x + crop.width / 2) * 100}% ${(crop.y + crop.height / 2) * 100}%`,
			`border-radius:${presentation.corner_radius * 999}px`,
			`border:${presentation.border_width}px solid ${presentation.border_color}`,
			`box-shadow:0 10px ${presentation.shadow_blur}px rgb(0 0 0 / ${presentation.shadow_opacity})`,
			`filter:${[effectFilter(layer.clip_id), zoomBlur > 0 ? `blur(${zoomBlur * 14}px)` : ''].filter(Boolean).join(' ')}`
		].join(';');
	}

	function effectFilter(clipID = primary?.clip_id): string {
		const clip = project.primary_sequence.find((candidate) => candidate.id === clipID);
		const effects = clip && isPrimarySequenceClip(clip) ? clip.effects : [];
		const filters: string[] = [];
		for (const effect of effects) {
			if (effect.type === 'exposure') filters.push(`brightness(${Math.max(0, 1 + effect.value)})`);
			else if (effect.type === 'contrast')
				filters.push(`contrast(${Math.max(0, 1 + effect.value)})`);
			else if (effect.type === 'saturation')
				filters.push(`saturate(${Math.max(0, 1 + effect.value)})`);
			else if (effect.type === 'temperature') {
				filters.push(`sepia(${Math.abs(effect.value) * 0.18})`);
				filters.push(`hue-rotate(${effect.value * -18}deg)`);
			} else if (effect.type === 'tint') filters.push(`hue-rotate(${effect.value * 22}deg)`);
			else if (effect.type === 'blur') filters.push(`blur(${Math.max(0, effect.value)}px)`);
		}
		return filters.join(' ') || 'none';
	}

	function vignetteOpacity(): number {
		const value =
			clipForPrimary()?.effects.find((effect) => effect.type === 'vignette')?.value ?? 0;
		return Math.max(0, Math.min(0.8, value * 0.8));
	}

	function beginClipDrag(event: PointerEvent, layer: EvaluatedPrimaryLayer): void {
		onSelectClip?.(layer.clip_id);
		dragging = {
			kind: 'clip',
			id: layer.clip_id,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originX: layer.presentation.position_x,
			originY: layer.presentation.position_y,
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function beginVisualDrag(
		event: PointerEvent,
		itemID: string,
		presentation: VideoPresentation
	): void {
		event.stopPropagation();
		onSelectVisualItem?.(itemID);
		dragging = {
			kind: 'visual',
			id: itemID,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originX: presentation.position_x,
			originY: presentation.position_y,
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function continueDrag(event: PointerEvent): void {
		if (!dragging) return;
		const target = event.currentTarget as HTMLElement;
		const canvas = target.parentElement;
		if (!canvas) return;
		const bounds = canvas.getBoundingClientRect();
		const deltaX = event.clientX - dragging.startClientX;
		const deltaY = event.clientY - dragging.startClientY;
		if (!dragging.moved && Math.hypot(deltaX, deltaY) < 4) return;
		dragging.moved = true;
		const x = Math.max(0, Math.min(1, dragging.originX + deltaX / bounds.width));
		const y = Math.max(0, Math.min(1, dragging.originY + deltaY / bounds.height));
		if (dragging.kind === 'clip') onTransform?.(x, y);
		else onTransformVisual?.(dragging.id, x, y);
	}

	function endDrag(event: PointerEvent): void {
		dragging = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
	}

	function visualHitStyle(presentation: VideoPresentation): string {
		return [
			`left:${presentation.position_x * 100}%`,
			`top:${presentation.position_y * 100}%`,
			`width:${Math.max(8, presentation.scale * 45)}%`,
			`aspect-ratio:4/3`,
			`transform:translate(-50%,-50%) rotate(${presentation.rotation}deg)`
		].join(';');
	}

	function clipForPrimary(): PrimarySequenceClip | undefined {
		const clip = project.primary_sequence.find((candidate) => candidate.id === primary?.clip_id);
		return clip && isPrimarySequenceClip(clip) ? clip : undefined;
	}

	function visualStyle(presentation: VideoPresentation, opacity: number): string {
		return [
			`left:${presentation.position_x * 100}%`,
			`top:${presentation.position_y * 100}%`,
			`width:${Math.max(8, presentation.scale * 45)}%`,
			`transform:translate(-50%,-50%) rotate(${presentation.rotation}deg)`,
			`opacity:${opacity * presentation.opacity}`,
			`border-radius:${presentation.corner_radius * 999}px`,
			`border:${presentation.border_width}px solid ${presentation.border_color}`,
			`box-shadow:0 10px ${presentation.shadow_blur}px rgb(0 0 0 / ${presentation.shadow_opacity})`
		].join(';');
	}

	function animatedText(
		item: Extract<VisualTrackItem, { type: 'text' }>,
		localTimeUS: number
	): string {
		if (item.style.animation !== 'typewriter') return item.text;
		const entrance = Math.min(1, localTimeUS / 350_000);
		return item.text.slice(0, Math.max(1, Math.ceil(item.text.length * entrance)));
	}

	function textAnimationValues(
		item: Extract<VisualTrackItem, { type: 'text' }>,
		localTimeUS: number,
		opacity: number
	): { opacity: number; rise: number; pop: number } {
		const entrance = Math.min(1, localTimeUS / 350_000);
		const exit = Math.min(1, (item.duration_us - localTimeUS) / 250_000);
		const visibility = Math.max(0, Math.min(entrance, exit));
		const animatedOpacity =
			item.style.animation === 'fade' || item.style.animation === 'rise'
				? opacity * visibility
				: item.style.animation === 'pop'
					? opacity * exit
					: opacity;
		const rise = item.style.animation === 'rise' ? (1 - entrance) * 36 : 0;
		const pop = item.style.animation === 'pop' ? 0.8 + Math.min(1.08, entrance * 1.18) * 0.2 : 1;
		return { opacity: animatedOpacity, rise, pop };
	}
</script>

<div
	class="relative flex size-full min-h-0 items-center justify-center overflow-hidden bg-[#121214] p-4 sm:p-6"
	data-preview-engine-ready={previewWorkerReady}
	data-preview-active-decoders={previewDiagnostics?.active_video_decoders ?? 0}
	data-preview-peak-decoders={previewDiagnostics?.peak_video_decoders ?? 0}
	data-preview-proxy-sources={previewDiagnostics?.proxy_source_count ?? 0}
	data-preview-quality={nativePlayback
		? 'adaptive'
		: (previewDiagnostics?.quality ?? 'unavailable')}
	data-preview-dropped-requests={previewDiagnostics?.dropped_render_requests ?? 0}
	data-preview-render-ms={previewDiagnostics?.render_ms ?? 0}
	data-preview-rendered-timestamp-us={previewRenderedTimestampUS}
	data-preview-sample-requests={previewDiagnostics?.sample_requests ?? 0}
	data-preview-discontinuity-seeks={previewDiagnostics?.discontinuity_seeks ?? 0}
	data-preview-error={previewWorkerError}
	data-preview-render-mode={nativePlayback ? 'native' : 'worker'}
>
	<div
		class="relative max-h-full max-w-full overflow-hidden bg-black shadow-2xl"
		style:aspect-ratio={`${variant.width} / ${variant.height}`}
		style:width={variant.width >= variant.height ? 'min(100%, 64rem)' : 'auto'}
		style:height={variant.height > variant.width ? '100%' : 'auto'}
		aria-label={`${variant.name} ${m.video_editor_safe_area()}`}
	>
		<canvas
			bind:this={previewCanvas}
			class="pointer-events-none absolute inset-0 size-full object-contain"
			class:hidden={!previewWorkerReady || nativePlayback}
			aria-hidden="true"
		></canvas>
		{#if primary && sourceURL}
			<button
				type="button"
				class="absolute inset-0 z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
				aria-label={`${m.video_editor_clip()} ${primary.clip_id}`}
				aria-pressed={selectedClipID === primary.clip_id}
				onpointerdown={(event) => beginClipDrag(event, primary)}
				onpointermove={continueDrag}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			>
				<span class="sr-only">{clipForPrimary()?.id}</span>
			</button>
			{#each frame.primary_layers as layer (layer.clip_id)}
				{@const layerURL =
					layer.clip_id === primary.clip_id ? sourceURL : overlaySourceURLs[layer.source_id]}
				{#if layerURL}
					<video
						data-video-editor-primary={layer.clip_id}
						src={layerURL}
						class="absolute max-w-none object-cover"
						class:hidden={previewWorkerReady && !nativePlayback}
						style={presentationStyle(layer)}
						muted
						playsinline
						preload="auto"
					></video>
				{/if}
			{/each}
			{#if dipTransition}
				<div
					class="pointer-events-none absolute inset-0 z-[4]"
					class:hidden={previewWorkerReady && !nativePlayback}
					style:background={dipTransition.type === 'dip-white' ? '#ffffff' : '#000000'}
					style:opacity={dipTransition.role === 'outgoing'
						? dipTransition.progress
						: 1 - dipTransition.progress}
					aria-hidden="true"
				></div>
			{/if}
			{#if vignetteOpacity() > 0}
				<div
					class="pointer-events-none absolute inset-0 z-[5]"
					class:hidden={previewWorkerReady && !nativePlayback}
					style:background={`radial-gradient(circle at center, transparent 25%, rgb(0 0 0 / ${vignetteOpacity()}) 100%)`}
					aria-hidden="true"
				></div>
			{/if}
		{:else if !previewWorkerReady || nativePlayback}
			<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-500">
				<PlayIcon class="size-7" />
				<p class="text-sm">
					{previewWorkerError || sourceError || m.video_editor_empty_preview()}
				</p>
			</div>
		{/if}

		{#if !previewWorkerReady || nativePlayback}
			{#each frame.visual_layers as layer (layer.item.id)}
				{#if layer.item.type === 'text'}
					<div
						class="pointer-events-none absolute z-20 max-w-[80%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap"
						style:left={`${layer.presentation.position_x * 100}%`}
						style:top={`${layer.presentation.position_y * 100}%`}
						style:transform={`translate(-50%,-50%) scale(${layer.presentation.scale}) rotate(${layer.presentation.rotation}deg)`}
						style:opacity={textAnimationValues(layer.item, layer.local_time_us, layer.opacity)
							.opacity}
						style:translate={`0 ${textAnimationValues(layer.item, layer.local_time_us, layer.opacity).rise}px`}
						style:scale={textAnimationValues(layer.item, layer.local_time_us, layer.opacity).pop}
						style:color={layer.item.style.color}
						style:font-size={`${layer.item.style.font_size}px`}
						style:font-weight={layer.item.style.font_weight}
						style:text-align={layer.item.style.align}
						style:background={layer.item.style.background_color}
					>
						{animatedText(layer.item, layer.local_time_us)}
					</div>
				{:else if layer.item.type === 'media' || layer.item.type === 'camera'}
					{@const source = project.sources[layer.item.source_id]}
					{#if source && overlaySourceURLs[source.id]}
						{#if source.mime_type.startsWith('video/')}
							<video
								data-video-editor-overlay={layer.item.id}
								src={overlaySourceURLs[source.id]}
								class="pointer-events-none absolute z-20 aspect-video object-cover"
								style={visualStyle(layer.presentation, layer.opacity)}
								muted
								playsinline
								preload="auto"
							></video>
						{:else}
							<img
								src={overlaySourceURLs[source.id]}
								alt=""
								class="pointer-events-none absolute z-20 aspect-video object-cover"
								style={visualStyle(layer.presentation, layer.opacity)}
							/>
						{/if}
					{/if}
				{:else if layer.item.type === 'shape' || layer.item.type === 'annotation'}
					{#if layer.item.shape.kind === 'arrow'}
						<svg
							viewBox="0 0 120 80"
							class="pointer-events-none absolute z-20 overflow-visible"
							style={visualStyle(layer.presentation, layer.opacity)}
							aria-hidden="true"
						>
							<path
								d="M8 66 L92 18 M92 18 L73 18 M92 18 L80 35"
								fill="none"
								stroke={layer.item.shape.stroke}
								stroke-width={layer.item.shape.stroke_width}
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{:else}
						<div
							class={[
								'pointer-events-none absolute z-20',
								layer.item.shape.kind === 'ellipse' || layer.item.shape.kind === 'click-pulse'
									? 'rounded-full'
									: 'rounded-sm',
								layer.item.shape.kind === 'redaction' ? 'backdrop-blur-md' : ''
							]}
							style={visualStyle(layer.presentation, layer.opacity)}
							style:aspect-ratio={layer.item.shape.kind === 'progress' ? '8 / 1' : '4 / 3'}
							style:background={layer.item.shape.fill}
							style:border={`${layer.item.shape.stroke_width}px solid ${layer.item.shape.stroke}`}
						></div>
					{/if}
				{/if}
			{/each}
		{/if}

		{#each frame.visual_layers as layer (layer.item.id)}
			<button
				type="button"
				class={[
					'absolute z-30 cursor-move rounded-sm bg-transparent focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
					selectedVisualItemID === layer.item.id
						? 'ring-2 ring-primary ring-offset-2 ring-offset-transparent'
						: ''
				]}
				style={visualHitStyle(layer.presentation)}
				aria-label={layer.item.type === 'text'
					? m.video_editor_overlay_text()
					: m.video_editor_overlay_item()}
				aria-pressed={selectedVisualItemID === layer.item.id}
				onpointerdown={(event) => beginVisualDrag(event, layer.item.id, layer.presentation)}
				onpointermove={continueDrag}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			>
				<span class="sr-only">
					{layer.item.type === 'text' ? layer.item.text : layer.item.type}
				</span>
			</button>
		{/each}

		{#if !previewWorkerReady || nativePlayback}
			{#each frame.captions as caption (caption.cue.id)}
				{@const displayText = captionDisplayText(caption.cue)}
				{@const timedText = caption.cue.words
					.map((word) => word.text)
					.join(' ')
					.trim()}
				<div
					class={[
						'pointer-events-none absolute left-1/2 z-30 w-[82%] -translate-x-1/2 text-center',
						caption.style.position === 'top'
							? 'top-[10%]'
							: caption.style.position === 'middle'
								? 'top-1/2 -translate-y-1/2'
								: 'bottom-[12%]'
					]}
					style:font-family={caption.style.font_family}
					style:font-size={`${caption.style.font_size}px`}
					style:font-weight={caption.style.font_weight}
					style:color={caption.style.color}
				>
					<span
						class="rounded box-decoration-clone px-2 py-1"
						style:background={caption.style.background_color}
					>
						{#if displayText && displayText === timedText}
							{#each caption.cue.words as word, index (`${word.start_us}:${index}`)}
								<span
									style:color={index === caption.active_word_index
										? caption.style.emphasis_color
										: undefined}
								>
									{word.text}{index < caption.cue.words.length - 1 ? ' ' : ''}
								</span>
							{/each}
						{:else}
							{displayText}
						{/if}
					</span>
				</div>
			{/each}
		{/if}

		<div
			class="pointer-events-none absolute z-40 border border-dashed border-white/35"
			style:inset={`${(frame.safe_area.top / frame.height) * 100}% ${(frame.safe_area.right / frame.width) * 100}% ${(frame.safe_area.bottom / frame.height) * 100}% ${(frame.safe_area.left / frame.width) * 100}%`}
			aria-hidden="true"
		></div>

		{#each audioFrame.sources as audio (audio.item_id)}
			{#if overlaySourceURLs[audio.source_id]}
				<audio
					data-video-editor-audio={audio.item_id}
					src={overlaySourceURLs[audio.source_id]}
					preload="auto"
				></audio>
			{/if}
		{/each}
	</div>
</div>
