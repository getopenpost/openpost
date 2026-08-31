<!-- Multi-item transform gizmo and compact canvas alignment controls. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import AlignStartVerticalIcon from '@lucide/svelte/icons/align-start-vertical';
	import AlignCenterVerticalIcon from '@lucide/svelte/icons/align-center-vertical';
	import AlignEndVerticalIcon from '@lucide/svelte/icons/align-end-vertical';
	import AlignStartHorizontalIcon from '@lucide/svelte/icons/align-start-horizontal';
	import AlignCenterHorizontalIcon from '@lucide/svelte/icons/align-center-horizontal';
	import AlignEndHorizontalIcon from '@lucide/svelte/icons/align-end-horizontal';
	import DistributeHorizontalIcon from '@lucide/svelte/icons/align-horizontal-distribute-center';
	import DistributeVerticalIcon from '@lucide/svelte/icons/align-vertical-distribute-center';
	import MagnetIcon from '@lucide/svelte/icons/magnet';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { resolvedTransformForItem } from '$lib/video-editor/timeline/animated-properties';
	import { m } from '$lib/paraglide/messages';
	import type { CanvasSnapLine } from '$lib/video-editor/preview/canvas-snapping';
	import {
		alignGroupItems,
		calculateGroupBounds,
		groupItemBounds,
		groupItemContainsPoint,
		groupRotationDelta,
		groupScaleFactor,
		initializeGroupTransform,
		rotateGroup,
		scaleGroup,
		snapGroupScale,
		snapGroupTranslation,
		translateGroup
	} from '$lib/video-editor/preview/group-transform';
	import type {
		GroupAlignment,
		GroupBounds,
		GroupTransform,
		GroupTransformState,
		Point
	} from '$lib/video-editor/preview/group-transform';

	type GestureMode = 'move' | 'scale' | 'rotate';
	interface PointerSample {
		clientX: number;
		clientY: number;
		altKey: boolean;
		shiftKey: boolean;
	}
	interface Gesture {
		pointerId: number;
		mode: GestureMode;
		startPoint: Point;
		state: GroupTransformState;
		moved: boolean;
		latest: Map<string, GroupTransform> | null;
	}

	let {
		items,
		canvasWidth,
		canvasHeight,
		currentFrame,
		isPlaying = false,
		snappingEnabled = true,
		snapItems = [],
		ontransformdraft,
		oncommit,
		onselectitem,
		ontogglesnapping,
		onedit
	}: {
		items: TimelineItem[];
		canvasWidth: number;
		canvasHeight: number;
		currentFrame: number;
		isPlaying?: boolean;
		snappingEnabled?: boolean;
		snapItems?: TimelineItem[];
		ontransformdraft: (transforms: Record<string, GroupTransform> | null) => void;
		oncommit: (frame: number, transforms: ReadonlyMap<string, GroupTransform>) => boolean;
		onselectitem: (itemId: string) => void;
		ontogglesnapping: () => void;
		onedit: () => void;
	} = $props();

	let gesture: Gesture | null = null;
	let pendingSample: PointerSample | null = null;
	let animationFrame: number | null = null;
	let snapLines = $state<CanvasSnapLine[]>([]);
	let draftTransforms = $state<Record<string, GroupTransform> | null>(null);

	const baseTransforms = $derived.by(
		() =>
			new Map(
				items.map((item) => [item.id, resolvedTransformForItem(item, canvasWidth, canvasHeight)])
			)
	);
	const displayedTransforms = $derived(
		draftTransforms ? new Map(Object.entries(draftTransforms)) : baseTransforms
	);
	const bounds = $derived(calculateGroupBounds(displayedTransforms, canvasWidth, canvasHeight));
	const otherBounds = $derived(
		snapItems
			.filter((item) => !baseTransforms.has(item.id))
			.map((item) =>
				groupItemBounds(
					resolvedTransformForItem(item, canvasWidth, canvasHeight),
					canvasWidth,
					canvasHeight
				)
			)
	);
	const alignmentActions = $derived([
		{ type: 'left', label: m.image_editor_align_left(), icon: AlignStartVerticalIcon, min: 1 },
		{
			type: 'center-horizontal',
			label: m.image_editor_align_center(),
			icon: AlignCenterVerticalIcon,
			min: 1
		},
		{ type: 'right', label: m.image_editor_align_right(), icon: AlignEndVerticalIcon, min: 1 },
		{ type: 'top', label: m.image_editor_align_top(), icon: AlignStartHorizontalIcon, min: 1 },
		{
			type: 'center-vertical',
			label: m.image_editor_align_middle(),
			icon: AlignCenterHorizontalIcon,
			min: 1
		},
		{
			type: 'bottom',
			label: m.image_editor_align_bottom(),
			icon: AlignEndHorizontalIcon,
			min: 1
		},
		{
			type: 'distribute-horizontal',
			label: m.video_editor_distribute_horizontal(),
			icon: DistributeHorizontalIcon,
			min: 3
		},
		{
			type: 'distribute-vertical',
			label: m.video_editor_distribute_vertical(),
			icon: DistributeVerticalIcon,
			min: 3
		}
	]);

	function canvasPoint(sample: PointerSample): Point {
		const monitor = document.querySelector<HTMLElement>('[data-program-monitor]');
		const rect = monitor?.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
		return {
			x: ((sample.clientX - rect.left) / rect.width) * canvasWidth,
			y: ((sample.clientY - rect.top) / rect.height) * canvasHeight
		};
	}

	function canvasScale(): number {
		const width = document.querySelector<HTMLElement>('[data-program-monitor]')?.clientWidth ?? 0;
		return width > 0 ? width / canvasWidth : 1;
	}

	function setDraft(transforms: Map<string, GroupTransform> | null): void {
		draftTransforms = transforms ? Object.fromEntries(transforms) : null;
		ontransformdraft(draftTransforms);
	}

	function calculateGesture(sample: PointerSample): Map<string, GroupTransform> | null {
		if (!gesture) return null;
		const point = canvasPoint(sample);
		if (Math.hypot(point.x - gesture.startPoint.x, point.y - gesture.startPoint.y) > 1) {
			gesture.moved = true;
		}
		if (gesture.mode === 'move') {
			let deltaX = point.x - gesture.startPoint.x;
			let deltaY = point.y - gesture.startPoint.y;
			if (snappingEnabled && !sample.altKey) {
				const snapped = snapGroupTranslation({
					transforms: gesture.state.transforms,
					deltaX,
					deltaY,
					canvasWidth,
					canvasHeight,
					canvasScale: canvasScale(),
					currentSnapLines: snapLines,
					otherItemBounds: otherBounds
				});
				deltaX = snapped.deltaX;
				deltaY = snapped.deltaY;
				snapLines = snapped.snapLines;
			} else snapLines = [];
			return translateGroup(gesture.state, deltaX, deltaY);
		}
		if (gesture.mode === 'scale') {
			let scale = groupScaleFactor(gesture.state, gesture.startPoint, point);
			if (snappingEnabled && !sample.altKey) {
				const snapped = snapGroupScale({
					state: gesture.state,
					scale,
					canvasWidth,
					canvasHeight,
					canvasScale: canvasScale(),
					currentSnapLines: snapLines
				});
				scale = snapped.scale;
				snapLines = snapped.snapLines;
			} else snapLines = [];
			return scaleGroup(gesture.state, scale, canvasWidth, canvasHeight);
		}
		let delta = groupRotationDelta(gesture.state, gesture.startPoint, point);
		if (sample.shiftKey) delta = Math.round(delta / 15) * 15;
		snapLines = [];
		return rotateGroup(gesture.state, delta, canvasWidth, canvasHeight);
	}

	function flushPointerSample(): void {
		animationFrame = null;
		const sample = pendingSample;
		pendingSample = null;
		if (!sample || !gesture) return;
		const next = calculateGesture(sample);
		gesture.latest = next;
		setDraft(next);
	}

	function pointerMove(event: PointerEvent): void {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		event.preventDefault();
		pendingSample = event;
		if (animationFrame === null) animationFrame = requestAnimationFrame(flushPointerSample);
	}

	function removeGestureListeners(): void {
		window.removeEventListener('pointermove', pointerMove);
		window.removeEventListener('pointerup', pointerUp);
		window.removeEventListener('pointercancel', cancelGesture);
		window.removeEventListener('keydown', gestureKeydown);
	}

	function clearGesture(): void {
		if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		animationFrame = null;
		pendingSample = null;
		gesture = null;
		snapLines = [];
		setDraft(null);
		removeGestureListeners();
	}

	function selectItemAt(point: Point, transforms: ReadonlyMap<string, GroupTransform>): void {
		for (const item of [...items].reverse()) {
			const transform = transforms.get(item.id);
			if (transform && groupItemContainsPoint(transform, point, canvasWidth, canvasHeight)) {
				onselectitem(item.id);
				return;
			}
		}
	}

	function pointerUp(event: PointerEvent): void {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		if (animationFrame !== null) {
			cancelAnimationFrame(animationFrame);
			animationFrame = null;
		}
		const active = gesture;
		const final = calculateGesture(event) ?? active.latest;
		if (active.moved && final && oncommit(currentFrame, final)) onedit();
		else if (!active.moved) selectItemAt(canvasPoint(event), active.state.transforms);
		clearGesture();
	}

	function cancelGesture(): void {
		if (!gesture) return;
		clearGesture();
	}

	function gestureKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		cancelGesture();
	}

	function startGesture(event: PointerEvent, mode: GestureMode): void {
		if (event.button !== 0 || gesture) return;
		event.preventDefault();
		event.stopPropagation();
		gesture = {
			pointerId: event.pointerId,
			mode,
			startPoint: canvasPoint(event),
			state: initializeGroupTransform(baseTransforms, canvasWidth, canvasHeight),
			moved: false,
			latest: null
		};
		window.addEventListener('pointermove', pointerMove, { passive: false });
		window.addEventListener('pointerup', pointerUp);
		window.addEventListener('pointercancel', cancelGesture);
		window.addEventListener('keydown', gestureKeydown);
	}

	function commitImmediate(transforms: ReadonlyMap<string, GroupTransform>): void {
		if (oncommit(currentFrame, transforms)) onedit();
	}

	function moveKeydown(event: KeyboardEvent): void {
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		commitImmediate(
			translateGroup(
				initializeGroupTransform(baseTransforms, canvasWidth, canvasHeight),
				dx * step,
				dy * step
			)
		);
	}

	function scaleKeydown(event: KeyboardEvent): void {
		const direction =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (!direction) return;
		event.preventDefault();
		commitImmediate(
			scaleGroup(
				initializeGroupTransform(baseTransforms, canvasWidth, canvasHeight),
				1 + direction * (event.shiftKey ? 0.1 : 0.01),
				canvasWidth,
				canvasHeight
			)
		);
	}

	function rotateKeydown(event: KeyboardEvent): void {
		const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (!direction) return;
		event.preventDefault();
		commitImmediate(
			rotateGroup(
				initializeGroupTransform(baseTransforms, canvasWidth, canvasHeight),
				direction * (event.shiftKey ? 15 : 1),
				canvasWidth,
				canvasHeight
			)
		);
	}

	function align(alignment: GroupAlignment): void {
		commitImmediate(alignGroupItems(baseTransforms, alignment, canvasWidth, canvasHeight));
	}

	function boxStyle(groupBounds: GroupBounds): string {
		return `left:${(groupBounds.left / canvasWidth) * 100}%;top:${(groupBounds.top / canvasHeight) * 100}%;width:${(groupBounds.width / canvasWidth) * 100}%;height:${(groupBounds.height / canvasHeight) * 100}%`;
	}

	onDestroy(cancelGesture);
