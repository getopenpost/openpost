import { m } from '$lib/paraglide/messages';
import { showToast } from '$lib/toast';
import { downloadStockAsset, resolveStockAsset, stockAssetAttribution } from '$lib/stock-media';
import type { ProjectAssetImporter } from '@openpost/editor-shared/media';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { videoLibrary } from '../library/library-store.svelte';
import { applyLibraryEntry } from '../library/apply';
import { addTimer } from '../timers/actions';
import {
	addShapeItem,
	addTextItemAtFrame,
	addTextTemplateItem
} from '$lib/video-editor/timeline/actions/items';
import {
	clearGeneratedItemDragData,
	getGeneratedItemDragData,
	type GeneratedItemDragData
} from '$lib/video-editor/timeline/generated-item-drag';
import { localizedTextStylePresetCopy } from '$lib/video-editor/typography/text-style-preset-copy';
import { addBackgroundItem } from '$lib/video-editor/timeline/actions/backgrounds';
import { trackRangeIsOpen } from '$lib/video-editor/timeline/track-occupancy';
import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import {
	calculateAdaptiveSnapThreshold,
	calculateMoveSnap,
	type SnapTarget
} from '$lib/video-editor/timeline/snapping';
import {
	addTransition,
	transitionsStore,
	updateTransitionPresentation
} from '$lib/video-editor/timeline/actions/transitions.svelte';
import {
	effectiveMediaTracks,
	isTrackGroup,
	visibleTrackRows
} from '$lib/video-editor/timeline/utils/track-groups';
import {
	areItemIdListsEqual,
	clearEffectDragData,
	getEffectDragData,
	isDragPointInsideElement,
	resolveEffectDropTargetIds,
	type EffectDragData
} from '$lib/video-editor/timeline/effect-drop';
import {
	clearTransitionDragData,
	getTransitionDragData,
	resolveTransitionDropTarget,
	type TransitionDropTarget
} from '$lib/video-editor/timeline/transition-drop';
import {
	addAdjustmentLayerWithEffects,
	addEffectTemplates
} from '$lib/video-editor/timeline/actions/effects';
import {
	clearSceneDragData,
	getSceneDragData
} from '$lib/video-editor/media/scene-search/scene-drag';
import { insertSceneAtFrame } from '$lib/video-editor/media/scene-search/scene-insert';
import {
	clearActiveMediaDrag,
	getMediaDragData,
	type MediaDragData
} from '$lib/video-editor/media/media-drag';
import { mediaPlacement } from '$lib/video-editor/media/media-placement.svelte';
import {
	clearStickerDragData,
	getActiveStickerForDrag,
	getStickerDragData
} from '$lib/video-editor/stickers/sticker-drag';
import {
	fluentEmojiAttribution,
	fluentEmojiStickerFile,
	loadFluentEmojiCatalog
} from '$lib/video-editor/stickers/fluent-emoji';
import { commitImportedAsset } from '$lib/video-editor/media/commit-imported-asset';
import {
	clearStockDragData,
	getActiveStockAsset,
	getStockDragData,
	type StockDragData
} from '$lib/video-editor/media/stock-drag';
import {
	clearLottieDragData,
	getActiveLottieAnimation,
	getLottieDragData,
	type LottieDragData
} from '$lib/video-editor/lottie/lottie-drag';
import {
	LOTTIEFILES_LICENSE,
	LOTTIEFILES_LICENSE_URL,
	lottieFilesAttribution
} from '$lib/video-editor/lottie/lottiefiles-api';
import { importRemoteLottie } from '$lib/video-editor/media/import.svelte';
import {
	evaluateExactMediaPlacement,
	mediaDropAutoScrollDelta,
	mediaDurationInFrames,
	mediaTimelineKind,
	planExactSequencePlacement,
	type MediaDropRejection
} from '$lib/video-editor/media/media-drop-placement';
import { insertMediaAtFrame } from '$lib/video-editor/timeline/actions/insert-media';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { nestSequenceOnExactTracks } from '$lib/video-editor/sequences/sequence-actions';
import { wouldCreateCompositionCycle } from '$lib/video-editor/sequences/composition-graph';

export interface TimelineDropTargetsInput {
	scrollContainer: () => HTMLDivElement | null;
	headerWidth: number;
	pxToFrame: (px: number) => number;
	zoom: () => number;
	pxPerFrame: () => number;
	snapTargets: () => SnapTarget[];
	setActiveSnapTarget: (target: SnapTarget | null) => void;
	selectedItemIds: () => string[];
	selectItems: (ids: string[]) => void;
	selectTransition: (id: string | null) => void;
	projectId: () => string | null;
	importProjectAsset: () => ProjectAssetImporter | undefined;
	onedit: () => void;
}

/** A dashed placeholder shown on a track while a catalog item hovers over it. */
export interface TimelineTrackDropPreview {
	trackId: string;
	from: number;
	durationInFrames: number;
	label: string;
}

/**
 * Drop targets for the timeline: catalog drops onto clips (effects and
 * transitions), track drops (generated items, stickers, stock, Lottie, scenes,
 * effect adjustment layers) and native or accessible media placement. Each
 * preview state lives with its handlers; the panel keeps selection ownership
 * and passes geometry and callbacks in. Must be created during component
 * initialization because it registers window listeners through effects.
 */
