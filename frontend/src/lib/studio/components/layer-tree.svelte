<script lang="ts">
	import { useStudioEditor } from '../editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import EyeIcon from 'lucide-svelte/icons/eye';
	import EyeOffIcon from 'lucide-svelte/icons/eye-off';
	import LockIcon from 'lucide-svelte/icons/lock';
	import UnlockIcon from 'lucide-svelte/icons/lock-open';
	import GripIcon from 'lucide-svelte/icons/grip-vertical';
	import TypeIcon from 'lucide-svelte/icons/type';
	import ImageIcon from 'lucide-svelte/icons/image';
	import SquareIcon from 'lucide-svelte/icons/square';
	import GroupIcon from 'lucide-svelte/icons/group';
	import { m } from '$lib/paraglide/messages';

	const editor = useStudioEditor();
	let draggingID = $state('');

	function layerIcon(type: string) {
		return type === 'text'
			? TypeIcon
			: type === 'image'
				? ImageIcon
				: type === 'group'
					? GroupIcon
					: SquareIcon;
	}

	function reorder(droppedID: string, targetID: string): void {
		if (!editor.activePage || droppedID === targetID) return;
		const targetIndex = editor.activePage.layers.findIndex((layer) => layer.id === targetID);
		editor.mutate('Reorder layer', (document) => {
			const page = document.pages.find((item) => item.id === editor.activePageID);
			if (!page) return;
			const sourceIndex = page.layers.findIndex((layer) => layer.id === droppedID);
			if (sourceIndex < 0 || targetIndex < 0) return;
			const [layer] = page.layers.splice(sourceIndex, 1);
			page.layers.splice(targetIndex, 0, layer);
		});
	}

	function moveWithKeyboard(id: string, delta: number): void {
		if (!editor.activePage) return;
		const index = editor.activePage.layers.findIndex((layer) => layer.id === id);
		const target = Math.max(0, Math.min(editor.activePage.layers.length - 1, index + delta));
		const targetID = editor.activePage.layers[target]?.id;
		if (targetID) reorder(id, targetID);
	}
</script>

<div class="flex h-full min-h-0 flex-col" role="tree" aria-label={m.studio_layers()}>
	<div class="border-b px-3 py-2">
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{m.studio_layers()}
		</h2>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if editor.activePage?.layers.length}
			{#each [...editor.activePage.layers].reverse() as layer (layer.id)}
				{@const Icon = layerIcon(layer.type)}
				<div
					role="treeitem"
					aria-selected={editor.selectedLayerIDs.includes(layer.id)}
					aria-label={m.studio_layer_accessible({
						name: layer.name,
						type: layer.type,
						state: `${layer.locked ? m.studio_locked_state() : ''}${layer.visible ? '' : m.studio_hidden_state()}`
					})}
					tabindex="0"
					draggable={editor.canEdit}
					class="studio-layer-row group flex min-h-10 items-center gap-1 rounded-md px-1.5 text-sm {editor.selectedLayerIDs.includes(
						layer.id
					)
						? 'bg-primary/10 text-foreground'
						: 'hover:bg-muted'}"
					onclick={(event) => editor.selectLayer(layer.id, event.metaKey || event.ctrlKey)}
					ondragstart={() => (draggingID = layer.id)}
					ondragover={(event) => event.preventDefault()}
					ondrop={() => {
						if (draggingID) reorder(draggingID, layer.id);
						draggingID = '';
					}}
					onkeydown={(event) => {
						if (event.altKey && event.key === 'ArrowUp') {
							event.preventDefault();
							moveWithKeyboard(layer.id, 1);
						}
						if (event.altKey && event.key === 'ArrowDown') {
							event.preventDefault();
							moveWithKeyboard(layer.id, -1);
						}
					}}
				>
					<GripIcon class="size-3.5 shrink-0 text-muted-foreground" />
					<Icon class="size-3.5 shrink-0" />
					<span class="min-w-0 flex-1 truncate">{layer.name}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
						onclick={(event) => {
							event.stopPropagation();
							editor.updateLayer(layer.id, { visible: !layer.visible });
						}}
						disabled={!editor.canEdit}
					>
						{#if layer.visible}<EyeIcon />{:else}<EyeOffIcon />{/if}
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={layer.locked
							? m.studio_unlock_layer({ name: layer.name })
							: m.studio_lock_layer({ name: layer.name })}
						onclick={(event) => {
							event.stopPropagation();
							editor.updateLayer(layer.id, { locked: !layer.locked });
						}}
						disabled={!editor.canEdit}
					>
						{#if layer.locked}<LockIcon />{:else}<UnlockIcon />{/if}
					</Button>
				</div>
			{/each}
		{:else}
			<p class="p-3 text-sm text-muted-foreground">{m.studio_empty_layers()}</p>
		{/if}
	</div>
</div>

<style>
	.studio-layer-row {
		content-visibility: auto;
		contain-intrinsic-size: 40px;
	}
</style>
