<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { ShapePathVertex, TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		clearPathVertexKeyframes,
		commitPathGeometryAtFrame,
		keyPathVerticesAtFrame
	} from '$lib/video-editor/timeline/actions/path-vertex-keyframes';
	import { hasPathVertexKeyframes } from '$lib/video-editor/timeline/path-vertex-keyframes';
	import { pathVertexSelectionStore } from '$lib/video-editor/timeline/stores/path-vertex-selection-store.svelte';
	import {
		closestPathSegment,
		fitDrawnPath,
		insertPathVertex,
		movePathHandle,
		movePathVertex,
		pathSvgData,
		pathVertexToBezier,
		pathVertexToCorner,
		removePathVertex
	} from '$lib/video-editor/shapes/path-edit';

	let {
		item,
		canvasWidth,
		canvasHeight,
		currentFrame,
		boxStyle,
		screenScale,
		onedit
	}: {
		item: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		currentFrame: number;
		boxStyle: string;
		screenScale: number;
		onedit: () => void;
	} = $props();

	let svg = $state<SVGSVGElement | null>(null);
	let drawing = $state(false);
	let selectedIndex = $state<number | null>(null);
	let selectedIndices = $state<number[]>([]);
	let draftVertices = $state<ShapePathVertex[] | null>(null);
	let pendingVertex = $state<ShapePathVertex | null>(null);
	let status = $state('');
	let previousItemId = '';

	type OverlayPoint = { x: number; y: number };

	const width = $derived(Math.max(1, item.transform?.width ?? canvasWidth));
	const height = $derived(Math.max(1, item.transform?.height ?? canvasHeight));
	const storedVertices = $derived(item.pathVertices ?? []);
	const mustClose = $derived(item.isMask === true);
	const topologyLocked = $derived(hasPathVertexKeyframes(item.keyframes));
	const showAllLanes = $derived(pathVertexSelectionStore.forItem(item.id).showAll);
	const visibleVertices = $derived(
		draftVertices ?? (pendingVertex ? [...storedVertices, pendingVertex] : storedVertices)
	);
	const pathData = $derived(
		pathSvgData(
			visibleVertices,
			width,
			height,
			drawing ? false : mustClose || item.pathClosed !== false
		)
	);
	const selectedVertex = $derived(
		selectedIndex === null ? undefined : visibleVertices[selectedIndex]
	);

	$effect(() => {
		if (item.id === previousItemId) return;
		previousItemId = item.id;
		drawing = (item.pathVertices?.length ?? 0) === 0;
		selectedIndex = null;
		selectedIndices = [];
		pathVertexSelectionStore.select(item.id, []);
		draftVertices = null;
		pendingVertex = null;
		status = '';
	});

	function localPoint(event: PointerEvent | MouseEvent): OverlayPoint {
		const matrix = svg?.getScreenCTM();
		if (!matrix) return { x: 0, y: 0 };
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		return {
			x: Math.min(width, Math.max(0, point.x)),
			y: Math.min(height, Math.max(0, point.y))
		};
	}

	function normalizedPoint(point: OverlayPoint): [number, number] {
		return [point.x / width, point.y / height];
	}

	function commitTopology(patch: Partial<TimelineItem>): void {
		if (topologyLocked) {
			status = m.video_editor_path_topology_locked();
			return;
		}
		updateItemProperties(item.id, patch, 'UPDATE_PATH_GEOMETRY');
		status = '';
		onedit();
	}

	function commitGeometry(vertices: ShapePathVertex[]): void {
		const result = commitPathGeometryAtFrame(item.id, currentFrame, vertices);
		if (result === 'frame') {
			status = m.video_editor_path_animation_frame_blocked();
			return;
		}
		if (result === 'topology') {
			status = m.video_editor_path_topology_locked();
			return;
		}
		status = '';
		if (result === 'committed') onedit();
	}

	function selectVertices(indices: readonly number[], primary: number | null): void {
		selectedIndices = [...new Set(indices)].filter(
			(index) => Number.isInteger(index) && index >= 0
		);
		selectedIndex = primary !== null && selectedIndices.includes(primary) ? primary : null;
		pathVertexSelectionStore.select(item.id, selectedIndices);
	}

	function addVertex(event: PointerEvent): void {
		if (!drawing || event.target !== svg) return;
		event.preventDefault();
		const start = normalizedPoint(localPoint(event));
		pendingVertex = {
			position: start,
			inHandle: [0, 0],
			outHandle: [0, 0],
			tangentMode: 'corner'
		};
		const pointerId = event.pointerId;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId || !pendingVertex) return;
			const current = normalizedPoint(localPoint(next));
			const handle: [number, number] = [current[0] - start[0], current[1] - start[1]];
			pendingVertex = {
				...pendingVertex,
				inHandle: [-handle[0], -handle[1]],
				outHandle: handle,
				tangentMode: Math.hypot(handle[0] * width, handle[1] * height) > 2 ? 'continuous' : 'corner'
			};
		};
		const finish = (next: PointerEvent) => {
			if (next.pointerId !== pointerId || !pendingVertex) return;
			move(next);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			const vertex = pendingVertex;
			pendingVertex = null;
			const vertices = [...storedVertices, vertex];
			selectVertices([vertices.length - 1], vertices.length - 1);
			commitTopology({ pathVertices: vertices, pathClosed: false });
		};
		const cancel = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			pendingVertex = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
	}

	function finishDrawing(closed: boolean): void {
		const vertices = storedVertices;
		const resolvedClosed = mustClose || closed;
		if (vertices.length < (resolvedClosed ? 3 : 2)) return;
		const fitted = fitDrawnPath(
			vertices,
			item.transform ?? { width: canvasWidth, height: canvasHeight },
			canvasWidth,
			canvasHeight,
			Math.max(4, (item.strokeWidth ?? 8) / 2)
		);
		drawing = false;
		selectVertices([], null);
		commitTopology({
			pathVertices: fitted.vertices,
			pathClosed: resolvedClosed,
			transform: fitted.transform,
			fillEnabled: item.isMask
				? item.fillEnabled
				: resolvedClosed
					? (item.fillEnabled ?? true)
					: false,
			strokeEnabled: item.isMask ? item.strokeEnabled : true
		});
	}

	function attachEditGesture(
		event: PointerEvent,
		update: (point: [number, number], event: PointerEvent) => ShapePathVertex[]
	): void {
		event.preventDefault();
		event.stopPropagation();
		const pointerId = event.pointerId;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			draftVertices = update(normalizedPoint(localPoint(next)), next);
		};
		const finish = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			move(next);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			const vertices = draftVertices;
			draftVertices = null;
			if (vertices) commitGeometry(vertices);
		};
		const cancel = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			draftVertices = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
	}

	function startVertex(event: PointerEvent, index: number): void {
		if (drawing && index === 0 && storedVertices.length >= 3) {
			event.preventDefault();
			event.stopPropagation();
			finishDrawing(true);
			return;
		}
		if (event.shiftKey) {
			const next = selectedIndices.includes(index)
				? selectedIndices.filter((selected) => selected !== index)
				: [...selectedIndices, index];
			selectVertices(next, next.includes(index) ? index : (next.at(-1) ?? null));
			if (!next.includes(index)) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		} else {
			selectVertices([index], index);
		}
		const base = storedVertices;
		attachEditGesture(event, (position) => movePathVertex(base, index, position));
	}

	function startHandle(event: PointerEvent, handle: 'in' | 'out'): void {
		if (selectedIndex === null) return;
		const index = selectedIndex;
		const vertex = storedVertices[index];
		if (!vertex) return;
		const base = storedVertices;
		attachEditGesture(event, (position, pointer) =>
			movePathHandle(
				base,
				index,
				handle,
				[position[0] - vertex.position[0], position[1] - vertex.position[1]],
				pointer.altKey
			)
		);
	}

	function toggleVertex(event: MouseEvent, index: number): void {
		event.preventDefault();
		event.stopPropagation();
		const vertex = storedVertices[index];
		if (!vertex) return;
		const hasHandles =
			vertex.inHandle[0] !== 0 ||
			vertex.inHandle[1] !== 0 ||
			vertex.outHandle[0] !== 0 ||
			vertex.outHandle[1] !== 0;
		commitGeometry(
			hasHandles
				? pathVertexToCorner(storedVertices, index)
				: pathVertexToBezier(storedVertices, index, item.pathClosed !== false)
		);
	}

	function insertOnPath(event: MouseEvent): void {
		if (drawing || topologyLocked || storedVertices.length < 2) return;
		event.preventDefault();
		event.stopPropagation();
		const nearest = closestPathSegment(
			storedVertices,
			normalizedPoint(localPoint(event)),
			item.pathClosed !== false
		);
		if (!nearest) return;
		const vertices = insertPathVertex(storedVertices, nearest.afterIndex, nearest.t);
		selectVertices([nearest.afterIndex + 1], nearest.afterIndex + 1);
		commitTopology({ pathVertices: vertices });
	}

	function insertAfterSelected(): void {
		if (selectedIndex === null || topologyLocked || storedVertices.length < 2) return;
		const lastOpenVertex = item.pathClosed === false && selectedIndex === storedVertices.length - 1;
		const afterIndex = lastOpenVertex ? selectedIndex - 1 : selectedIndex;
		const vertices = insertPathVertex(storedVertices, Math.max(0, afterIndex), 0.5);
		selectVertices([Math.max(0, afterIndex) + 1], Math.max(0, afterIndex) + 1);
		commitTopology({ pathVertices: vertices });
	}

	function removeSelected(): void {
		if (selectedIndex === null || topologyLocked) return;
		const minimum = mustClose || item.pathClosed !== false ? 3 : 2;
		if (storedVertices.length - selectedIndices.length < minimum) return;
		let vertices: ShapePathVertex[] | null = storedVertices;
		for (const index of selectedIndices.toSorted((left, right) => right - left)) {
			vertices = vertices ? removePathVertex(vertices, index, minimum) : null;
		}
		if (!vertices) return;
		const nextIndex = Math.min(selectedIndex, vertices.length - 1);
		selectVertices([nextIndex], nextIndex);
		commitTopology({ pathVertices: vertices });
	}

	function vertexKeydown(event: KeyboardEvent, index: number): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			selectVertices([index], index);
			removeSelected();
			return;
		}
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const vertex = storedVertices[index];
		if (!vertex) return;
		const step = event.shiftKey ? 10 : 1;
		commitGeometry(
			movePathVertex(storedVertices, index, [
				Math.min(1, Math.max(0, vertex.position[0] + (dx * step) / width)),
				Math.min(1, Math.max(0, vertex.position[1] + (dy * step) / height))
			])
		);
	}

	function editorKeydown(event: KeyboardEvent): void {
		if (drawing && (event.key === 'Enter' || event.key === 'Escape')) {
			event.preventDefault();
			finishDrawing(mustClose);
		} else if (drawing && event.key === 'Backspace') {
			event.preventDefault();
			if (storedVertices.length > 0) commitTopology({ pathVertices: storedVertices.slice(0, -1) });
		} else if (!drawing && (event.key === 'Delete' || event.key === 'Backspace')) {
			event.preventDefault();
			removeSelected();
		}
	}

	function keySelectedVertices(): void {
		if (selectedIndices.length === 0) return;
		if (keyPathVerticesAtFrame(item.id, currentFrame, selectedIndices)) {
			status = '';
			onedit();
		} else {
			status = m.video_editor_path_animation_frame_blocked();
		}
	}

	function keyAllVertices(): void {
		if (keyPathVerticesAtFrame(item.id, currentFrame, 'all')) {
			status = '';
			onedit();
		} else {
			status = m.video_editor_path_animation_frame_blocked();
		}
	}

	function clearPathKeys(): void {
		if (!clearPathVertexKeyframes(item.id)) return;
		status = '';
		onedit();
	}

	function vertexPoint(vertex: ShapePathVertex): OverlayPoint {
		return { x: vertex.position[0] * width, y: vertex.position[1] * height };
	}

	function handlePoint(vertex: ShapePathVertex, handle: 'in' | 'out'): OverlayPoint {
		const offset = handle === 'in' ? vertex.inHandle : vertex.outHandle;
		return {
			x: (vertex.position[0] + offset[0]) * width,
			y: (vertex.position[1] + offset[1]) * height
		};
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- application surface owns point drawing and keyboard editing -->
<div
	class="pointer-events-auto absolute border border-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_black]"
	style={boxStyle}
	data-path-editor
	role="application"
	tabindex="0"
	aria-label={drawing
		? m.video_editor_path_draw_instruction()
		: m.video_editor_path_edit_instruction()}
	onpointerdown={addVertex}
	onkeydown={editorKeydown}
>
	<svg
		bind:this={svg}
		class:cursor-crosshair={drawing}
		class="absolute inset-0 size-full overflow-visible"
		viewBox={`0 0 ${width} ${height}`}
	>
		{#if pathData}
			<path
				d={pathData}
				fill="none"
				stroke="black"
				stroke-width="5"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				pointer-events="none"
			></path>
			<path
				d={pathData}
				fill="none"
				stroke="oklch(0.78 0.16 45)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
				pointer-events="none"
			></path>
			{#if !drawing}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<path
					d={pathData}
					fill="none"
					stroke="transparent"
					stroke-width="18"
					vector-effect="non-scaling-stroke"
					class="cursor-copy"
					ondblclick={insertOnPath}><title>{m.video_editor_path_insert_hint()}</title></path
				>
			{/if}
		{/if}

		{#if selectedVertex && selectedIndex !== null}
			{@const point = vertexPoint(selectedVertex)}
			{#each ['in', 'out'] as handle}
				{@const control = handlePoint(selectedVertex, handle as 'in' | 'out')}
				<line
					x1={point.x}
					y1={point.y}
					x2={control.x}
					y2={control.y}
					stroke="white"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
					pointer-events="none"
				></line>
				<circle
					cx={control.x}
					cy={control.y}
					r={8 / screenScale}
					fill="white"
					stroke="black"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
					class="cursor-crosshair focus:outline-none"
					role="button"
					tabindex="0"
					aria-label={handle === 'in'
						? m.video_editor_path_in_handle({ index: selectedIndex + 1 })
						: m.video_editor_path_out_handle({ index: selectedIndex + 1 })}
					onpointerdown={(event) => startHandle(event, handle as 'in' | 'out')}
				></circle>
			{/each}
		{/if}

		{#each visibleVertices as vertex, index (index)}
			{@const point = vertexPoint(vertex)}
			<circle
				cx={point.x}
				cy={point.y}
				r={drawing && index === 0 ? 9 / screenScale : 7 / screenScale}
				fill={selectedIndices.includes(index) ? 'white' : 'oklch(0.78 0.16 45)'}
				stroke="black"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
				class="cursor-move focus:outline-none focus-visible:stroke-white"
				role="button"
				tabindex="0"
				aria-pressed={selectedIndices.includes(index)}
				aria-label={drawing && index === 0
					? m.video_editor_path_close()
					: m.video_editor_path_vertex({ index: index + 1 })}
				onpointerdown={(event) => startVertex(event, index)}
				ondblclick={(event) => toggleVertex(event, index)}
				onkeydown={(event) => vertexKeydown(event, index)}
			></circle>
		{/each}
	</svg>

	<div
		class="absolute top-full left-1/2 mt-2 flex max-w-[min(34rem,90vw)] -translate-x-1/2 flex-col items-center gap-1"
	>
		<div class="rounded bg-black/85 px-2 py-1 text-[10px] whitespace-nowrap text-white shadow-lg">
			{drawing
				? m.video_editor_path_draw_hint()
				: `${m.video_editor_path_edit_hint()} ${m.video_editor_path_selection_hint()}`}
		</div>
		<div
			class="flex flex-wrap justify-center gap-1 rounded bg-black/85 p-1 text-[10px] text-white shadow-lg"
		>
			{#if drawing}
				{#if !mustClose}
					<button
						type="button"
						class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
						disabled={storedVertices.length < 2}
						onclick={() => finishDrawing(false)}>{m.video_editor_path_finish_open()}</button
					>
				{/if}
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={storedVertices.length < 3}
					onclick={() => finishDrawing(true)}>{m.video_editor_path_finish_closed()}</button
				>
			{:else}
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={selectedIndex === null || topologyLocked}
					onclick={insertAfterSelected}>{m.video_editor_path_add_point()}</button
				>
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					disabled={selectedIndex === null || topologyLocked}
					onclick={removeSelected}>{m.video_editor_path_delete_point()}</button
				>
				<button
					type="button"
					class="rounded bg-[oklch(0.66_0.14_45_/_0.22)] px-2 py-1 hover:bg-[oklch(0.66_0.14_45_/_0.35)] focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
					disabled={selectedIndices.length === 0}
					onclick={keySelectedVertices}>{m.video_editor_path_key_selected()}</button
				>
				<button
					type="button"
					class="rounded bg-[oklch(0.66_0.14_45_/_0.22)] px-2 py-1 hover:bg-[oklch(0.66_0.14_45_/_0.35)] focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
					disabled={storedVertices.length === 0}
					onclick={keyAllVertices}>{m.video_editor_path_key_all()}</button
				>
				<button
					type="button"
					class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
					aria-pressed={showAllLanes}
					onclick={() => pathVertexSelectionStore.setShowAll(item.id, !showAllLanes)}
					>{showAllLanes
						? m.video_editor_path_show_selected_lanes()
						: m.video_editor_path_show_all_lanes()}</button
				>
				{#if topologyLocked}
					<button
						type="button"
						class="rounded px-2 py-1 text-red-200 hover:bg-red-400/15 focus-visible:outline-2 focus-visible:outline-white"
						onclick={clearPathKeys}>{m.video_editor_path_clear_keys()}</button
					>
				{/if}
			{/if}
		</div>
		{#if topologyLocked || status}
			<p
				class="rounded bg-black/85 px-2 py-1 text-center text-[10px] text-amber-100 shadow-lg"
				aria-live="polite"
			>
				{status || m.video_editor_path_topology_locked()}
			</p>
		{/if}
	</div>
</div>
