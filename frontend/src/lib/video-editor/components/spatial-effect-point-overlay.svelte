<!-- Direct center/origin editor for source-texture GPU effects. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import { getGpuEffect } from '$lib/video-editor/effects/gpu/registry';
	import { getSpatialPointEffectConfig } from '$lib/video-editor/effects/spatial-point-editor';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import {
		getGpuEffectKeyframeProperty,
		resolveAnimatedEffectsAt
	} from '$lib/video-editor/effects/effect-keyframes';
	import {
		canvasPointToSpatialEffectUv,
		spatialEffectUvToCanvasPoint,
		type SpatialPoint
	} from '$lib/video-editor/preview/spatial-effect-coordinates';
	import { spatialEffectEditorStore } from '$lib/video-editor/preview/spatial-effect-editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperties } from '$lib/video-editor/timeline/actions/keyframes';
	import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';

	let {
		item,
		sourceItem,
		canvasWidth,
		canvasHeight,
		currentFrame,
		onedit
	}: {
		item: TimelineItem;
		sourceItem: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		currentFrame: number;
		onedit: () => void;
	} = $props();

	interface EditingHandle {
		effectId: string;
		effectLabel: string;
		xParam: string;
		yParam: string;
		point: SpatialPoint;
	}

	let root = $state<HTMLDivElement | null>(null);
	let dragPoint = $state<SpatialPoint | null>(null);
	let dragPointerId: number | null = null;
	let dragTarget: HTMLButtonElement | null = null;
	let dragEffectId: string | null = null;
	let dragXParam = '';
	let dragYParam = '';
	let dragFrame = 0;
	let dragOffset: SpatialPoint = { x: 0, y: 0 };
	let dragStartClient: SpatialPoint = { x: 0, y: 0 };
	let dragMoved = false;
	let pendingPoint: SpatialPoint | null = null;
	let pendingPreviewFrame: number | null = null;

	function isNumberValue(value: unknown): value is number {
		return typeof value === 'number';
	}

	const locked = $derived(isTrackEffectivelyLocked(sourceItem.trackId, timelineStore.tracks));
	const supportedItem = $derived(
		['video', 'image', 'lottie', 'text', 'subtitle', 'shape'].includes(sourceItem.type)
	);
	const editingThisItem = $derived(
		spatialEffectEditorStore.isEditing && spatialEffectEditorStore.editingItemId === sourceItem.id
	);
	const geometry = $derived({ item, canvasWidth, canvasHeight });
	const editingEffectId = $derived(
		editingThisItem ? spatialEffectEditorStore.editingEffectId : null
	);
	const liveSourceItem = $derived(timelineStore.itemById.get(sourceItem.id) ?? sourceItem);
	const resolvedEffects = $derived(
		resolveAnimatedEffectsAt(liveSourceItem, currentFrame) ?? liveSourceItem.effects ?? []
	);
	const editingEffect = $derived(
		editingEffectId
			? resolvedEffects.find((candidate) => candidate.id === editingEffectId)
			: undefined
	);
	const editingConfig = $derived(
		editingEffect?.type === 'gpu' ? getSpatialPointEffectConfig(editingEffect.effectId) : null
	);
	const editorValid = $derived(
		Boolean(
			editingThisItem &&
			supportedItem &&
			!locked &&
			editingEffectId &&
			editingEffect?.enabled &&
			editingConfig
		)
	);
	const editingHandle = $derived.by((): EditingHandle | null => {
		if (!editorValid || !editingEffectId || editingEffect?.type !== 'gpu' || !editingConfig)
			return null;
		const x = editingEffect.params[editingConfig.xParam];
		const y = editingEffect.params[editingConfig.yParam];
		return {
			effectId: editingEffectId,
			effectLabel: getGpuEffect(editingEffect.effectId)?.label ?? editingEffect.effectId,
			xParam: editingConfig.xParam,
			yParam: editingConfig.yParam,
			point: dragPoint ?? {
				x: isNumberValue(x) && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5,
				y: isNumberValue(y) && Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : 0.5
			}
		};
	});
	const handleCanvasPoint = $derived(
		editingHandle ? spatialEffectUvToCanvasPoint(editingHandle.point, geometry) : null
	);

	function currentEffect(effectId: string): GpuEffect | null {
		const effect = timelineStore.itemById
			.get(sourceItem.id)
			?.effects?.find((candidate) => candidate.id === effectId);
		return effect?.type === 'gpu' && effect.enabled ? effect : null;
	}

	function clearDraft(effectId = dragEffectId): void {
		if (effectId) colorPreviewStore.clearEffectDraft(sourceItem.id, effectId);
	}

	function applyDraft(point: SpatialPoint): void {
		if (!dragEffectId) return;
		const effect = currentEffect(dragEffectId);
		if (!effect) {
			cancelDrag();
			return;
		}
		colorPreviewStore.setEffectDraft(sourceItem.id, effect, {
			[dragXParam]: point.x,
			[dragYParam]: point.y
		});
	}

	function scheduleDraft(point: SpatialPoint): void {
		pendingPoint = point;
		if (pendingPreviewFrame !== null) return;
		pendingPreviewFrame = requestAnimationFrame(() => {
			pendingPreviewFrame = null;
			const pointToApply = pendingPoint;
			pendingPoint = null;
			if (pointToApply) applyDraft(pointToApply);
		});
	}

	function cancelScheduledDraft(): void {
		if (pendingPreviewFrame !== null) cancelAnimationFrame(pendingPreviewFrame);
		pendingPreviewFrame = null;
		pendingPoint = null;
	}

	function rootCanvasPoint(clientX: number, clientY: number): SpatialPoint {
		const rect = root?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
		return {
			x: ((clientX - rect.left) / rect.width) * canvasWidth,
			y: ((clientY - rect.top) / rect.height) * canvasHeight
		};
	}

	function pointForPointer(event: PointerEvent): SpatialPoint {
		const pointer = rootCanvasPoint(event.clientX, event.clientY);
		return canvasPointToSpatialEffectUv(
			{ x: pointer.x + dragOffset.x, y: pointer.y + dragOffset.y },
			geometry
		);
	}

	function commitPoint(
		point: SpatialPoint,
		effectId: string,
		xParam: string,
		yParam: string,
		frame: number
	): boolean {
		const liveItem = timelineStore.itemById.get(sourceItem.id);
		const effect = currentEffect(effectId);
		if (!liveItem || !effect || isTrackEffectivelyLocked(liveItem.trackId, timelineStore.tracks))
			return false;
		const xProperty = getGpuEffectKeyframeProperty(effect, xParam);
		const yProperty = getGpuEffectKeyframeProperty(effect, yParam);
		if (!xProperty || !yProperty) return false;
		return setAnimatedProperties(
			sourceItem.id,
			frame,
			{ [xProperty]: point.x, [yProperty]: point.y },
			(property: KeyframeProperty) => autoKeyframeStore.isEnabled(sourceItem.id, property)
		);
	}

	function detachDragListeners(): void {
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerCancel);
		dragTarget?.removeEventListener('lostpointercapture', handleLostPointerCapture);
		if (dragTarget && dragPointerId !== null && dragTarget.hasPointerCapture(dragPointerId)) {
			try {
				dragTarget.releasePointerCapture(dragPointerId);
			} catch {
				// The browser can release capture before cleanup runs.
			}
		}
	}

	function resetDragState(): void {
		dragPointerId = null;
		dragTarget = null;
		dragEffectId = null;
		dragXParam = '';
		dragYParam = '';
		dragPoint = null;
		dragMoved = false;
	}

	function finishDrag(commit: boolean, event?: PointerEvent): void {
		if (dragPointerId === null) return;
		const effectId = dragEffectId;
		const xParam = dragXParam;
		const yParam = dragYParam;
		const frame = dragFrame;
		const finalPoint = event ? pointForPointer(event) : dragPoint;
		const moved = dragMoved;
		detachDragListeners();
		cancelScheduledDraft();
		clearDraft(effectId);
		resetDragState();
		if (commit && moved && finalPoint && effectId && xParam && yParam) {
			if (commitPoint(finalPoint, effectId, xParam, yParam, frame)) onedit();
		}
	}

	function cancelDrag(): void {
		finishDrag(false);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (event.pointerId !== dragPointerId) return;
		if (Math.hypot(event.clientX - dragStartClient.x, event.clientY - dragStartClient.y) >= 1.5) {
			dragMoved = true;
		}
		const point = pointForPointer(event);
		dragPoint = point;
		scheduleDraft(point);
	}

	function handlePointerUp(event: PointerEvent): void {
		if (event.pointerId !== dragPointerId) return;
		event.preventDefault();
		finishDrag(true, event);
	}

	function handlePointerCancel(event: PointerEvent): void {
		if (event.pointerId === dragPointerId) cancelDrag();
	}

	function handleLostPointerCapture(): void {
		cancelDrag();
	}

	function startDrag(event: PointerEvent, handle: EditingHandle): void {
		if (event.button !== 0 || locked || dragPointerId !== null || !handleCanvasPoint) return;
		const effect = currentEffect(handle.effectId);
		if (!effect) return;
		event.preventDefault();
		event.stopPropagation();
		const pointer = rootCanvasPoint(event.clientX, event.clientY);
		dragPointerId = event.pointerId;
		// SAFETY: startDrag is only bound to the handle button; currentTarget is that button.
		dragTarget = event.currentTarget as HTMLButtonElement;
		dragEffectId = handle.effectId;
		dragXParam = handle.xParam;
		dragYParam = handle.yParam;
		dragFrame = currentFrame;
		dragPoint = { ...handle.point };
		dragOffset = {
			x: handleCanvasPoint.x - pointer.x,
			y: handleCanvasPoint.y - pointer.y
		};
		dragStartClient = { x: event.clientX, y: event.clientY };
		dragMoved = false;
		try {
			dragTarget.setPointerCapture(event.pointerId);
		} catch {
			// Window listeners keep the gesture live when capture is unavailable.
		}
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerCancel);
		dragTarget.addEventListener('lostpointercapture', handleLostPointerCapture);
	}

	function nudge(event: KeyboardEvent, handle: EditingHandle): void {
		let x = 0;
		let y = 0;
		if (event.key === 'ArrowLeft') x = -1;
		else if (event.key === 'ArrowRight') x = 1;
		else if (event.key === 'ArrowUp') y = -1;
		else if (event.key === 'ArrowDown') y = 1;
		else return;
		event.preventDefault();
		event.stopPropagation();
		const step = event.shiftKey ? 0.1 : 0.01;
		const point = {
			x: Math.min(1, Math.max(0, handle.point.x + x * step)),
			y: Math.min(1, Math.max(0, handle.point.y + y * step))
		};
		if (point.x === handle.point.x && point.y === handle.point.y) return;
		if (commitPoint(point, handle.effectId, handle.xParam, handle.yParam, currentFrame)) onedit();
	}

	$effect(() => {
		if (!editingThisItem) return;
		const effectId = editingEffectId;
		if (!editorValid || !effectId) {
			cancelDrag();
			clearDraft(effectId);
			spatialEffectEditorStore.stopEditing();
			return;
		}
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			cancelDrag();
			clearDraft(effectId);
			spatialEffectEditorStore.stopEditing();
		};
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		cancelDrag();
		clearDraft(editingHandle?.effectId ?? spatialEffectEditorStore.editingEffectId);
	});
</script>

{#if editingHandle && handleCanvasPoint}
	<div
		bind:this={root}
		class="pointer-events-none absolute inset-0 z-30"
		data-spatial-effect-overlay
	>
		<button
			type="button"
			class="pointer-events-auto absolute flex size-11 cursor-move touch-none items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
			style:left={`${(handleCanvasPoint.x / canvasWidth) * 100}%`}
			style:top={`${(handleCanvasPoint.y / canvasHeight) * 100}%`}
			aria-label={m.video_editor_spatial_center_label({ effect: editingHandle.effectLabel })}
			aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
			data-spatial-effect-handle={editingHandle.effectId}
			onpointerdown={(event) => startDrag(event, editingHandle!)}
			onkeydown={(event) => nudge(event, editingHandle!)}
			oncontextmenu={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<span
				class="pointer-events-none relative flex size-6 items-center justify-center rounded-full border border-white bg-black/60 shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
				aria-hidden="true"
			>
				<span class="absolute top-1 left-1/2 h-4 -translate-x-1/2 border-l border-white"></span>
				<span class="absolute top-1/2 left-1 w-4 -translate-y-1/2 border-t border-white"></span>
				<span class="absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-white"
				></span>
			</span>
		</button>
	</div>
{/if}
