<!--
	Mask editor overlay: bezier mask-path editing surfaced as a dedicated Mask
	canvas tool. Geometry editing reuses PathEditorOverlay (pen draw, vertex /
	handle drags, segment insert, keying); this wrapper adds the mask-level
	chrome FreeCut exposes in its mask editor: an explicit Pen vs Edit mode
	switch, direction-preserving smooth conversion, and point deletion with
	atomic undo. Topology edits are refused while path-vertex keyframes exist,
	matching the inner editor.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { ShapePathVertex, TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import { commitPathGeometryAtFrame } from '$lib/video-editor/timeline/actions/path-vertex-keyframes';
	import { hasPathVertexKeyframes } from '$lib/video-editor/timeline/path-vertex-keyframes';
	import { pathVertexSelectionStore } from '$lib/video-editor/timeline/stores/path-vertex-selection-store.svelte';
	import { pathVertexToCorner, removePathVertex } from '$lib/video-editor/shapes/path-edit';
	import { maskVertexToBezier } from '$lib/video-editor/shapes/mask-vertices';
	import PathEditorOverlay from './path-editor-overlay.svelte';

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

	let session = $state(0);
	let status = $state('');

	const storedVertices = $derived(item.pathVertices ?? []);
	const closed = $derived(item.pathClosed !== false);
	const topologyLocked = $derived(hasPathVertexKeyframes(item.keyframes));
	const selection = $derived(pathVertexSelectionStore.forItem(item.id));
	const selectedIndices = $derived(selection.indices);
	const penMode = $derived(storedVertices.length === 0);
	const minimumVertexCount = $derived(closed ? 3 : 2);

	function reportGeometry(result: string): void {
		if (result === 'topology') {
			status = m.video_editor_path_topology_locked();
			return;
		}
		if (result === 'frame') {
			status = m.video_editor_path_animation_frame_blocked();
			return;
		}
		status = '';
		if (result === 'committed') onedit();
	}

	function handleInnerEdit(): void {
		status = '';
		onedit();
	}

	function startDrawNew(): void {
		if (topologyLocked) {
			status = m.video_editor_path_topology_locked();
			return;
		}
		if (storedVertices.length > 0) {
			updateItemProperties(item.id, { pathVertices: [] }, 'UPDATE_PATH_GEOMETRY');
		}
		pathVertexSelectionStore.select(item.id, []);
		status = '';
		session += 1;
		onedit();
	}

	function convertSelection(smooth: boolean): void {
		if (selectedIndices.length === 0) return;
		let vertices: ShapePathVertex[] = storedVertices;
		for (const index of selectedIndices) {
			if (!vertices[index]) continue;
			vertices = smooth
				? maskVertexToBezier(vertices, index, closed)
				: pathVertexToCorner(vertices, index);
		}
		reportGeometry(commitPathGeometryAtFrame(item.id, currentFrame, vertices));
	}

	function deleteSelection(): void {
		if (selectedIndices.length === 0) return;
		if (topologyLocked) {
			status = m.video_editor_path_topology_locked();
			return;
		}
		if (storedVertices.length - selectedIndices.length < minimumVertexCount) return;
		let vertices: ShapePathVertex[] | null = storedVertices;
		for (const index of selectedIndices.toSorted((left, right) => right - left)) {
			vertices = vertices ? removePathVertex(vertices, index, minimumVertexCount) : null;
		}
		if (!vertices) return;
		updateItemProperties(item.id, { pathVertices: vertices }, 'UPDATE_PATH_GEOMETRY');
		pathVertexSelectionStore.select(item.id, []);
		status = '';
		onedit();
	}
</script>

<div class="pointer-events-none absolute inset-0 z-20" data-mask-editor>
	<div
		class="pointer-events-auto absolute top-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded bg-black/85 p-1 text-[10px] text-white shadow-lg"
	>
		<div
			class="flex overflow-hidden rounded"
			role="group"
			aria-label={m.video_editor_canvas_tool_mask()}
		>
			<button
				type="button"
				class="px-2 py-1 focus-visible:outline-2 focus-visible:outline-white"
				class:bg-white={penMode}
				class:text-black={penMode}
				aria-pressed={penMode}
				onclick={startDrawNew}
			>
				{m.video_editor_mask_mode_draw()}
			</button>
			<button
				type="button"
				class="px-2 py-1 focus-visible:outline-2 focus-visible:outline-white"
				class:bg-white={!penMode}
				class:text-black={!penMode}
				aria-pressed={!penMode}
				disabled={penMode}
				onclick={() => {
					status = '';
				}}
			>
				{m.video_editor_mask_mode_edit()}
			</button>
		</div>
		<span class="h-4 w-px bg-white/20" aria-hidden="true"></span>
		<button
			type="button"
			class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
			disabled={selectedIndices.length === 0}
			onclick={() => convertSelection(true)}
		>
			{m.video_editor_mask_convert_smooth()}
		</button>
		<button
			type="button"
			class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
			disabled={selectedIndices.length === 0}
			onclick={() => convertSelection(false)}
		>
			{m.video_editor_mask_convert_corner()}
		</button>
		<button
			type="button"
			class="rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
			disabled={selectedIndices.length === 0}
			onclick={deleteSelection}
		>
			{m.video_editor_mask_delete_points()}
		</button>
	</div>
	{#if status}
		<p
			class="pointer-events-auto absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded bg-black/85 px-2 py-1 text-center text-[10px] whitespace-nowrap text-amber-100 shadow-lg"
			aria-live="polite"
		>
			{status}
		</p>
	{/if}
	{#key session}
		<PathEditorOverlay
			{item}
			{canvasWidth}
			{canvasHeight}
			{currentFrame}
			{boxStyle}
			{screenScale}
			onedit={handleInnerEdit}
		/>
	{/key}
</div>