export function createTimelineDropTargets(deps: TimelineDropTargetsInput) {
	let effectDropTargetIds = $state<string[]>([]);
	let effectDropHoveredItemId = $state<string | null>(null);
	let effectAdjustmentDropPreview = $state<TimelineTrackDropPreview | null>(null);
	let transitionDropPreview = $state<(TransitionDropTarget & { hoveredItemId: string }) | null>(
		null
	);
	let transitionBridgeDropPreviewId = $state<string | null>(null);
	let sceneDropPreview = $state<
		(Omit<TimelineTrackDropPreview, 'trackId'> & { trackId: string | null }) | null
	>(null);
	let generatedItemDropPreview = $state<TimelineTrackDropPreview | null>(null);
	let stickerDropPreview = $state<TimelineTrackDropPreview | null>(null);
	let stickerDropPending = $state(false);
	let stockDropPreview = $state<TimelineTrackDropPreview | null>(null);
	let stockDropPending = $state(false);
	let lottieDropPreview = $state<TimelineTrackDropPreview | null>(null);
	let lottieDropPending = $state(false);
	let mediaDropPreview = $state<{
		trackId: string;
		secondaryTrackId: string | null;
		from: number;
		durationInFrames: number;
		label: string;
		valid: boolean;
		reason: MediaDropRejection | null;
		snapTarget: SnapTarget | null;
	} | null>(null);
	let pendingMediaDrop = $state<{
		clientX: number;
		trackId: string;
		payload: MediaDragData;
	} | null>(null);
	let activeNativeMediaDrop: {
		clientX: number;
		trackId: string;
		payload: MediaDragData;
	} | null = null;
	let mediaDropAnimationFrame: number | null = null;
	let mediaDropAutoScrollFrame: number | null = null;
	let mediaDropSnapTargets: SnapTarget[] | null = null;
	let handledPlacementRequestId = 0;
	interface SnappedMediaFrame {
		from: number;
		snapTarget: SnapTarget | null;
	}

	$effect(() => {
		if (
			effectDropTargetIds.length === 0 &&
			!effectAdjustmentDropPreview &&
			!transitionDropPreview &&
			!transitionBridgeDropPreviewId
		)
			return;
		const clear = () => {
			clearEffectDropPreview();
			clearTransitionDropPreview();
		};
		window.addEventListener('dragend', clear);
		window.addEventListener('drop', clear);
		return () => {
			window.removeEventListener('dragend', clear);
			window.removeEventListener('drop', clear);
		};
	});

	$effect(() => {
		if (!mediaDropPreview || mediaPlacement.request) return;
		const clear = () => {
			clearMediaDropPreview();
			clearActiveMediaDrag();
		};
		window.addEventListener('dragend', clear);
		window.addEventListener('drop', clear);
		return () => {
			window.removeEventListener('dragend', clear);
			window.removeEventListener('drop', clear);
		};
	});

	$effect(() => {
		if (!generatedItemDropPreview) return;
		const clear = () => {
			generatedItemDropPreview = null;
			clearGeneratedItemDragData();
		};
		window.addEventListener('dragend', clear);
		window.addEventListener('drop', clear);
		return () => {
			window.removeEventListener('dragend', clear);
			window.removeEventListener('drop', clear);
		};
	});

	$effect(() => {
		const request = mediaPlacement.request;
		if (!request || request.requestId === handledPlacementRequestId) return;
		handledPlacementRequestId = request.requestId;
		beginAccessibleMediaPlacement(request.payload);
	});

	function clearEffectDropPreview(): void {
		effectDropTargetIds = [];
		effectDropHoveredItemId = null;
		effectAdjustmentDropPreview = null;
	}

	function clearTransitionDropPreview(): void {
		transitionDropPreview = null;
		transitionBridgeDropPreviewId = null;
	}

	function transitionTargetAtPointer(
		event: DragEvent,
		itemId: string
	): TransitionDropTarget | null {
		const payload = getTransitionDragData();
		if (!payload || !(event.currentTarget instanceof HTMLElement)) return null;
		const rect = event.currentTarget.getBoundingClientRect();
		const edge = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
		return resolveTransitionDropTarget({
			itemId,
			edge,
			items: timelineStore.items,
			tracks: effectiveMediaTracks(timelineStore.tracks),
			transitions: transitionsStore.list,
			fps: timelineStore.fps,
			presentation: payload.presentation
		});
	}

	function previewTransitionDrop(event: DragEvent, itemId: string): void {
		const target = transitionTargetAtPointer(event, itemId);
		if (!target) {
			clearTransitionDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		transitionDropPreview = { ...target, hoveredItemId: itemId };
	}

	function leaveTransitionDrop(event: DragEvent, itemId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (transitionDropPreview?.hoveredItemId === itemId) clearTransitionDropPreview();
	}

	function dropTransition(event: DragEvent, itemId: string): boolean {
		const payload = getTransitionDragData();
		if (!payload) return false;
		const target = transitionTargetAtPointer(event, itemId);
		clearTransitionDropPreview();
		clearTransitionDragData();
		event.preventDefault();
		event.stopPropagation();
		if (!target) return true;
		try {
			let transitionId = target.existingTransitionId;
			if (transitionId) {
				if (!updateTransitionPresentation(transitionId, payload.presentation, payload.direction)) {
					emitEditorSound('error', editorSession.clock.isPlaying);
					return true;
				}
			} else {
				transitionId = addTransition(
					target.fromItemId,
					target.toItemId,
					'crossfade',
					target.suggestedDurationInFrames,
					{ presentation: payload.presentation, direction: payload.direction }
				);
			}
			deps.selectTransition(transitionId ?? null);
			deps.onedit();
		} catch {
			emitEditorSound('error', editorSession.clock.isPlaying);
		}
		return true;
	}

	function transitionTargetForBridge(transitionId: string): TransitionDropTarget | null {
		const payload = getTransitionDragData();
		const transition = transitionsStore.list.find((candidate) => candidate.id === transitionId);
		if (!payload || !transition) return null;
		const target = resolveTransitionDropTarget({
			itemId: transition.fromItemId,
			edge: 'right',
			items: timelineStore.items,
			tracks: effectiveMediaTracks(timelineStore.tracks),
			transitions: transitionsStore.list,
			fps: timelineStore.fps,
			presentation: payload.presentation
		});
		return target?.existingTransitionId === transitionId ? target : null;
	}

	function previewTransitionBridgeDrop(event: DragEvent, transitionId: string): void {
		if (!transitionTargetForBridge(transitionId)) {
			clearTransitionDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		transitionDropPreview = null;
		transitionBridgeDropPreviewId = transitionId;
	}

	function leaveTransitionBridgeDrop(event: DragEvent, transitionId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (transitionBridgeDropPreviewId === transitionId) clearTransitionDropPreview();
	}

	function dropTransitionOnBridge(event: DragEvent, transitionId: string): void {
		const payload = getTransitionDragData();
		const target = transitionTargetForBridge(transitionId);
		clearTransitionDropPreview();
		clearTransitionDragData();
		if (!payload) return;
		event.preventDefault();
		event.stopPropagation();
		if (
			!target ||
			!updateTransitionPresentation(transitionId, payload.presentation, payload.direction)
		) {
			emitEditorSound('error', editorSession.clock.isPlaying);
			return;
		}
		deps.selectTransition(transitionId);
		deps.onedit();
	}

	function previewCatalogDrop(event: DragEvent, itemId: string): void {
		if (getTransitionDragData()) {
			clearEffectDropPreview();
			previewTransitionDrop(event, itemId);
			return;
		}
		previewEffectDrop(event, itemId);
	}

	function leaveCatalogDrop(event: DragEvent, itemId: string): void {
		leaveEffectDrop(event, itemId);
		leaveTransitionDrop(event, itemId);
	}

	function dropCatalogItem(event: DragEvent, itemId: string): void {
		if (dropTransition(event, itemId)) return;
		dropEffect(event, itemId);
	}

	function resolveEffectTargets(itemId: string, payload: EffectDragData | null): string[] {
		if (!payload) return [];
		const lockedTrackIds = new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		return resolveEffectDropTargetIds({
			hoveredItemId: itemId,
			items: timelineStore.items,
			selectedItemIds: deps.selectedItemIds()
		}).filter((targetId) => {
			const target = timelineStore.itemById.get(targetId);
			return !!target && !lockedTrackIds.has(target.trackId);
		});
	}

	function previewEffectDrop(event: DragEvent, itemId: string): void {
		const targetItemIds = resolveEffectTargets(itemId, getEffectDragData());
		if (targetItemIds.length === 0) {
			clearEffectDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		if (
			effectDropHoveredItemId === itemId &&
			areItemIdListsEqual(effectDropTargetIds, targetItemIds)
		) {
			return;
		}
		effectDropTargetIds = targetItemIds;
		effectDropHoveredItemId = itemId;
	}

	function leaveEffectDrop(event: DragEvent, itemId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (effectDropHoveredItemId === itemId) clearEffectDropPreview();
	}

	function dropEffect(event: DragEvent, itemId: string): void {
		const payload = getEffectDragData();
		const targetItemIds = resolveEffectTargets(itemId, payload);
		clearEffectDropPreview();
		clearEffectDragData();
		if (!payload || targetItemIds.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (addEffectTemplates(targetItemIds, payload.effects)) deps.onedit();
	}

	function previewEffectAdjustmentDrop(event: DragEvent, trackId: string): boolean {
		const payload = getEffectDragData();
		if (!payload) return false;
		const track = effectiveMediaTracks(timelineStore.tracks).find(
			(candidate) => candidate.id === trackId
		);
		if (!track || track.kind === 'audio' || track.locked) {
			effectAdjustmentDropPreview = null;
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			return true;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		effectAdjustmentDropPreview = {
			trackId,
			from: sceneFrameAtPointer(event),
			durationInFrames: timelineStore.fps * 3,
			label: payload.label
		};
		return true;
	}

	function dropEffectAdjustment(event: DragEvent, trackId: string): boolean {
		const payload = getEffectDragData();
		if (!payload) return false;
		const preview = effectAdjustmentDropPreview;
		clearEffectDropPreview();
		clearEffectDragData();
		event.preventDefault();
		event.stopPropagation();
		if (!preview || preview.trackId !== trackId) return true;
		try {
			const itemId = addAdjustmentLayerWithEffects(payload.label, payload.effects, {
				frame: preview.from,
				preferredTrackId: trackId
			});
			deps.selectItems([itemId]);
			deps.onedit();
		} catch {
			emitEditorSound('error', editorSession.clock.isPlaying);
		}
		return true;
	}

	function sceneFrameAtPointer(event: DragEvent): number {
		const scrollContainer = deps.scrollContainer();
		if (!scrollContainer) return timelineStore.currentFrame;
		const rect = scrollContainer.getBoundingClientRect();
		return Math.max(
			0,
			deps.pxToFrame(event.clientX - rect.left + scrollContainer.scrollLeft - deps.headerWidth)
		);
	}

	function previewGeneratedItemDrop(event: DragEvent, trackId: string): boolean {
		const payload = getGeneratedItemDragData(event.dataTransfer);
		if (!payload) return false;
		const track = effectiveMediaTracks(timelineStore.tracks).find(
			(candidate) => candidate.id === trackId
		);
		const libraryEntry =
			payload.kind === 'library'
				? videoLibrary.entries.find((entry) => entry.id === payload.entryId)
				: undefined;
		const recipe = libraryEntry?.recipe;
		const libraryTimeline = recipe?.kind === 'selection' ? recipe.project.timeline : undefined;
		const audioOnly = libraryTimeline?.items.every((item) => item.type === 'audio') ?? false;
		if (
			(payload.kind === 'library' && !libraryEntry) ||
			!track ||
			(audioOnly ? track.kind !== 'audio' : track.kind === 'audio') ||
			track.locked
		) {
			generatedItemDropPreview = null;
			return true;
		}
		const from = sceneFrameAtPointer(event);
		const timer =
			payload.kind === 'timer'
				? payload.timer
				: recipe?.kind === 'timer'
					? recipe.timer
					: undefined;
		const durationInFrames =
			libraryTimeline && recipe?.kind === 'selection'
				? Math.round(
						(Math.max(...libraryTimeline.items.map((item) => item.from + item.durationInFrames)) *
							timelineStore.fps) /
							recipe.project.metadata.fps
					)
				: Math.round(timelineStore.fps * (timer ? 10 + (timer.finishHoldSeconds ?? 0) : 3));
		const itemType = audioOnly
			? 'audio'
			: payload.kind === 'shape'
				? 'shape'
				: payload.kind === 'background'
					? 'background'
					: 'text';
		if (!trackRangeIsOpen(timelineStore.items, trackId, from, durationInFrames, itemType)) {
			generatedItemDropPreview = null;
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			return true;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		generatedItemDropPreview = {
			trackId,
			from,
			durationInFrames,
			label: payload.label
		};
		sceneDropPreview = null;
		return true;
	}

	function insertGeneratedItem(
		payload: GeneratedItemDragData,
		frame: number,
		preferredTrackId: string
	): string {
		if (payload.kind === 'library')
			throw new Error('Library entries require asynchronous insertion.');
		if (payload.kind === 'timer')
			return addTimer(payload.timer, payload.label, { from: frame, trackId: preferredTrackId });
		if (payload.kind === 'shape') {
			return addShapeItem(payload.shapeType, payload.label, payload.style, {
				frame,
				preferredTrackId
			});
		}
		if (payload.kind === 'background') {
			return addBackgroundItem(payload.presetId, { frame, preferredTrackId });
		}
		return payload.presetId
			? addTextTemplateItem(payload.presetId, localizedTextStylePresetCopy(payload.presetId), {
					frame,
					preferredTrackId
				})
			: addTextItemAtFrame(payload.label, frame, preferredTrackId);
	}

	function dropGeneratedItem(event: DragEvent, trackId: string): boolean {
		const payload = getGeneratedItemDragData(event.dataTransfer);
		if (!payload) return false;
		const preview = generatedItemDropPreview;
		generatedItemDropPreview = null;
		clearGeneratedItemDragData();
		event.preventDefault();
		event.stopPropagation();
		if (!preview || preview.trackId !== trackId) return true;
		if (payload.kind === 'library') {
			const entry = videoLibrary.entries.find((entry) => entry.id === payload.entryId);
			if (!entry) return true;
			void applyLibraryEntry($state.snapshot(entry), {
				selectedIds: [],
				importAsset: deps.importProjectAsset(),
				placement: { from: preview.from, trackId }
			})
				.then((ids) => {
					if (!ids.length) return;
					deps.selectItems(ids);
					deps.onedit();
				})
				.catch((cause) =>
					showToast(cause instanceof Error ? cause.message : String(cause), 'error')
				);
			return true;
		}
		try {
			const itemId = insertGeneratedItem(payload, preview.from, trackId);
			deps.selectItems([itemId]);
			deps.onedit();
		} catch {
			emitEditorSound('error', editorSession.clock.isPlaying);
		}
		return true;
	}

	/**
	 * Preview for asset imports (stickers, stock, Lottie) that land on exactly
	 * the hovered track. Returns null when the import cannot start or the range
	 * is occupied.
	 */
	function previewExactImportDrop(
		event: DragEvent,
		trackId: string,
		pending: boolean,
		durationInFrames: number,
		label: string
	): TimelineTrackDropPreview | null {
		if (!deps.projectId() || pending) return null;
		const result = evaluateExactMediaPlacement({
			trackId,
			from: sceneFrameAtPointer(event),
			durationInFrames,
			kind: 'video',
			tracks: timelineStore.tracks,
			items: timelineStore.items
		});
		if (!result.valid) {
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			return null;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		return { trackId, from: result.placement.from, durationInFrames, label };
	}

	/** Accepts an asset import drop when its preview still targets this track. */
	function acceptExactImportDrop(
		event: DragEvent,
		trackId: string,
		preview: TimelineTrackDropPreview | null,
		pending: boolean
	): TimelineTrackDropPreview | null {
		event.preventDefault();
		event.stopPropagation();
		return preview && preview.trackId === trackId && deps.projectId() && !pending ? preview : null;
	}

	function previewStickerDrop(event: DragEvent, trackId: string): boolean {
		const payload = getStickerDragData(event.dataTransfer);
		if (!payload) return false;
		const durationInFrames = Math.max(1, timelineStore.fps * 3);
		stickerDropPreview = previewExactImportDrop(
			event,
			trackId,
			stickerDropPending,
			durationInFrames,
			payload.label
		);
		return true;
	}
	function dropSticker(event: DragEvent, trackId: string): boolean {
		const payload = getStickerDragData(event.dataTransfer);
		if (!payload) return false;
		const preview = acceptExactImportDrop(event, trackId, stickerDropPreview, stickerDropPending);
		stickerDropPreview = null;
		if (!preview) {
			clearStickerDragData();
			return true;
		}
		void commitStickerDrop(payload.name, payload.label, preview.from, preview.trackId);
		return true;
	}
	function stockDropDuration(payload: StockDragData): number {
		if (payload.kind === 'video' && payload.durationSeconds) {
			return Math.max(1, Math.round(payload.durationSeconds * timelineStore.fps));
		}
		return Math.max(1, timelineStore.fps * 3);
	}

	function previewStockDrop(event: DragEvent, trackId: string): boolean {
		const payload = getStockDragData(event.dataTransfer);
		if (!payload) return false;
		stockDropPreview = previewExactImportDrop(
			event,
			trackId,
			stockDropPending,
			stockDropDuration(payload),
			payload.label
		);
		return true;
	}
	function dropStock(event: DragEvent, trackId: string): boolean {
		const payload = getStockDragData(event.dataTransfer);
		if (!payload) return false;
		const preview = acceptExactImportDrop(event, trackId, stockDropPreview, stockDropPending);
		stockDropPreview = null;
		if (!preview) {
			clearStockDragData();
			return true;
		}
		void commitStockDrop(payload, preview.from, preview.trackId);
		return true;
	}
	async function commitStockDrop(
		payload: StockDragData,
		from: number,
		trackId: string
	): Promise<void> {
		const projectId = deps.projectId();
		stockDropPending = true;
		try {
			if (!projectId) throw new Error('The project is not ready for stock imports.');
			const asset = getActiveStockAsset(payload.provider, payload.externalId);
			const resolved = await resolveStockAsset(payload.provider, payload.externalId);
			const file = await downloadStockAsset(
				asset ?? { provider: payload.provider, external_id: payload.externalId },
				resolved
			);
			const committed = await commitImportedAsset(file, {
				projectId,
				attribution: asset
					? stockAssetAttribution(asset)
					: {
							provider: payload.provider,
							author: payload.author,
							authorUrl: payload.authorUrl,
							sourceId: payload.externalId,
							license: payload.license ?? '',
							licenseUrl: payload.licenseUrl
						},
				tags: ['stock', payload.provider],
				insertAtFrame: from,
				label: payload.label,
				exactTrackId: trackId,
				importAsset: deps.importProjectAsset()
			});
			deps.selectItems([committed.itemId]);
			clearStockDragData();
			deps.onedit();
		} catch (error) {
			emitEditorSound('error', editorSession.clock.isPlaying);
			showToast(
				error instanceof Error ? error.message : 'The stock asset could not be added.',
				'error'
			);
		} finally {
			stockDropPending = false;
		}
	}

	async function commitStickerDrop(
		name: string,
		label: string,
		from: number,
		trackId: string
	): Promise<void> {
		stickerDropPending = true;
		try {
			const sticker =
				getActiveStickerForDrag(name) ?? (await loadFluentEmojiCatalog()).byName.get(name);
			const projectId = deps.projectId();
			if (!sticker || !projectId) throw new Error('The sticker is no longer available.');
			const committed = await commitImportedAsset(fluentEmojiStickerFile(sticker), {
				projectId,
				attribution: fluentEmojiAttribution(sticker),
				tags: ['sticker', 'fluent-emoji'],
				insertAtFrame: from,
				label,
				exactTrackId: trackId,
				importAsset: deps.importProjectAsset()
			});
			deps.selectItems([committed.itemId]);
			clearStickerDragData();
			deps.onedit();
		} catch (error) {
			emitEditorSound('error', editorSession.clock.isPlaying);
			showToast(
				error instanceof Error ? error.message : m.video_editor_sticker_add_failed(),
				'error'
			);
		} finally {
			stickerDropPending = false;
		}
	}

	function previewLottieDrop(event: DragEvent, trackId: string): boolean {
		const payload = getLottieDragData(event.dataTransfer);
		if (!payload) return false;
		const durationInFrames = Math.max(1, timelineStore.fps * 3);
		lottieDropPreview = previewExactImportDrop(
			event,
			trackId,
			lottieDropPending,
			durationInFrames,
			payload.label
		);
		return true;
	}
	function dropLottie(event: DragEvent, trackId: string): boolean {
		const payload = getLottieDragData(event.dataTransfer);
		if (!payload) return false;
		const preview = acceptExactImportDrop(event, trackId, lottieDropPreview, lottieDropPending);
		lottieDropPreview = null;
		if (!preview) {
			clearLottieDragData();
			return true;
		}
		void commitLottieDrop(payload, preview.from, preview.trackId);
		return true;
	}
	async function commitLottieDrop(
		payload: LottieDragData,
		from: number,
		trackId: string
	): Promise<void> {
		const projectId = deps.projectId();
		lottieDropPending = true;
		try {
			if (!projectId) throw new Error('The project is not ready for animation imports.');
			const animation = getActiveLottieAnimation(payload.id);
			const existing = mediaPool.mediaList.find(
				(media) =>
					media.attribution?.provider === 'LottieFiles' && media.attribution.sourceId === payload.id
			);
			const mediaId =
				existing?.id ??
				(await importRemoteLottie({
					projectId,
					url: animation?.lottieUrl ?? payload.url,
					fileName: animation?.name ?? payload.label,
					attribution: animation
						? lottieFilesAttribution(animation)
						: {
								provider: 'LottieFiles',
								sourceId: payload.id,
								license: LOTTIEFILES_LICENSE,
								licenseUrl: LOTTIEFILES_LICENSE_URL
							},
					importAsset: deps.importProjectAsset()
				}));
			const media = mediaPool.get(mediaId);
			if (!media) throw new Error('The imported animation did not reach the media pool.');
			const itemId = insertMediaAtFrame(media, from, {
				exactTrackId: trackId,
				label: payload.label
			});
			deps.selectItems([itemId]);
			clearLottieDragData();
			deps.onedit();
		} catch (error) {
			emitEditorSound('error', editorSession.clock.isPlaying);
			showToast(
				error instanceof Error ? error.message : m.video_editor_lottiefiles_import_error(),
				'error'
			);
		} finally {
			lottieDropPending = false;
		}
	}

	function openSceneTrack(preferredTrackId: string, from: number, end: number): string | null {
		const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
		const preferred = effectiveTracks.find((track) => track.id === preferredTrackId);
		const candidates = [
			...(preferred ? [preferred] : []),
			...effectiveTracks
				.filter((track) => track.id !== preferredTrackId)
				.toSorted((left, right) => right.order - left.order)
		];
		return (
			candidates.find(
				(track) =>
					track.kind === 'video' &&
					!track.locked &&
					(track.visible !== false || track.id === preferredTrackId) &&
					trackRangeIsOpen(timelineStore.items, track.id, from, end - from, 'video')
			)?.id ?? null
		);
	}

	function previewSceneDrop(event: DragEvent, preferredTrackId: string): void {
		const payload = getSceneDragData(event.dataTransfer);
		const media = payload ? mediaPool.get(payload.scene.mediaId) : undefined;
		if (!payload || !media) {
			sceneDropPreview = null;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		const from = sceneFrameAtPointer(event);
		const durationInFrames = Math.max(
			1,
			Math.round((payload.scene.endSec - payload.scene.startSec) * timelineStore.fps)
		);
		const nextPreview = {
			trackId: openSceneTrack(preferredTrackId, from, from + durationInFrames),
			from,
			durationInFrames,
			label: payload.scene.text || media.fileName
		};
		if (
			sceneDropPreview?.trackId === nextPreview.trackId &&
			sceneDropPreview.from === nextPreview.from &&
			sceneDropPreview.durationInFrames === nextPreview.durationInFrames &&
			sceneDropPreview.label === nextPreview.label
		) {
			return;
		}
		sceneDropPreview = nextPreview;
	}

	function dropScene(event: DragEvent, preferredTrackId: string): void {
		const payload = getSceneDragData(event.dataTransfer);
		const media = payload ? mediaPool.get(payload.scene.mediaId) : undefined;
		if (!payload || !media) return;
		event.preventDefault();
		event.stopPropagation();
		const preview = sceneDropPreview;
		const from = preview?.from ?? sceneFrameAtPointer(event);
		const itemId = insertSceneAtFrame(
			payload.scene,
			media,
			from,
			preview?.trackId ?? preferredTrackId
		);
		deps.selectItems([itemId]);
		sceneDropPreview = null;
		clearSceneDragData();
		deps.onedit();
	}

	function resolveDraggedMedia(payload: MediaDragData) {
		if (payload.source === 'media') {
			const media = mediaPool.get(payload.id);
			const entry = mediaPool.entry(payload.id);
			if (!media || entry?.status !== 'ready') return null;
			return {
				source: 'media' as const,
				media,
				composition: null,
				kind: mediaTimelineKind(media),
				durationInFrames: mediaDurationInFrames(media, timelineStore.fps),
				label: media.fileName
			};
		}
		const composition = sequenceStore.compositionById.get(payload.id);
		if (
			!composition ||
			wouldCreateCompositionCycle(
				sequenceStore.activeSequenceId,
				composition.id,
				sequenceStore.compositionById
			)
		) {
			return null;
		}
		const visual = composition.items.some((item) => item.type !== 'audio');
		const audio = composition.items.some((item) => item.type === 'audio' || item.type === 'video');
		if (!visual && !audio) return null;
		return {
			source: 'composition' as const,
			media: null,
			composition,
			kind: visual ? ('video' as const) : ('audio' as const),
			durationInFrames: Math.max(1, composition.durationInFrames),
			label: composition.name
		};
	}

	function snappedMediaFrame(clientX: number, durationInFrames: number): SnappedMediaFrame {
		const scrollContainer = deps.scrollContainer();
		if (!scrollContainer) {
			return { from: timelineStore.currentFrame, snapTarget: null };
		}
		const rect = scrollContainer.getBoundingClientRect();
		const rawFrame = deps.pxToFrame(
			clientX - rect.left + scrollContainer.scrollLeft - deps.headerWidth
		);
		if (!timelineStore.snapEnabled) {
			return { from: Math.max(0, Math.round(rawFrame)), snapTarget: null };
		}
		mediaDropSnapTargets ??= deps.snapTargets();
		const threshold = calculateAdaptiveSnapThreshold(deps.zoom(), deps.pxPerFrame());
		const result = calculateMoveSnap(rawFrame, durationInFrames, mediaDropSnapTargets, threshold);
		return {
			from: Math.max(0, result.snappedFrame),
			snapTarget: result.snapTarget ?? null
		};
	}

	function exactMediaDropResult(
		resolved: NonNullable<ReturnType<typeof resolveDraggedMedia>>,
		trackId: string,
		from: number
	) {
		return resolved.composition
			? planExactSequencePlacement({
					composition: resolved.composition,
					preferredTrackId: trackId,
					from,
					tracks: timelineStore.tracks,
					items: timelineStore.items
				})
			: evaluateExactMediaPlacement({
					trackId,
					from,
					durationInFrames: resolved.durationInFrames,
					kind: resolved.kind,
					tracks: timelineStore.tracks,
					items: timelineStore.items
				});
	}

	function updateMediaDropPreview(
		payload: MediaDragData,
		trackId: string,
		from: number,
		snapTarget: SnapTarget | null = null
	): boolean {
		const resolved = resolveDraggedMedia(payload);
		if (!resolved) {
			clearMediaDropPreview();
			return false;
		}
		const result = exactMediaDropResult(resolved, trackId, from);
		mediaDropPreview = {
			trackId,
			secondaryTrackId:
				result.valid &&
				'audioTrackId' in result.placement &&
				result.placement.audioTrackId !== trackId
					? (result.placement.audioTrackId ?? null)
					: null,
			from: Math.max(0, Math.round(from)),
			durationInFrames: resolved.durationInFrames,
			label: resolved.label,
			valid: result.valid,
			reason: result.valid ? null : result.reason,
			snapTarget
		};
		deps.setActiveSnapTarget(snapTarget);
		return result.valid;
	}

	function clearMediaDropPreview(cancelRequest = false): void {
		mediaDropPreview = null;
		pendingMediaDrop = null;
		activeNativeMediaDrop = null;
		mediaDropSnapTargets = null;
		deps.setActiveSnapTarget(null);
		if (mediaDropAnimationFrame !== null) {
			cancelAnimationFrame(mediaDropAnimationFrame);
			mediaDropAnimationFrame = null;
		}
		if (mediaDropAutoScrollFrame !== null) {
			cancelAnimationFrame(mediaDropAutoScrollFrame);
			mediaDropAutoScrollFrame = null;
		}
		if (cancelRequest) mediaPlacement.cancel();
	}

	function runMediaDropAutoScroll(): void {
		const scrollContainer = deps.scrollContainer();
		mediaDropAutoScrollFrame = null;
		const active = activeNativeMediaDrop;
		if (!active || !scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();
		const delta = mediaDropAutoScrollDelta(active.clientX, rect.left, rect.right);
		if (delta === 0) return;
		const before = scrollContainer.scrollLeft;
		scrollContainer.scrollLeft += delta;
		if (scrollContainer.scrollLeft === before) return;
		pendingMediaDrop = active;
		if (mediaDropAnimationFrame === null) {
			mediaDropAnimationFrame = requestAnimationFrame(flushMediaDropPreview);
		}
		mediaDropAutoScrollFrame = requestAnimationFrame(runMediaDropAutoScroll);
	}

	function scheduleMediaDropAutoScroll(): void {
		if (mediaDropAutoScrollFrame === null) {
			mediaDropAutoScrollFrame = requestAnimationFrame(runMediaDropAutoScroll);
		}
	}

	function flushMediaDropPreview(): void {
		mediaDropAnimationFrame = null;
		const pending = pendingMediaDrop;
		pendingMediaDrop = null;
		if (!pending) return;
		const resolved = resolveDraggedMedia(pending.payload);
		if (!resolved) {
			clearMediaDropPreview();
			return;
		}
		const position = snappedMediaFrame(pending.clientX, resolved.durationInFrames);
		updateMediaDropPreview(pending.payload, pending.trackId, position.from, position.snapTarget);
	}

	function previewMediaDrop(event: DragEvent, trackId: string): boolean {
		const payload = getMediaDragData(event.dataTransfer);
		if (!payload || !resolveDraggedMedia(payload)) return false;
		event.preventDefault();
		event.stopPropagation();
		pendingMediaDrop = { clientX: event.clientX, trackId, payload };
		activeNativeMediaDrop = pendingMediaDrop;
		if (mediaDropAnimationFrame === null) {
			mediaDropAnimationFrame = requestAnimationFrame(flushMediaDropPreview);
		}
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect =
				mediaDropPreview?.trackId === trackId && mediaDropPreview.valid ? 'copy' : 'none';
		}
		scheduleMediaDropAutoScroll();
		return true;
	}

	function leaveTrackDrop(event: DragEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		clearMediaDropPreview();
		generatedItemDropPreview = null;
		stickerDropPreview = null;
		stockDropPreview = null;
		lottieDropPreview = null;
		effectAdjustmentDropPreview = null;
		sceneDropPreview = null;
	}

	function commitMediaPlacement(payload: MediaDragData): boolean {
		const preview = mediaDropPreview;
		const resolved = resolveDraggedMedia(payload);
		if (!preview || !preview.valid || !resolved) return false;
		try {
			const ids = resolved.media
				? [
						insertMediaAtFrame(resolved.media, preview.from, {
							exactTrackId: preview.trackId,
							label: resolved.label
						})
					]
				: nestSequenceOnExactTracks(resolved.composition!.id, preview.from, {
						visualTrackId: resolved.kind === 'video' ? preview.trackId : undefined,
						audioTrackId:
							resolved.kind === 'audio' ? preview.trackId : (preview.secondaryTrackId ?? undefined)
					});
			deps.selectItems(ids);
			clearMediaDropPreview(true);
			clearActiveMediaDrag();
			deps.onedit();
			return true;
		} catch {
			updateMediaDropPreview(payload, preview.trackId, preview.from, preview.snapTarget);
			return false;
		}
	}

	function dropMedia(event: DragEvent, trackId: string): boolean {
		const payload = getMediaDragData(event.dataTransfer);
		const resolved = payload ? resolveDraggedMedia(payload) : null;
		if (!payload || !resolved) return false;
		event.preventDefault();
		event.stopPropagation();
		const position = snappedMediaFrame(event.clientX, resolved.durationInFrames);
		updateMediaDropPreview(payload, trackId, position.from, position.snapTarget);
		const inserted = commitMediaPlacement(payload);
		if (!inserted) {
			clearMediaDropPreview();
			clearActiveMediaDrag();
		}
		return true;
	}

	function candidatePlacementTracks(payload: MediaDragData) {
		const resolved = resolveDraggedMedia(payload);
		if (!resolved) return [];
		return visibleTrackRows(timelineStore.tracks).filter(
			(track) => !isTrackGroup(track) && track.kind === resolved.kind
		);
	}

	function beginAccessibleMediaPlacement(payload: MediaDragData): void {
		const resolved = resolveDraggedMedia(payload);
		const candidates = candidatePlacementTracks(payload);
		if (!resolved || candidates.length === 0) {
			clearMediaDropPreview(true);
			return;
		}
		const from = timelineStore.currentFrame;
		const open = candidates.find((track) => exactMediaDropResult(resolved, track.id, from).valid);
		updateMediaDropPreview(payload, (open ?? candidates[0])!.id, from);
		queueMicrotask(() => deps.scrollContainer()?.focus({ preventScroll: true }));
	}

	function moveAccessibleMediaTrack(payload: MediaDragData, direction: -1 | 1): void {
		if (!mediaDropPreview) return;
		const candidates = candidatePlacementTracks(payload);
		if (candidates.length === 0) return;
		const currentIndex = candidates.findIndex((track) => track.id === mediaDropPreview?.trackId);
		const nextIndex = (currentIndex + direction + candidates.length) % candidates.length;
		const next = candidates[nextIndex];
		if (next) updateMediaDropPreview(payload, next.id, mediaDropPreview.from);
	}

	function handleAccessibleMediaPlacementKey(event: KeyboardEvent): boolean {
		const request = mediaPlacement.request;
		if (!request || !mediaDropPreview) return false;
		if (event.key === 'Escape') {
			event.preventDefault();
			clearMediaDropPreview(true);
			return true;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			commitMediaPlacement(request.payload);
			return true;
		}
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			moveAccessibleMediaTrack(request.payload, event.key === 'ArrowUp' ? -1 : 1);
			return true;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const delta = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
			updateMediaDropPreview(
				request.payload,
				mediaDropPreview.trackId,
				Math.max(0, mediaDropPreview.from + delta)
			);
			return true;
		}
		return false;
	}

	function placeMediaWithPointer(event: PointerEvent, trackId: string): boolean {
		const request = mediaPlacement.request;
		const resolved = request ? resolveDraggedMedia(request.payload) : null;
		if (!request || !resolved) return false;
		event.preventDefault();
		event.stopPropagation();
		const position = snappedMediaFrame(event.clientX, resolved.durationInFrames);
		updateMediaDropPreview(request.payload, trackId, position.from, position.snapTarget);
		commitMediaPlacement(request.payload);
		return true;
	}
	/** Track rows try each drop kind in priority order; scenes are the fallback. */
	function previewTrackDrop(event: DragEvent, trackId: string): void {
		if (
			!previewMediaDrop(event, trackId) &&
			!previewGeneratedItemDrop(event, trackId) &&
			!previewStickerDrop(event, trackId) &&
			!previewStockDrop(event, trackId) &&
			!previewLottieDrop(event, trackId) &&
			!previewEffectAdjustmentDrop(event, trackId)
		) {
			previewSceneDrop(event, trackId);
		}
	}

	function dropOnTrack(event: DragEvent, trackId: string): void {
		if (
			!dropMedia(event, trackId) &&
			!dropSticker(event, trackId) &&
			!dropStock(event, trackId) &&
			!dropLottie(event, trackId) &&
			!dropGeneratedItem(event, trackId) &&
			!dropEffectAdjustment(event, trackId)
		) {
			dropScene(event, trackId);
		}
	}

	/** Keeps the accessible placement preview under the pointer while it moves. */
	function hoverMediaPlacement(event: PointerEvent, trackId: string): void {
		const request = mediaPlacement.request;
		const resolved = request ? resolveDraggedMedia(request.payload) : null;
		if (!request || !resolved) return;
		const position = snappedMediaFrame(event.clientX, resolved.durationInFrames);
		updateMediaDropPreview(request.payload, trackId, position.from, position.snapTarget);
	}

	return {
		get effectDropTargetIds() {
			return effectDropTargetIds;
		},
		get effectDropHoveredItemId() {
			return effectDropHoveredItemId;
		},
		get effectAdjustmentDropPreview() {
			return effectAdjustmentDropPreview;
		},
		get transitionDropPreview() {
			return transitionDropPreview;
		},
		get transitionBridgeDropPreviewId() {
			return transitionBridgeDropPreviewId;
		},
		get sceneDropPreview() {
			return sceneDropPreview;
		},
		get generatedItemDropPreview() {
			return generatedItemDropPreview;
		},
		get stickerDropPreview() {
			return stickerDropPreview;
		},
		get stockDropPreview() {
			return stockDropPreview;
		},
		get lottieDropPreview() {
			return lottieDropPreview;
		},
		get mediaDropPreview() {
			return mediaDropPreview;
		},
		clearEffectDropPreview,
		clearMediaDropPreview,
		previewCatalogDrop,
		leaveCatalogDrop,
		dropCatalogItem,
		previewTransitionBridgeDrop,
		leaveTransitionBridgeDrop,
		dropTransitionOnBridge,
		previewTrackDrop,
		leaveTrackDrop,
		dropOnTrack,
		placeMediaWithPointer,
		hoverMediaPlacement,
		handleAccessibleMediaPlacementKey
	};
}

export type TimelineDropTargets = ReturnType<typeof createTimelineDropTargets>;
