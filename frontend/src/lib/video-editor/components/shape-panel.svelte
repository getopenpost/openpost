<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { ShapeType } from '$lib/video-editor/project/types';
	import { addShapeItem, type AddShapeItemStyle } from '$lib/video-editor/timeline/actions/items';
	import {
		clearGeneratedItemDragData,
		shapeGeneratedItemDragData,
		writeGeneratedItemDragData
	} from '$lib/video-editor/timeline/generated-item-drag';

	let { oninserted }: { oninserted: (itemId: string) => void } = $props();

	interface ShapeCard {
		id: string;
		type: ShapeType;
		label: () => string;
		path?: string;
		style?: AddShapeItemStyle;
		preview?: 'solid' | 'gradient';
	}

	const shapes: ShapeCard[] = [
		{
			id: 'solid',
			type: 'rectangle',
			label: m.video_editor_shape_fill_solid,
			style: { fillType: 'solid', fillColor: '#f97316', sizeMode: 'canvas' },
			preview: 'solid'
		},
		{
			id: 'gradient',
			type: 'rectangle',
			label: m.video_editor_shape_fill_linear,
			style: {
				fillType: 'linear',
				fillColor: '#f97316',
				gradientStartColor: '#f97316',
				gradientEndColor: '#6366f1',
				gradientAngle: 135,
				sizeMode: 'canvas'
			},
			preview: 'gradient'
		},
		{
			id: 'rectangle',
			type: 'rectangle',
			label: m.video_editor_shape_primitive_rectangle,
			path: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z'
		},
		{
			id: 'circle',
			type: 'circle',
			label: m.video_editor_shape_primitive_circle,
			path: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z'
		},
		{
			id: 'ellipse',
			type: 'ellipse',
			label: m.video_editor_shape_primitive_ellipse,
			path: 'M2.5 12c0-4.1 4.3-7 9.5-7s9.5 2.9 9.5 7-4.3 7-9.5 7-9.5-2.9-9.5-7Z'
		},
		{
			id: 'triangle',
			type: 'triangle',
			label: m.video_editor_shape_primitive_triangle,
			path: 'M12 3 22 20H2Z'
		},
		{
			id: 'star',
			type: 'star',
			label: m.video_editor_shape_primitive_star,
			path: 'm12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9Z'
		},
		{
			id: 'polygon',
			type: 'polygon',
			label: m.video_editor_shape_primitive_polygon,
			path: 'm7 3.3 10 0 5 8.7-5 8.7H7L2 12Z'
		},
		{
			id: 'heart',
			type: 'heart',
			label: m.video_editor_shape_primitive_heart,
			path: 'M12 21S3 16 3 9.5C3 4.7 9.1 3 12 7c2.9-4 9-2.3 9 2.5C21 16 12 21 12 21Z'
		},
		{
			id: 'path',
			type: 'path',
			label: m.video_editor_shape_primitive_pen,
			path: 'M4 19c3.5-8 6-12 9-12 2.7 0 2.7 4 5.5 4 1.1 0 1.8-.7 2.5-2M4 19l4-1-3-3-1 4Z'
		}
	];

	function insert(shape: ShapeCard): void {
		oninserted(addShapeItem(shape.type, shape.label(), shape.style));
	}

	function startDrag(event: DragEvent, shape: ShapeCard): void {
		if (!event.dataTransfer) return;
		writeGeneratedItemDragData(
			event.dataTransfer,
			shapeGeneratedItemDragData(shape.label(), shape.type, shape.style)
		);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-2" aria-label={m.video_editor_shapes()}>
	<div class="shape-grid grid grid-cols-2 gap-1.5">
		{#each shapes as shape (shape.id)}
			<button
				type="button"
				class="group flex min-h-20 cursor-grab flex-col items-center justify-center gap-1.5 rounded-md border border-[oklch(0.27_0.015_55)] bg-[oklch(0.18_0.01_55)] px-2 py-2 text-[11px] text-[oklch(0.72_0.01_55)] hover:border-[oklch(0.5_0.08_45)] hover:bg-[oklch(0.22_0.015_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] active:cursor-grabbing"
				draggable="true"
				onclick={() => insert(shape)}
				ondragstart={(event) => startDrag(event, shape)}
				ondragend={clearGeneratedItemDragData}
			>
				{#if shape.preview}
					<span
						class="size-10 rounded-md border border-white/10"
						class:bg-orange-500={shape.preview === 'solid'}
						class:bg-gradient-to-br={shape.preview === 'gradient'}
						class:from-orange-500={shape.preview === 'gradient'}
						class:to-indigo-500={shape.preview === 'gradient'}
						aria-hidden="true"
					></span>
				{:else}
					<svg viewBox="0 0 24 24" class="size-8" aria-hidden="true">
						<path
							d={shape.path}
							fill={shape.type === 'path' ? 'none' : 'oklch(0.66 0.14 45)'}
							stroke="oklch(0.9 0.01 70)"
							stroke-width="0.8"
							stroke-linejoin="round"
						/>
					</svg>
				{/if}
				<span>{shape.label()}</span>
			</button>
		{/each}
	</div>
</div>
