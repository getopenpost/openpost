<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { useImageEditor } from '../editor.svelte';
	import type { OpenPostFabricAdapter } from '../fabric-adapter';
	import type { SelectionPoint } from '../selection';

	interface Props {
		adapter: () => OpenPostFabricAdapter | null;
		documentPoint: (
			event: Pick<PointerEvent, 'clientX' | 'clientY'>,
			outside?: 'reject' | 'clamp' | 'allow'
		) => SelectionPoint | null;
		announce: (message: string) => void;
	}

	let { adapter, documentPoint, announce }: Props = $props();

	const editor = useImageEditor();
	const document = $derived(editor.document);

	let picker = $state.raw<{ point: SelectionPoint; layerIDs: string[] } | null>(null);
	let cycleGesture = $state.raw<{
		pointerID: number;
		clientX: number;
		clientY: number;
		layerIDs: string[];
	} | null>(null);

	function layerName(id: string): string {
		return editor.activePage?.layers.find((layer) => layer.id === id)?.name ?? id;
	}

	/** Open the picker for the layers under the cursor. */
	export function open(event: MouseEvent): void {
		if (editor.activeTool !== 'select' || !adapter()) return;
		const point = documentPoint(event, 'reject');
		if (!point) return;
		const layerIDs = adapter()?.layerIDsAtPoint(point) ?? [];
		if (layerIDs.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		picker = { point, layerIDs };
		announce(m.image_editor_select_layer_count({ count: layerIDs.length }));
	}

	/** Begin an alt-click cycle through stacked layers. */
	export function cycleStart(event: PointerEvent): void {
		if (!event.altKey || event.button !== 0 || editor.activeTool !== 'select' || !adapter()) return;
		const point = documentPoint(event, 'reject');
		if (!point) return;
		const layerIDs = adapter()?.layerIDsAtPoint(point) ?? [];
		if (layerIDs.length < 2) return;
		cycleGesture = {
			pointerID: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			layerIDs
		};
	}

	/** Finish an alt-click cycle, selecting the next stacked layer. */
	export function cycleFinish(event: PointerEvent): void {
		const gesture = cycleGesture;
		cycleGesture = null;
		if (
			!gesture ||
			gesture.pointerID !== event.pointerId ||
			Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) > 5
		)
			return;
		const current = gesture.layerIDs.findIndex((id) => editor.selectedLayerIDs.includes(id));
		const nextID = gesture.layerIDs[(current + 1) % gesture.layerIDs.length];
		editor.selectLayer(nextID);
		announce(m.image_editor_layer_cycled({ name: layerName(nextID) }));
		event.preventDefault();
		event.stopPropagation();
	}

	export function cycleCancel(): void {
		cycleGesture = null;
	}

	/** Close the picker; returns whether it was open (for Escape precedence). */
	export function dismiss(): boolean {
		const wasOpen = picker !== null;
		picker = null;
		cycleGesture = null;
		return wasOpen;
	}

	function choose(id: string): void {
		editor.selectLayer(id);
		picker = null;
		announce(m.image_editor_layer_selected({ name: layerName(id) }));
	}
</script>

{#if picker && document}
	<div
		class="absolute z-50 max-w-64 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
		style:left={`${Math.min(document.width_px - 180 / editor.zoom, picker.point.x) * editor.zoom}px`}
		style:top={`${Math.min(document.height_px - 48 / editor.zoom, picker.point.y) * editor.zoom}px`}
		role="menu"
		aria-label={m.image_editor_select_layer()}
		data-testid="image-editor-layer-picker"
	>
		<p class="px-2 py-1 text-xs font-medium text-muted-foreground">
			{m.image_editor_select_layer()}
		</p>
		{#each picker.layerIDs as id (id)}
			<button
				type="button"
				class="flex min-h-10 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
				role="menuitem"
				onclick={() => choose(id)}
			>
				<span class="min-w-0 flex-1 truncate">{layerName(id)}</span>
			</button>
		{/each}
	</div>
{/if}