</script>

<div class:opacity-60={isPlaying} class="pointer-events-none absolute inset-0 z-20">
	<div
		class="pointer-events-auto absolute top-2 left-1/2 flex max-w-[calc(100%_-_1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-md border border-white/15 bg-black/85 p-1 shadow-lg backdrop-blur"
		role="toolbar"
		aria-label={m.video_editor_align_group_toolbar()}
		data-group-alignment-toolbar
	>
		{#each alignmentActions as action (action.type)}
			{@const Icon = action.icon}
			<button
				type="button"
				class="flex size-11 shrink-0 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30 md:size-7 [@media(pointer:coarse)]:size-11"
				aria-label={action.label}
				title={action.label}
				disabled={items.length < action.min}
				onclick={() => align(action.type as GroupAlignment)}
			>
				<Icon class="size-3.5" aria-hidden="true" />
			</button>
		{/each}
		<span class="mx-0.5 h-4 w-px bg-white/15"></span>
		<button
			type="button"
			class={[
				'flex size-11 shrink-0 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:size-7 [@media(pointer:coarse)]:size-11',
				snappingEnabled && 'bg-white/15 text-white'
			]}
			aria-label={snappingEnabled
				? m.video_editor_canvas_snap_disable()
				: m.video_editor_canvas_snap_enable()}
			aria-pressed={snappingEnabled}
			title={snappingEnabled
				? m.video_editor_canvas_snap_disable()
				: m.video_editor_canvas_snap_enable()}
			onclick={ontogglesnapping}
		>
			<MagnetIcon class="size-3.5" aria-hidden="true" />
		</button>
	</div>

	{#each snapLines as line (`${line.type}-${line.position}`)}
		<div
			class="pointer-events-none absolute bg-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_black]"
			class:top-0={line.type === 'vertical'}
			class:h-full={line.type === 'vertical'}
			class:w-px={line.type === 'vertical'}
			class:left-0={line.type === 'horizontal'}
			class:h-px={line.type === 'horizontal'}
			class:w-full={line.type === 'horizontal'}
			style:left={line.type === 'vertical' ? `${(line.position / canvasWidth) * 100}%` : undefined}
			style:top={line.type === 'horizontal'
				? `${(line.position / canvasHeight) * 100}%`
				: undefined}
		></div>
	{/each}

	<button
		type="button"
		class="pointer-events-auto absolute cursor-move border border-[oklch(0.78_0.16_45)] bg-transparent shadow-[0_0_0_1px_black] focus-visible:outline-2 focus-visible:outline-white"
		style={boxStyle(bounds)}
		aria-label={m.video_editor_move_selected_count({ count: items.length })}
		onpointerdown={(event) => startGesture(event, 'move')}
		onkeydown={moveKeydown}
		data-group-transform-box
	></button>

	{#each [{ x: bounds.left, y: bounds.top, cursor: 'nwse-resize', label: m.video_editor_resize_group_nw( { count: items.length } ) }, { x: bounds.right, y: bounds.top, cursor: 'nesw-resize', label: m.video_editor_resize_group_ne( { count: items.length } ) }, { x: bounds.right, y: bounds.bottom, cursor: 'nwse-resize', label: m.video_editor_resize_group_se( { count: items.length } ) }, { x: bounds.left, y: bounds.bottom, cursor: 'nesw-resize', label: m.video_editor_resize_group_sw( { count: items.length } ) }] as handle, index}
		<button
			type="button"
			class="pointer-events-auto absolute flex size-11 -translate-1/2 items-center justify-center bg-transparent focus-visible:outline-2 focus-visible:outline-white md:size-8 [@media(pointer:coarse)]:size-11"
			style:left={`${(handle.x / canvasWidth) * 100}%`}
			style:top={`${(handle.y / canvasHeight) * 100}%`}
			style:cursor={handle.cursor}
			aria-label={handle.label}
			onpointerdown={(event) => startGesture(event, 'scale')}
			onkeydown={scaleKeydown}
			data-group-scale-handle={index}
		>
			<span class="size-2 rounded-sm border border-black bg-white shadow-[0_0_0_1px_white]"></span>
		</button>
	{/each}

	<div
		class="pointer-events-none absolute w-px -translate-x-1/2 bg-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_black]"
		style:left={`${((bounds.left + bounds.right) / 2 / canvasWidth) * 100}%`}
		style:top={`${(bounds.top / canvasHeight) * 100}%`}
		style:height="24px"
		style:transform="translate(-50%, -24px)"
	></div>
	<button
		type="button"
		class="pointer-events-auto absolute flex size-11 -translate-1/2 cursor-grab items-center justify-center rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-white active:cursor-grabbing md:size-9 [@media(pointer:coarse)]:size-11"
		style:left={`${((bounds.left + bounds.right) / 2 / canvasWidth) * 100}%`}
		style:top={`max(18px, calc(${(bounds.top / canvasHeight) * 100}% - 24px))`}
		aria-label={m.video_editor_rotate_selected_count({ count: items.length })}
		onpointerdown={(event) => startGesture(event, 'rotate')}
		onkeydown={rotateKeydown}
		data-group-rotate-handle
	>
		<span class="size-3 rounded-full border border-black bg-white shadow-[0_0_0_1px_white]"></span>
	</button>
</div>
