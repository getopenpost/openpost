<!-- Multi-track composited preview with direct transform gizmos. -->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type {
		ItemTransform,
		KeyframeProperty,
		SpatialBezierTangents,
		TimelineItem,
		TimelineItemCornerPin
	} from '$lib/video-editor/project/types';
	import { replaceTextSpanCopy } from '$lib/video-editor/typography/text-item-spans';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { getMediaObjectUrl, revokeMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import { getAutomaticProxy, shouldUseAutomaticProxy } from '$lib/video-editor/media/proxy-client';
	import { paintOrder, planNestedMixdown } from '$lib/video-editor/media/render-plan';
	import {
		resolveAnimatedItemAt,
		resolveAnimatedItemLocalAt,
		resolvedTransformForItem
	} from '$lib/video-editor/timeline/animated-properties';
	import { worldToLocalTransform } from '$lib/video-editor/timeline/transform-parenting';
	import { removeMotionModifiers } from '$lib/video-editor/timeline/motion-modifier-eval';
	import { removeMotionAnimationLayers } from '$lib/video-editor/timeline/motion-layer-eval';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import {
		createPositionSpatialTangents,
		setAnimatedProperties,
		setPositionAtFrame,
		setPositionSpatialTangents
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { setCurrentFrame, updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		incomingOpacity,
		outgoingOpacity,
		transitionsStore,
		transitionAtFrame
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import PreviewLayer from './preview-layer.svelte';
	import PreviewAudioLayer from './preview-audio-layer.svelte';
	import PreviewMixEntryLayer from './preview-mix-entry-layer.svelte';
	import OnCanvasTools from './on-canvas-tools.svelte';
	import GroupOnCanvasTools from './group-on-canvas-tools.svelte';
	import SpatialEffectPointOverlay from './spatial-effect-point-overlay.svelte';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import {
		collectAdjustmentLayers,
		effectsForItemAtFrame
	} from '$lib/video-editor/effects/adjustment-layers';
	import { isNonNormalBlend } from '$lib/video-editor/effects/gpu/blend-modes';
	import {
		CanvasStackCompositor,
		itemOpacity
	} from '$lib/video-editor/media/canvas-stack-compositor';
	import { scaleItemForCanvas } from '$lib/video-editor/media/render-geometry';
	import type {
		PreviewSourceProvider,
		RegisterPreviewSource
	} from '$lib/video-editor/preview/source-provider';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { withoutColorGradeEffects } from '$lib/video-editor/effects/color-grade';
	import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
	import { toast } from 'svelte-sonner';
	import {
		hasLinkedAudioCompanion,
		isAudioTransitionParticipantAtFrame
	} from '$lib/video-editor/audio/transition-crossfade';
	import { requiresProcessedPreviewAudio } from '$lib/video-editor/audio/preview-processing';
	import { resolveAudioOwner } from '$lib/video-editor/preview/audio-owner';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { shapeMasksForTrack } from '$lib/video-editor/shapes/masks';
	import { hasCornerPin } from '$lib/video-editor/preview/corner-pin';
	import { adaptivePreviewQuality } from '$lib/video-editor/preview/adaptive-preview-quality.svelte';
	import { filmstripCache } from '$lib/video-editor/media/filmstrip-client';
	import {
		prewarmPreviewFrame,
		warmPreviewDecoder
	} from '$lib/video-editor/preview/decoder-prewarm-client';
	import {
		collectPreviewPrewarmTargets,
		previewPrewarmPlanningFrame
	} from '$lib/video-editor/preview/prewarm-plan';
	import type { CanvasAnimatedValues } from '$lib/video-editor/preview/on-canvas-tools';
	import { previewDiagnostics } from '$lib/video-editor/preview/diagnostics.svelte';
	import { spatialEffectEditorStore } from '$lib/video-editor/preview/spatial-effect-editor.svelte';
	import EditPreviewOverlay from './edit-preview-overlay.svelte';
	import ShuttleIndicator from './shuttle-indicator.svelte';
	import { getSpatialPointEffectConfig } from '$lib/video-editor/effects/spatial-point-editor';
	import {
		resolveTimelinePreviewFrame,
		timelinePreviewScrub
	} from '$lib/video-editor/preview/timeline-preview-scrub';
	import { executeAtomicBoolean } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		changedGroupTransformValues,
		GROUP_TRANSFORM_PROPERTIES,
		type GroupTransform
	} from '$lib/video-editor/preview/group-transform';
	import {
		GROUP_TEXT_ANIMATED_PROPERTY_SET,
		planGroupTextScale
	} from '$lib/video-editor/preview/group-text-scale';
	import { activeVectorKeyframes } from '$lib/video-editor/timeline/vector-keyframes';

	const MAX_STACK_PREVIEW_PIXELS = 1920 * 1080;

	let {
		selectedItemId = $bindable(null),
		selectedItemIds = $bindable([]),
		onedit
	}: { selectedItemId?: string | null; selectedItemIds?: string[]; onedit: () => void } = $props();
	const project = $derived(editorSession.project);
	const canvasWidth = $derived(
		sequenceStore.activeSequence?.width ?? project?.metadata.width ?? sequenceStore.activeWidth
	);
	const canvasHeight = $derived(
		sequenceStore.activeSequence?.height ?? project?.metadata.height ?? sequenceStore.activeHeight
	);
	const aspect = $derived(`${canvasWidth} / ${canvasHeight}`);
	const displayFrame = $derived(
		resolveTimelinePreviewFrame($timelinePreviewScrub, timelineStore.currentFrame)
	);
	const prewarmPlanningFrame = $derived(
		previewPrewarmPlanningFrame(displayFrame, editorSession.fps)
	);
	const previewRenderScale = $derived(
		previewPlaybackSettings.previewQuality === 'auto' ? adaptivePreviewQuality.scale : 1
	);
	let urls = $state<Record<string, string>>({});
	let proxyUrls = $state<Record<string, string>>({});
	let proxyBlobs = $state<Record<string, Blob>>({});
	let proxyProgress = $state<Record<string, number>>({});
	const attemptedProxyIds = new Set<string>();
	const proxyControllers = new Map<string, AbortController>();
	let destroyed = false;
	let viewport = $state<HTMLDivElement | null>(null);
	let draftTransform = $state<ItemTransform | null>(null);
	let groupDraftTransforms = $state<Record<string, GroupTransform> | null>(null);
	let draftCrop = $state<NonNullable<TimelineItem['crop']> | null>(null);
	let draftText = $state<string | null>(null);
	let draftCornerPin = $state<TimelineItemCornerPin | null>(null);
	let editingText = $state(false);
	let isPlaying = $state(editorSession.clock.isPlaying);
	let shuttleRate = $state(editorSession.clock.playbackRate);
	let stackCanvas = $state<HTMLCanvasElement | null>(null);
	let stackCompositor = $state<CanvasStackCompositor | null>(null);
	let compareCanvas = $state<HTMLCanvasElement | null>(null);
	let compareCompositor = $state<CanvasStackCompositor | null>(null);
	let stackWidth = $state(1);
	let stackHeight = $state(1);
	let pickerOverlay = $state<HTMLButtonElement | null>(null);
	let pickerLoupe = $state<HTMLCanvasElement | null>(null);
	let pickerX = $state(0);
	let pickerY = $state(0);
	let pickerColor = $state<{ r: number; g: number; b: number } | null>(null);
	let lastStackScopeAt = 0;
	let stackFrameRequest: number | null = null;
	let pendingStackInputs: {
		items: TimelineItem[];
		layers: typeof adjustmentLayers;
		orders: typeof trackOrderById;
		width: number;
		height: number;
	} | null = null;
	const sourceProviders = new Map<string, PreviewSourceProvider>();
	const activeTransition = $derived.by(() => {
		for (const transition of transitionsStore.list) {
			const state = transitionAtFrame(transition, displayFrame, editorSession.fps);
			if (state) return state;
		}
		return null;
	});
	const activeItems = $derived.by(() =>
		paintOrder(timelineStore.items, timelineStore.tracks).filter(
			(item) =>
				['video', 'image', 'lottie', 'text', 'subtitle', 'shape', 'composition'].includes(
					item.type
				) &&
				((displayFrame >= item.from && displayFrame < item.from + item.durationInFrames) ||
					item.id === activeTransition?.outgoing ||
					item.id === activeTransition?.incoming)
		)
	);
	const nestedMixEntries = $derived(
		planNestedMixdown(
			timelineStore.items,
			timelineStore.tracks,
			editorSession.fps,
			transitionsStore.list,
			sequenceStore.compositions
		).filter(
			(entry) =>
				entry.itemId.includes('/') && mediaPool.get(entry.mediaId)?.audioCodecSupported !== false
		)
	);
	const trackOrderById = $derived(
		new Map(timelineStore.tracks.map((track) => [track.id, track.order]))
	);
	const adjustmentLayers = $derived(
		collectAdjustmentLayers(timelineStore.items, timelineStore.tracks)
	);
	const needsStackedComposition = $derived(
		activeTransition !== null ||
			colorPreviewStore.comparisonMode !== 'after' ||
			colorPreviewStore.activePicker !== null ||
			colorPreviewStore.frameCaptureItemId !== null ||
			draftCornerPin !== null ||
			activeItems.some((item) => item.type === 'shape' && item.isMask === true) ||
			activeItems.some((item) => hasCornerPin(item.cornerPin)) ||
			activeItems.some(
				(item) =>
					isNonNormalBlend(item.blendMode) &&
					(resolveAnimatedItemAt(item, displayFrame, {
						fps: timelineStore.fps,
						frameWidth: canvasWidth,
						frameHeight: canvasHeight,
						items: timelineStore.items
					}).transform?.opacity ?? 1) > 0
			)
	);
	const selectedItem = $derived(
		selectedItemId ? activeItems.find((item) => item.id === selectedItemId) : undefined
	);
	const selectedResolved = $derived(
		selectedItem
			? resolveAnimatedItemAt(selectedItem, displayFrame, {
					fps: timelineStore.fps,
					frameWidth: canvasWidth,
					frameHeight: canvasHeight,
					items: timelineStore.items
				})
			: undefined
	);
	const selectedItems = $derived(activeItems.filter((item) => selectedItemIds.includes(item.id)));
	const selectedResolvedItems = $derived(
		selectedItems.map((item) =>
			resolveAnimatedItemAt(item, displayFrame, {
				fps: timelineStore.fps,
				frameWidth: canvasWidth,
				frameHeight: canvasHeight,
				items: timelineStore.items
			})
		)
	);
	const groupSelectionLocked = $derived(
		selectedItems.some((item) => isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))
	);
	const selectedTrackLocked = $derived(
		selectedItem ? isTrackEffectivelyLocked(selectedItem.trackId, timelineStore.tracks) : false
	);
	const spatialEditingSelected = $derived(
		spatialEffectEditorStore.isEditing &&
			spatialEffectEditorStore.editingItemId === selectedItem?.id
	);
	const timelineMediaIds = $derived(
		new Set(timelineStore.items.flatMap((item) => (item.mediaId ? [item.mediaId] : [])))
	);
	const preparingProxy = $derived.by(() => {
		const entry = Object.entries(proxyProgress).find(([, progress]) => progress < 1);
		return entry ? { mediaId: entry[0], progress: entry[1] } : null;
	});
	const diagnosticSnapshot = $derived(previewDiagnostics.snapshot);
	const diagnosticClip = $derived(selectedItem?.type === 'video' ? selectedItem : undefined);

	$effect(() => {
		filmstripCache.prewarm();
		warmPreviewDecoder();
	});

	$effect(() => {
		for (const media of mediaPool.mediaList) {
			if (urls[media.id]) continue;
			void getMediaObjectUrl(media)
				.then((url) => {
					urls = { ...urls, [media.id]: url };
				})
				.catch(() => undefined);
		}
	});

	$effect(() => {
		const usedMedia = timelineMediaIds;
		for (const [mediaId, controller] of proxyControllers) {
			const media = mediaPool.get(mediaId);
			if (
				!usedMedia.has(mediaId) ||
				!media ||
				!shouldUseAutomaticProxy(media, previewPlaybackSettings.previewQuality)
			) {
				controller.abort();
				proxyControllers.delete(mediaId);
			}
		}
		for (const media of mediaPool.mediaList) {
			if (
				!usedMedia.has(media.id) ||
				!shouldUseAutomaticProxy(media, previewPlaybackSettings.previewQuality) ||
				attemptedProxyIds.has(media.id)
			)
				continue;
			attemptedProxyIds.add(media.id);
			const controller = new AbortController();
			proxyControllers.set(media.id, controller);
			proxyProgress = { ...proxyProgress, [media.id]: 0 };
			void getAutomaticProxy(
				media,
				(progress) => {
					if (!destroyed) proxyProgress = { ...proxyProgress, [media.id]: progress };
				},
				controller.signal
			)
				.then((blob) => {
					if (destroyed) return;
					const previous = proxyUrls[media.id];
					if (previous) URL.revokeObjectURL(previous);
					proxyUrls = { ...proxyUrls, [media.id]: URL.createObjectURL(blob) };
					proxyBlobs = { ...proxyBlobs, [media.id]: blob };
					proxyProgress = { ...proxyProgress, [media.id]: 1 };
				})
				.catch((error) => {
					if (destroyed) return;
					if (error instanceof DOMException && error.name === 'AbortError') {
						attemptedProxyIds.delete(media.id);
					}
					const remaining = { ...proxyProgress };
					delete remaining[media.id];
					proxyProgress = remaining;
				})
				.finally(() => {
					if (proxyControllers.get(media.id) === controller) proxyControllers.delete(media.id);
				});
		}
	});

	$effect(() => {
		if (previewPlaybackSettings.previewQuality !== 'auto') return;
		const targets = collectPreviewPrewarmTargets({
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			currentFrame: prewarmPlanningFrame,
			minimumBoundaryFrame: untrack(() => displayFrame),
			fps: editorSession.fps,
			transitions: transitionsStore.list,
			compositions: sequenceStore.compositions
		});
		for (const target of targets) {
			const media = mediaPool.get(target.mediaId);
			if (!media || mediaPool.entry(target.mediaId)?.status !== 'ready') continue;
			void prewarmPreviewFrame(media, target.timestampSeconds, proxyBlobs[target.mediaId]);
		}
	});

	onDestroy(() => {
		destroyed = true;
		for (const controller of proxyControllers.values()) controller.abort();
		proxyControllers.clear();
		if (stackFrameRequest !== null) cancelAnimationFrame(stackFrameRequest);
		stackFrameRequest = null;
		for (const id of Object.keys(urls)) revokeMediaObjectUrl(id);
		for (const url of Object.values(proxyUrls)) URL.revokeObjectURL(url);
		const editingItemId = spatialEffectEditorStore.editingItemId;
		const editingEffectId = spatialEffectEditorStore.editingEffectId;
		if (editingItemId && editingEffectId) {
			colorPreviewStore.clearEffectDraft(editingItemId, editingEffectId);
		}
		spatialEffectEditorStore.stopEditing();
	});

	$effect(() => {
		if (!spatialEffectEditorStore.isEditing) return;
		const editingItemId = spatialEffectEditorStore.editingItemId;
		const editingEffectId = spatialEffectEditorStore.editingEffectId;
		const effect = selectedItem?.effects?.find((candidate) => candidate.id === editingEffectId);
		if (
			editingItemId === selectedItem?.id &&
			effect?.type === 'gpu' &&
			effect.enabled &&
			getSpatialPointEffectConfig(effect.effectId) &&
			!selectedTrackLocked
		)
			return;
		if (editingItemId && editingEffectId) {
			colorPreviewStore.clearEffectDraft(editingItemId, editingEffectId);
		}
		spatialEffectEditorStore.stopEditing();
	});

	$effect(() => {
		previewDiagnostics.setPlaying(editorSession.clock.isPlaying);
		shuttleRate = editorSession.clock.playbackRate;
		const syncPlay = () => {
			isPlaying = true;
			shuttleRate = editorSession.clock.playbackRate;
			previewDiagnostics.setPlaying(true);
		};
		const syncPause = () => {
			isPlaying = false;
			shuttleRate = editorSession.clock.playbackRate;
			previewDiagnostics.setPlaying(false);
			adaptivePreviewQuality.reset();
			scheduleStackFrame();
		};
		const syncRate = () => {
			shuttleRate = editorSession.clock.playbackRate;
		};
		const sampleFrame = (frame: number) => {
			if (editorSession.clock.isPlaying) {
				previewDiagnostics.recordFrame(
					frame,
					performance.now(),
					editorSession.fps,
					editorSession.clock.playbackRate
				);
			}
			if (previewPlaybackSettings.previewQuality !== 'auto' || !editorSession.clock.isPlaying)
				return;
			adaptivePreviewQuality.recordFrame(
				frame,
				performance.now(),
				editorSession.fps,
				editorSession.clock.playbackRate
			);
		};
		const offRate = editorSession.clock.on('ratechange', syncRate);
		const offPlay = editorSession.clock.on('play', syncPlay);
		const offPause = editorSession.clock.on('pause', syncPause);
		const offFrame = editorSession.clock.on('framechange', sampleFrame);
		return () => {
			offRate();
			offPlay();
			offPause();
			offFrame();
		};
	});

	$effect(() => {
		if (previewPlaybackSettings.previewQuality === 'full') adaptivePreviewQuality.reset();
	});

	function transitionOpacity(item: TimelineItem): number {
		const state = activeTransition;
		if (state?.outgoing === item.id) return outgoingOpacity(state.type, state.progress);
		if (state?.incoming === item.id) return incomingOpacity(state.type, state.progress);
		return 1;
	}

	function effectiveEffects(
		item: TimelineItem,
		layers = adjustmentLayers,
		orders = trackOrderById,
		frame = displayFrame
	) {
		return colorPreviewStore.applyEffectDraft(
			item.id,
			effectsForItemAtFrame(item, orders.get(item.trackId) ?? 0, layers, frame)
		);
	}

	const registerPreviewSource: RegisterPreviewSource = (itemId, provider) => {
		if (provider) sourceProviders.set(itemId, provider);
		else sourceProviders.delete(itemId);
		scheduleStackFrame();
	};

	function scheduleStackFrame(): void {
		if (!needsStackedComposition) return;
		pendingStackInputs = {
			items: activeItems,
			layers: adjustmentLayers,
			orders: trackOrderById,
			width: stackWidth,
			height: stackHeight
		};
		if (stackFrameRequest !== null) return;
		stackFrameRequest = requestAnimationFrame(() => {
			stackFrameRequest = null;
			renderStackFrame();
		});
	}

	$effect(() => {
		void displayFrame;
		scheduleStackFrame();
	});

	function renderStackFrame(): void {
		const stack = stackCompositor;
		const compare = compareCompositor;
		const projectState = project;
		const inputs = pendingStackInputs;
		if (!stack || !projectState || !inputs || !needsStackedComposition) return;
		const renderStartedAt = performance.now();
		stack.beginFrame(
			inputs.width,
			inputs.height,
			projectState.metadata.backgroundColor ?? '#000000'
		);
		const comparisonMode = colorPreviewStore.comparisonMode;
		if (comparisonMode === 'split' && compare) {
			compare.beginFrame(
				inputs.width,
				inputs.height,
				projectState.metadata.backgroundColor ?? '#000000'
			);
		}
		const frame = displayFrame;
		const resolveVisualItem = (item: TimelineItem, beforeColor: boolean) => {
			const baseResolved = resolveAnimatedItemAt(item, frame, {
				fps: timelineStore.fps,
				frameWidth: canvasWidth,
				frameHeight: canvasHeight,
				items: timelineStore.items
			});
			const directDraft = item.id === selectedItemId;
			const resolved = scaleItemForCanvas(
				{
					...baseResolved,
					cornerPin: directDraft
						? (draftCornerPin ?? baseResolved.cornerPin)
						: baseResolved.cornerPin,
					transform: directDraft
						? (draftTransform ?? baseResolved.transform)
						: baseResolved.transform,
					crop: directDraft ? (draftCrop ?? baseResolved.crop) : baseResolved.crop,
					text: directDraft ? (draftText ?? baseResolved.text) : baseResolved.text,
					textSpans:
						directDraft && draftText !== null && baseResolved.textSpans
							? replaceTextSpanCopy(baseResolved.textSpans, draftText)
							: baseResolved.textSpans
				},
				inputs.width / canvasWidth,
				inputs.height / canvasHeight
			);
			const afterEffects = effectiveEffects(item, inputs.layers, inputs.orders, frame);
			resolved.effects = beforeColor ? withoutColorGradeEffects(afterEffects) : afterEffects;
			return resolved;
		};
		const activeMasks = inputs.items
			.filter((item) => item.type === 'shape' && item.isMask === true)
			.map((item) => resolveVisualItem(item, false));
		const resolveParticipant = (item: TimelineItem, beforeColor: boolean) => {
			if (item.type === 'shape' && item.isMask === true) return null;
			const source = sourceProviders.get(item.id)?.();
			if (!source) return null;
			const resolved = resolveVisualItem(item, beforeColor);
			return {
				source,
				item: resolved,
				alpha: itemOpacity(resolved),
				masks: shapeMasksForTrack(activeMasks, inputs.orders.get(item.trackId) ?? 0, inputs.orders)
			};
		};
		let transitionRendered = false;
		for (const item of inputs.items) {
			if (
				activeTransition &&
				(item.id === activeTransition.outgoing || item.id === activeTransition.incoming)
			) {
				if (transitionRendered) continue;
				const outgoingItem = inputs.items.find(
					(candidate) => candidate.id === activeTransition.outgoing
				);
				const incomingItem = inputs.items.find(
					(candidate) => candidate.id === activeTransition.incoming
				);
				if (!outgoingItem || !incomingItem) continue;
				const outgoing = resolveParticipant(outgoingItem, comparisonMode === 'before');
				const incoming = resolveParticipant(incomingItem, comparisonMode === 'before');
				if (!outgoing || !incoming) continue;
				stack.compositeTransition(
					outgoing,
					incoming,
					activeTransition.transition,
					activeTransition.progress,
					frame / editorSession.fps
				);
				if (comparisonMode === 'split' && compare) {
					const beforeOutgoing = resolveParticipant(outgoingItem, true);
					const beforeIncoming = resolveParticipant(incomingItem, true);
					if (beforeOutgoing && beforeIncoming) {
						compare.compositeTransition(
							beforeOutgoing,
							beforeIncoming,
							activeTransition.transition,
							activeTransition.progress,
							frame / editorSession.fps
						);
					}
				}
				transitionRendered = true;
				continue;
			}
			const participant = resolveParticipant(item, comparisonMode === 'before');
			if (!participant || participant.alpha <= 0) continue;
			stack.compositeLayer(
				participant.source,
				participant.item,
				participant.alpha,
				frame / editorSession.fps,
				participant.masks
			);
			if (comparisonMode === 'split' && compare) {
				const beforeParticipant = resolveParticipant(item, true);
				if (beforeParticipant) {
					compare.compositeLayer(
						beforeParticipant.source,
						beforeParticipant.item,
						beforeParticipant.alpha,
						frame / editorSession.fps,
						beforeParticipant.masks
					);
				}
			}
		}
		publishStackScope(stackCanvas);
		const gpu = stack.diagnostics();
		previewDiagnostics.setGpuStatus(gpu.webgl2Ready, gpu.webgpuTransitionsReady);
		previewDiagnostics.recordRender(performance.now() - renderStartedAt, stack.failureReason());
	}

	function publishStackScope(canvas: HTMLCanvasElement | null): void {
		if (!canvas || !selectedItemId) return;
		const now = performance.now();
		const captureRequested = colorPreviewStore.frameCaptureItemId === selectedItemId;
		if (!captureRequested && now - lastStackScopeAt < (isPlaying ? 66 : 200)) return;
		lastStackScopeAt = now;
		const sample = new OffscreenCanvas(256, 144);
		const context = sample.getContext('2d', {
			willReadFrequently: captureRequested
		});
		if (!context) return;
		try {
			context.drawImage(canvas, 0, 0, 256, 144);
			const image = captureRequested ? context.getImageData(0, 0, 256, 144) : null;
			scopeSamples.publishCanvas(selectedItemId, sample, image);
			if (image) colorPreviewStore.resolveFrameCapture(selectedItemId, image);
		} catch {
			scopeSamples.clear(selectedItemId);
		}
	}

	$effect(() => {
		const node = viewport;
		const renderScale = previewRenderScale;
		if (!node) return;
		let resizeFrame: number | null = null;
		const updateSize = () => {
			const rect = node.getBoundingClientRect();
			const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
			const viewportScale = Math.min(
				1,
				Math.max(1, rect.width * pixelRatio) / canvasWidth,
				Math.max(1, rect.height * pixelRatio) / canvasHeight
			);
			let nextWidth = Math.max(1, Math.round(canvasWidth * viewportScale * renderScale));
			let nextHeight = Math.max(1, Math.round(canvasHeight * viewportScale * renderScale));
			const pixelCount = nextWidth * nextHeight;
			if (pixelCount > MAX_STACK_PREVIEW_PIXELS) {
				const reduction = Math.sqrt(MAX_STACK_PREVIEW_PIXELS / pixelCount);
				nextWidth = Math.max(1, Math.round(nextWidth * reduction));
				nextHeight = Math.max(1, Math.round(nextHeight * reduction));
			}
			stackWidth = nextWidth;
			stackHeight = nextHeight;
			scheduleStackFrame();
		};
		const scheduleSize = () => {
			if (resizeFrame !== null) return;
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = null;
				updateSize();
			});
		};
		const observer = new ResizeObserver(scheduleSize);
		observer.observe(node);
		scheduleSize();
		return () => {
			observer.disconnect();
			if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
		};
	});

	$effect(() => {
		const canvas = compareCanvas;
		if (!canvas || colorPreviewStore.comparisonMode !== 'split') return;
		const stack = new CanvasStackCompositor(canvas);
		compareCompositor = stack;
		scheduleStackFrame();
		return () => {
			stack.dispose();
			if (compareCompositor === stack) compareCompositor = null;
		};
	});

	$effect(() => {
		const canvas = stackCanvas;
		if (!canvas || !needsStackedComposition) return;
		const stack = new CanvasStackCompositor(canvas);
		stackCompositor = stack;
		scheduleStackFrame();
		return () => {
			stack.dispose();
			if (stackCompositor === stack) stackCompositor = null;
		};
	});

	$effect(() => {
		const stack = stackCompositor;
		const gpu = stack?.diagnostics() ?? {
			webgl2Ready: false,
			webgpuTransitionsReady: false
		};
		previewDiagnostics.updateRuntime({
			renderPath: needsStackedComposition ? 'composited' : 'direct',
			renderWidth: stackWidth,
			renderHeight: stackHeight,
			activeLayers: activeItems.length,
			qualityMode: previewPlaybackSettings.previewQuality,
			qualityScale: previewRenderScale,
			readyProxies: Object.keys(proxyUrls).length,
			pendingProxies: Object.values(proxyProgress).filter((progress) => progress < 1).length,
			webgl2Ready: gpu.webgl2Ready,
			webgpuTransitionsReady: gpu.webgpuTransitionsReady
		});
		if (!needsStackedComposition) previewDiagnostics.recordRender(null, null);
	});

	$effect(() => {
		if (!needsStackedComposition) return;
		scheduleStackFrame();
		const offFrame = editorSession.clock.on('framechange', scheduleStackFrame);
		const offPlay = editorSession.clock.on('play', scheduleStackFrame);
		return () => {
			offFrame();
			offPlay();
		};
	});

	$effect(() => {
		const picker = colorPreviewStore.activePicker;
		if (!picker) {
			pickerColor = null;
			return;
		}
		requestAnimationFrame(() => pickerOverlay?.focus());
	});

	$effect(() => {
		const captureItemId = colorPreviewStore.frameCaptureItemId;
		if (captureItemId) scheduleStackFrame();
	});

	function setSplitFromClientX(clientX: number): void {
		if (!viewport) return;
		const rect = viewport.getBoundingClientRect();
		if (rect.width <= 0) return;
		colorPreviewStore.setSplitPosition((clientX - rect.left) / rect.width);
	}

	function startSplitDrag(event: PointerEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (event.currentTarget instanceof HTMLButtonElement) {
			event.currentTarget.setPointerCapture?.(event.pointerId);
		}
		setSplitFromClientX(event.clientX);
	}

	function moveSplit(event: PointerEvent): void {
		if (event.buttons !== 1) return;
		setSplitFromClientX(event.clientX);
	}

	function splitKeydown(event: KeyboardEvent): void {
		let next: number | null = null;
		if (event.key === 'ArrowLeft')
			next = colorPreviewStore.splitPosition - (event.shiftKey ? 0.1 : 0.01);
		if (event.key === 'ArrowRight')
			next = colorPreviewStore.splitPosition + (event.shiftKey ? 0.1 : 0.01);
		if (event.key === 'Home') next = 0.05;
		if (event.key === 'End') next = 0.95;
		if (next === null) return;
		event.preventDefault();
		colorPreviewStore.setSplitPosition(next);
	}

	function samplePicker(event: PointerEvent): { r: number; g: number; b: number } | null {
		const active = scopeSamples.current;
		if (!viewport || !active || active.itemId !== selectedItemId) return null;
		const image = scopeSamples.readImage(active);
		if (!image) return null;
		const rect = viewport.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
		const pixelX = Math.min(image.width - 1, Math.floor(x * image.width));
		const pixelY = Math.min(image.height - 1, Math.floor(y * image.height));
		const offset = (pixelY * image.width + pixelX) * 4;
		const color = {
			r: (image.data[offset] ?? 0) / 255,
			g: (image.data[offset + 1] ?? 0) / 255,
			b: (image.data[offset + 2] ?? 0) / 255
		};
		pickerColor = color;
		pickerX = Math.max(8, Math.min(rect.width - 88, event.clientX - rect.left + 16));
		pickerY = Math.max(8, Math.min(rect.height - 104, event.clientY - rect.top + 16));
		requestAnimationFrame(() => drawPickerLoupe(image, pixelX, pixelY));
		return color;
	}

	function drawPickerLoupe(image: ImageData, x: number, y: number): void {
		const loupe = pickerLoupe;
		if (!loupe) return;
		const source = document.createElement('canvas');
		source.width = image.width;
		source.height = image.height;
		source.getContext('2d')?.putImageData(image, 0, 0);
		const context = loupe.getContext('2d');
		if (!context) return;
		context.imageSmoothingEnabled = false;
		context.clearRect(0, 0, loupe.width, loupe.height);
		context.drawImage(source, x - 4, y - 4, 9, 9, 0, 0, loupe.width, loupe.height);
		context.strokeStyle = 'rgba(255,255,255,0.9)';
		context.lineWidth = 1;
		context.strokeRect(32.5, 32.5, 8, 8);
	}

	function choosePickerColor(event: PointerEvent): void {
		const color = samplePicker(event);
		if (color) colorPreviewStore.resolvePick(color);
	}

	function pickerKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			colorPreviewStore.cancelPick();
		}
	}

	function colorHex(color: { r: number; g: number; b: number }): string {
		return `#${[color.r, color.g, color.b]
			.map((channel) =>
				Math.round(channel * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')}`.toUpperCase();
	}

	function commitCanvasValues(frame: number, values: CanvasAnimatedValues): boolean {
		if (!selectedItemId) return false;
		const localValues = localCanvasValuesForItem(selectedItemId, frame, values);
		const committedValues: Partial<Record<KeyframeProperty, number>> = {};
		for (const [rawProperty, value] of Object.entries(localValues)) {
			if (value === undefined) continue;
			// SAFETY: CanvasAnimatedValues contains only built-in KeyframeProperty names.
			const property = rawProperty as KeyframeProperty;
			committedValues[property] = value;
		}
		const committed = setAnimatedProperties(selectedItemId, frame, committedValues, (property) =>
			autoKeyframeStore.isEnabled(selectedItemId ?? '', property)
		);
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function commitCanvasPosition(frame: number, x: number, y: number): boolean {
		const local = selectedItemId
			? localCanvasValuesForItem(selectedItemId, frame, { x, y })
			: { x, y };
		const committed = selectedItemId
			? setPositionAtFrame(selectedItemId, frame, local.x ?? x, local.y ?? y)
			: false;
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function localCanvasValuesForItem(
		itemId: string,
		frame: number,
		values: CanvasAnimatedValues,
		parentWorldOverrides?: ReadonlyMap<string, GroupTransform>
	): CanvasAnimatedValues {
		const item = timelineStore.itemById.get(itemId);
		const hasParent = Boolean(item?.transformParent);
		const hasLayers = (item?.motionLayers?.length ?? 0) > 0;
		const hasModifiers = (item?.motionModifiers?.length ?? 0) > 0;
		if (!hasParent && !hasLayers && !hasModifiers) return values;
		const context = {
			fps: timelineStore.fps,
			frameWidth: canvasWidth,
			frameHeight: canvasHeight,
			items: timelineStore.items
		};
		const world = resolvedTransformForItem(
			resolveAnimatedItemAt(item!, frame, context),
			canvasWidth,
			canvasHeight
		);
		const transformProperties = [
			'x',
			'y',
			'width',
			'height',
			'anchorX',
			'anchorY',
			'rotation',
			'opacity',
			'cornerRadius'
		] as const;
		for (const property of transformProperties) {
			const value = values[property];
			if (value !== undefined) world[property] = value;
		}
		let local = hasParent
			? (() => {
					const parent = item!.transformParent!.parentItemId
						? timelineStore.itemById.get(item!.transformParent!.parentItemId)
						: undefined;
					const parentWorld = item!.transformParent!.parentItemId
						? (parentWorldOverrides?.get(item!.transformParent!.parentItemId) ??
							(parent
								? resolvedTransformForItem(
										resolveAnimatedItemAt(parent!, frame, context),
										canvasWidth,
										canvasHeight
									)
								: undefined))
						: undefined;
					return worldToLocalTransform(world, item!.transformParent!, parentWorld);
				})()
			: world;
		if (hasModifiers) {
			local = removeMotionModifiers(local, item!.motionModifiers, {
				frame: frame - item!.from,
				fps: timelineStore.fps,
				frameWidth: canvasWidth,
				frameHeight: canvasHeight
			});
		}
		if (hasLayers) {
			local = removeMotionAnimationLayers(local, item!.motionLayers, frame - item!.from);
		}
		const result = { ...values };
		for (const property of transformProperties) {
			if (values[property] !== undefined) result[property] = local[property];
		}
		return result;
	}

	function commitGroupTransforms(
		frame: number,
		transforms: ReadonlyMap<string, GroupTransform>
	): boolean {
		if (transforms.size < 2 || groupSelectionLocked) return false;
		const planned: Array<{
			itemId: string;
			values: Partial<Record<KeyframeProperty, number>>;
			forceTextFrameScope: boolean;
			textSpans?: TimelineItem['textSpans'];
		}> = [];
		for (const [itemId, transform] of transforms) {
			if (!selectedItemIds.includes(itemId)) return false;
			const item = timelineStore.itemById.get(itemId);
			if (!item) return false;
			const resolved = resolvedTransformForItem(
				resolveAnimatedItemAt(item, frame, {
					fps: timelineStore.fps,
					frameWidth: canvasWidth,
					frameHeight: canvasHeight,
					items: timelineStore.items
				}),
				canvasWidth,
				canvasHeight
			);
			const worldValues = changedGroupTransformValues(resolved, transform);
			if (Object.keys(worldValues).length === 0) continue;
			const local = localCanvasValuesForItem(itemId, frame, worldValues, transforms);
			const values: Partial<Record<KeyframeProperty, number>> = {};
			for (const property of GROUP_TRANSFORM_PROPERTIES) {
				const value = local[property];
				if (worldValues[property] !== undefined && value !== undefined) values[property] = value;
			}
			const scale = resolved.width > 0 ? transform.width / resolved.width : 1;
			const textScale = planGroupTextScale(item, scale);
			if (textScale) Object.assign(values, textScale.animated);
			const scaleWritesKey = Boolean(
				worldValues.width !== undefined &&
				(activeVectorKeyframes(item, 'scale') ||
					item.keyframes?.width ||
					item.keyframes?.height ||
					autoKeyframeStore.isEnabled(itemId, 'width') ||
					autoKeyframeStore.isEnabled(itemId, 'height'))
			);
			planned.push({
				itemId,
				values,
				forceTextFrameScope: scaleWritesKey,
				textSpans: textScale?.itemPatch.textSpans
			});
		}
		const committed = executeAtomicBoolean('GROUP_TRANSFORM', () => {
			for (const { itemId, values, forceTextFrameScope, textSpans } of planned) {
				if (
					!setAnimatedProperties(
						itemId,
						frame,
						values,
						(property) =>
							autoKeyframeStore.isEnabled(itemId, property) ||
							(forceTextFrameScope && GROUP_TEXT_ANIMATED_PROPERTY_SET.has(property))
					)
				)
					return false;
				if (textSpans) updateItemProperties(itemId, { textSpans }, 'SCALE_GROUP_TEXT_SPANS');
			}
			return true;
		});
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function createCanvasSpatialTangents(frame: number): boolean {
		const committed = selectedItemId ? createPositionSpatialTangents(selectedItemId, frame) : false;
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function commitCanvasSpatialTangents(frame: number, spatial: SpatialBezierTangents): boolean {
		const localSpatial = localCanvasSpatialTangents(frame, spatial);
		const committed = selectedItemId
			? setPositionSpatialTangents(selectedItemId, frame, localSpatial)
			: false;
		if (!committed) toast.error(m.video_editor_keyframe_transition_blocked());
		return committed;
	}

	function localCanvasSpatialTangents(
		frame: number,
		spatial: SpatialBezierTangents
	): SpatialBezierTangents {
		if (!selectedItemId) return spatial;
		const item = timelineStore.itemById.get(selectedItemId);
		if (!item?.transformParent) return spatial;
		const context = {
			fps: timelineStore.fps,
			frameWidth: canvasWidth,
			frameHeight: canvasHeight,
			items: timelineStore.items
		};
		const local = resolvedTransformForItem(
			resolveAnimatedItemLocalAt(item, frame, context),
			canvasWidth,
			canvasHeight
		);
		const world = resolvedTransformForItem(
			resolveAnimatedItemAt(item, frame, context),
			canvasWidth,
			canvasHeight
		);
		const parent = item.transformParent.parentItemId
			? timelineStore.itemById.get(item.transformParent.parentItemId)
			: undefined;
		const parentWorld = parent
			? resolvedTransformForItem(
					resolveAnimatedItemAt(parent, frame, context),
					canvasWidth,
					canvasHeight
				)
			: undefined;
		const toLocalTangent = (tangent: { x: number; y: number }) => {
			const handle = worldToLocalTransform(
				{ ...world, x: world.x + tangent.x, y: world.y + tangent.y },
				item.transformParent,
				parentWorld
			);
			return { x: handle.x - local.x, y: handle.y - local.y };
		};
		return {
			...spatial,
			inTangent: toLocalTangent(spatial.inTangent),
			outTangent: toLocalTangent(spatial.outTangent)
		};
	}

	function commitCanvasText(text: string): void {
		if (!selectedItemId || !selectedItem) return;
		updateItemProperties(
			selectedItemId,
			{
				text,
				textSpans: selectedItem.textSpans
					? replaceTextSpanCopy(selectedItem.textSpans, text)
					: undefined,
				label: text.slice(0, 48) || selectedItem.label
			},
			'UPDATE_TEXT_ON_CANVAS'
		);
	}

	function commitCanvasCornerPin(cornerPin: TimelineItemCornerPin): void {
		if (!selectedItemId) return;
		updateItemProperties(selectedItemId, { cornerPin }, 'UPDATE_CORNER_PIN_ON_CANVAS');
	}

	$effect(() => {
		void draftTransform;
		void groupDraftTransforms;
		void draftCrop;
		void draftText;
		void draftCornerPin;
		void colorPreviewStore.effectDraft;
		if (needsStackedComposition) scheduleStackFrame();
	});
</script>

<div
	class="fullscreen:p-6 [container-type:size] flex min-h-0 flex-1 overflow-auto bg-[oklch(0.12_0.008_55)] p-4"
>
	<div
		bind:this={viewport}
		class="[container-type:size] relative m-auto shrink-0 overflow-hidden rounded-md bg-black"
		data-program-monitor
		style={previewPlaybackSettings.zoom === -1
			? `aspect-ratio:${aspect}; width:min(100cqw, calc(100cqh * ${canvasWidth / canvasHeight})); max-width:100%; max-height:100%;`
			: `aspect-ratio:${aspect}; width:${canvasWidth * previewPlaybackSettings.zoom}px;`}
	>
		{#if activeItems.length === 0}
			<div
				class="flex size-full min-h-48 min-w-80 items-center justify-center border border-dashed border-[oklch(0.3_0.01_55)] text-xs text-[oklch(0.65_0.015_55)]"
			>
				{m.video_editor_preview_empty()}
			</div>
		{:else}
			{#if isPlaying && editorSession.transportMode === 'shuttle'}
				<div class="absolute top-2 left-2 z-30">
					<ShuttleIndicator active={isPlaying} playbackRate={shuttleRate} />
				</div>
			{/if}
			{#if preparingProxy}
				<div
					class="absolute top-2 right-2 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-2.5 py-1 text-[10px] text-white shadow-lg backdrop-blur"
					role="status"
					aria-live="polite"
					data-proxy-progress
				>
					<span class="size-1.5 animate-pulse rounded-full bg-sky-400 motion-reduce:animate-none"
					></span>
					{m.video_editor_proxy_preparing()}
					<span class="tabular-nums">{Math.round(preparingProxy.progress * 100)}%</span>
				</div>
			{/if}
			{#if needsStackedComposition}
				<div class="absolute inset-0" role="img" aria-label={m.video_editor_preview_suggestion()}>
					<canvas
						bind:this={stackCanvas}
						width={stackWidth}
						height={stackHeight}
						class="size-full object-fill"
						aria-hidden="true"
						data-stacked-preview
					></canvas>
					{#if colorPreviewStore.comparisonMode === 'split'}
						<canvas
							bind:this={compareCanvas}
							width={stackWidth}
							height={stackHeight}
							class="absolute inset-0 size-full object-fill"
							style:clip-path={`inset(0 ${100 - colorPreviewStore.splitPosition * 100}% 0 0)`}
							aria-hidden="true"
							data-color-before-preview
						></canvas>
						<span
							class="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
							>{m.video_editor_color_before()}</span
						>
						<span
							class="absolute top-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
							>{m.video_editor_color_after()}</span
						>
						<button
							type="button"
							role="slider"
							class="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize focus-visible:outline-2 focus-visible:outline-white"
							style:left={`${colorPreviewStore.splitPosition * 100}%`}
							aria-label={m.video_editor_color_split_position()}
							aria-valuemin="5"
							aria-valuemax="95"
							aria-valuenow={Math.round(colorPreviewStore.splitPosition * 100)}
							onpointerdown={startSplitDrag}
							onpointermove={moveSplit}
							onkeydown={splitKeydown}
						>
							<span class="mx-auto block h-full w-px bg-white shadow-[0_0_0_1px_black]"></span>
							<span
								class="absolute top-1/2 left-1/2 size-3 -translate-1/2 rounded-full border border-black bg-white"
							></span>
						</button>
					{/if}
				</div>
			{/if}
			{#each activeItems as item (item.id)}
				{@const itemMedia = mediaPool.get(item.mediaId ?? '')}
				<PreviewLayer
					{item}
					{displayFrame}
					url={itemMedia &&
					shouldUseAutomaticProxy(itemMedia, previewPlaybackSettings.previewQuality) &&
					proxyUrls[item.mediaId ?? '']
						? proxyUrls[item.mediaId ?? '']
						: urls[item.mediaId ?? '']}
					audioUrl={urls[item.mediaId ?? '']}
					{canvasWidth}
					{canvasHeight}
					effectiveEffects={effectiveEffects(item)}
					deferEffects={needsStackedComposition}
					previewScale={previewRenderScale}
					allowPrewarmFallback={previewPlaybackSettings.previewQuality === 'auto'}
					registersource={registerPreviewSource}
					onsourcechange={scheduleStackFrame}
					selected={item.id === selectedItemId || selectedItemIds.includes(item.id)}
					opacityMultiplier={transitionOpacity(item)}
					overrideTransform={groupDraftTransforms?.[item.id] ??
						(item.id === selectedItemId ? (draftTransform ?? undefined) : undefined)}
					overrideCrop={item.id === selectedItemId ? (draftCrop ?? undefined) : undefined}
					overrideText={item.id === selectedItemId ? (draftText ?? undefined) : undefined}
					hideContent={item.id === selectedItemId && editingText}
					onselect={() => {
						selectedItemId = item.id;
						selectedItemIds = [item.id];
					}}
				/>
			{/each}
			{#if selectedResolvedItems.length > 1 && !groupSelectionLocked}
				<GroupOnCanvasTools
					items={selectedResolvedItems}
					{canvasWidth}
					{canvasHeight}
					currentFrame={timelineStore.currentFrame}
					{isPlaying}
					snappingEnabled={timelineStore.snapEnabled}
					snapItems={activeItems}
					ontransformdraft={(value) => (groupDraftTransforms = value)}
					oncommit={commitGroupTransforms}
					onselectitem={(itemId) => {
						selectedItemId = itemId;
						selectedItemIds = [itemId];
					}}
					ontogglesnapping={() => timelineStore._setSnapEnabled(!timelineStore.snapEnabled)}
					{onedit}
				/>
			{:else if selectedResolved && !selectedTrackLocked}
				{#if spatialEditingSelected && selectedItem}
					<SpatialEffectPointOverlay
						item={selectedResolved}
						sourceItem={selectedItem}
						{canvasWidth}
						{canvasHeight}
						currentFrame={timelineStore.currentFrame}
						{onedit}
					/>
				{:else}
					<OnCanvasTools
						item={selectedResolved}
						motionSourceItem={selectedItem}
						motionContext={{
							fps: timelineStore.fps,
							frameWidth: canvasWidth,
							frameHeight: canvasHeight,
							items: timelineStore.items
						}}
						{canvasWidth}
						{canvasHeight}
						snapItems={activeItems}
						snappingEnabled={timelineStore.snapEnabled}
						currentFrame={timelineStore.currentFrame}
						{isPlaying}
						ontransformdraft={(value) => (draftTransform = value)}
						oncropdraft={(value) => (draftCrop = value)}
						ontextdraft={(value) => (draftText = value)}
						oncornerpindraft={(value) => (draftCornerPin = value)}
						ontextediting={(value) => (editingText = value)}
						oncommitvalues={commitCanvasValues}
						oncommitposition={commitCanvasPosition}
						oncreatespatial={createCanvasSpatialTangents}
						oncommitspatial={commitCanvasSpatialTangents}
						oncommittext={commitCanvasText}
						oncommitcornerpin={commitCanvasCornerPin}
						onseek={setCurrentFrame}
						{onedit}
					/>
				{/if}
			{/if}
			{#if colorPreviewStore.activePicker}
				<button
					bind:this={pickerOverlay}
					type="button"
					class="absolute inset-0 z-30 cursor-crosshair bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					aria-label={m.video_editor_color_picker_instruction()}
					onpointermove={samplePicker}
					onpointerdown={choosePickerColor}
					onkeydown={pickerKeydown}
				>
					{#if pickerColor}
						<span
							class="pointer-events-none absolute overflow-hidden rounded border border-white bg-black shadow-xl"
							style:left={`${pickerX}px`}
							style:top={`${pickerY}px`}
						>
							<canvas bind:this={pickerLoupe} width="72" height="72" class="block size-[72px]"
							></canvas>
							<span class="block px-1 py-0.5 text-center font-mono text-[10px] text-white"
								>{colorHex(pickerColor)}</span
							>
						</span>
					{/if}
				</button>
			{/if}
			{#if previewDiagnostics.clipTimingOverlay && diagnosticClip}
				<div
					class="pointer-events-none absolute top-2 left-2 z-40 max-w-[calc(100%-1rem)] rounded-md bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-4 text-white/90"
					data-testid="preview-clip-diagnostics"
				>
					<div>
						{diagnosticClip.id.slice(0, 8)} · {diagnosticClip.from}-{diagnosticClip.from +
							diagnosticClip.durationInFrames}f
					</div>
					<div class="text-white/65">
						{m.video_editor_diagnostics_overlay_source({
							start: diagnosticClip.sourceStart ?? 0,
							end: diagnosticClip.sourceEnd ?? diagnosticClip.sourceDuration ?? 0
						})}
						· {(diagnosticClip.speed ?? 1).toFixed(2)}x{diagnosticClip.isReversed
							? ` · ${m.video_editor_diagnostics_overlay_reverse()}`
							: ''}
					</div>
				</div>
			{/if}
			{#if previewDiagnostics.performanceOverlay}
				<div
					class="pointer-events-none absolute right-2 bottom-2 z-40 rounded-md bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-4 text-white/90"
					data-testid="preview-performance-diagnostics"
				>
					<div>
						{diagnosticSnapshot.samples > 0
							? `${diagnosticSnapshot.frameTimeEmaMs.toFixed(1)} ms`
							: m.video_editor_diagnostics_status_waiting()}
						· {m.video_editor_diagnostics_overlay_budget({
							value: diagnosticSnapshot.frameBudgetMs.toFixed(1)
						})}
					</div>
					<div class="text-white/65">
						{Math.round(diagnosticSnapshot.qualityScale * 100)}% · {diagnosticSnapshot.renderPath ===
						'composited'
							? m.video_editor_diagnostics_composited()
							: m.video_editor_diagnostics_direct()} · {diagnosticSnapshot.renderWidth}x{diagnosticSnapshot.renderHeight}
					</div>
					<div class="text-white/65">
						{m.video_editor_diagnostics_overlay_skipped({
							count: diagnosticSnapshot.skippedFrames
						})}
						· {m.video_editor_diagnostics_overlay_layers({
							count: diagnosticSnapshot.activeLayers
						})}
					</div>
				</div>
			{/if}
			<EditPreviewOverlay {canvasWidth} {canvasHeight} {urls} {proxyUrls} />
		{/if}
	</div>
	{#each timelineStore.items.filter((item) => {
		const mediaEntry = item.mediaId ? mediaPool.entry(item.mediaId) : null;
		const owner = resolveAudioOwner( { item, tracks: timelineStore.tracks, allItems: timelineStore.items, mediaEntry, usesSeparateProxyAudio: false, usesProcessedAudio: requiresProcessedPreviewAudio(item) } );
		return (owner === 'processed' || (owner === 'embedded' && item.type === 'audio')) && isAudioTransitionParticipantAtFrame(item, timelineStore.currentFrame, transitionsStore.list, timelineStore.itemById, editorSession.fps);
	}) as item (item.id)}
		<PreviewAudioLayer {item} url={urls[item.mediaId ?? '']} />
	{/each}
	{#each nestedMixEntries.filter((entry) => timelineStore.currentFrame / editorSession.fps >= entry.whenSeconds && timelineStore.currentFrame / editorSession.fps < entry.whenSeconds + entry.durationSeconds) as entry (entry.itemId)}
		<PreviewMixEntryLayer {entry} url={urls[entry.mediaId]} />
	{/each}
</div>
