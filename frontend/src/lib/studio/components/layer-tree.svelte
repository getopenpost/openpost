<script lang="ts">
	import { ContextMenu } from 'bits-ui';
	import { SvelteSet } from 'svelte/reactivity';
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
	import ChevronRightIcon from 'lucide-svelte/icons/chevron-right';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import CopyIcon from 'lucide-svelte/icons/copy';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import BringToFrontIcon from 'lucide-svelte/icons/bring-to-front';
	import SendToBackIcon from 'lucide-svelte/icons/send-to-back';
	import UngroupIcon from 'lucide-svelte/icons/ungroup';
	import type { StudioLayer, StudioPage } from '../types';
	import { m } from '$lib/paraglide/messages';

	interface LayerTreeItem {
		layer: StudioLayer;
		depth: number;
		hasChildren: boolean;
	}

	const editor = useStudioEditor();
	let draggingID = $state('');
	let renamingID = $state('');
	let renameDraft = $state('');
	const collapsedGroups = new SvelteSet<string>();
	let items = $derived(flattenLayers(editor.activePage, collapsedGroups));

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

	function startRename(layer: StudioLayer): void {
		if (!editor.canEdit) return;
		editor.selectLayer(layer.id);
		renamingID = layer.id;
		renameDraft = layer.name;
	}

	function commitRename(layer: StudioLayer): void {
		const name = renameDraft.trim();
		if (name && name !== layer.name) editor.updateLayer(layer.id, { name });
		renamingID = '';
	}

	function focusInput(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}

	function ensureContextSelection(layer: StudioLayer): void {
		if (!editor.selectedLayerIDs.includes(layer.id)) editor.selectLayer(layer.id);
	}

	function toggleGroup(id: string): void {
		if (collapsedGroups.has(id)) collapsedGroups.delete(id);
		else collapsedGroups.add(id);
	}

	function flattenLayers(page: StudioPage | null, collapsed: Set<string>): LayerTreeItem[] {
		if (!page) return [];
		const byParent = new Map<string, StudioLayer[]>();
		for (const layer of page.layers) {
			const parentID = layer.parent_id ?? '';
			const children = byParent.get(parentID) ?? [];
			children.push(layer);
			byParent.set(parentID, children);
		}
		const flattened: LayerTreeItem[] = [];
		const append = (parentID: string, depth: number): void => {
			for (const layer of [...(byParent.get(parentID) ?? [])].reverse()) {
				const children = byParent.get(layer.id) ?? [];
				flattened.push({ layer, depth, hasChildren: children.length > 0 });
				if (children.length > 0 && !collapsed.has(layer.id)) append(layer.id, depth + 1);
			}
		};
		append('', 0);
		return flattened;
	}
</script>

<div class="flex h-full min-h-0 flex-col" role="tree" aria-label={m.studio_layers()}>
	<div class="flex min-h-10 items-center border-b px-3">
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{m.studio_layers()}
		</h2>
		{#if editor.selectedLayerIDs.length > 1}
			<span class="ml-auto text-xs text-muted-foreground">
				{m.studio_selected_count({ count: editor.selectedLayerIDs.length })}
			</span>
		{/if}
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if items.length}
			{#each items as item (item.layer.id)}
				{@const layer = item.layer}
				{@const Icon = layerIcon(layer.type)}
				<ContextMenu.Root
					onOpenChange={(open) => {
						if (open) ensureContextSelection(layer);
					}}
				>
					<ContextMenu.Trigger disabled={!editor.canEdit}>
						{#snippet child({ props })}
							<div
								{...props}
								role="treeitem"
								aria-level={item.depth + 1}
								aria-expanded={item.hasChildren ? !collapsedGroups.has(layer.id) : undefined}
								aria-selected={editor.selectedLayerIDs.includes(layer.id)}
								aria-label={m.studio_layer_accessible({
									name: layer.name,
									type: layer.type,
									state: `${layer.locked ? m.studio_locked_state() : ''}${layer.visible ? '' : m.studio_hidden_state()}`
								})}
								tabindex="0"
								draggable={editor.canEdit && renamingID !== layer.id}
								class="studio-layer-row group flex min-h-10 items-center gap-1 rounded-md pr-1 text-sm {editor.selectedLayerIDs.includes(
									layer.id
								)
									? 'bg-primary/10 text-foreground'
									: 'hover:bg-muted'}"
								style:padding-left={`${item.depth * 14 + 4}px`}
								onclick={(event) =>
									editor.selectLayer(
										layer.id,
										event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
									)}
								ondblclick={() => startRename(layer)}
								ondragstart={() => (draggingID = layer.id)}
								ondragover={(event) => event.preventDefault()}
								ondrop={() => {
									if (draggingID) reorder(draggingID, layer.id);
									draggingID = '';
								}}
								onkeydown={(event) => {
									if ((event.key === 'Enter' || event.key === 'F2') && renamingID !== layer.id) {
										event.preventDefault();
										startRename(layer);
									}
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
								{#if item.hasChildren}
									<Button
										variant="ghost"
										size="icon-xs"
										class="size-6 shrink-0"
										onclick={(event) => {
											event.stopPropagation();
											toggleGroup(layer.id);
										}}
										aria-label={collapsedGroups.has(layer.id)
											? m.studio_expand_group({ name: layer.name })
											: m.studio_collapse_group({ name: layer.name })}
									>
										<ChevronRightIcon
											class="size-3.5 transition-transform {collapsedGroups.has(layer.id)
												? ''
												: 'rotate-90'}"
										/>
									</Button>
								{:else}
									<GripIcon class="mx-1 size-3.5 shrink-0 text-muted-foreground" />
								{/if}
								<Icon class="size-3.5 shrink-0" />
								{#if renamingID === layer.id}
									<input
										{@attach focusInput}
										class="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
										bind:value={renameDraft}
										maxlength="120"
										onclick={(event) => event.stopPropagation()}
										onblur={() => commitRename(layer)}
										onkeydown={(event) => {
											event.stopPropagation();
											if (event.key === 'Enter') {
												event.preventDefault();
												commitRename(layer);
											}
											if (event.key === 'Escape') {
												event.preventDefault();
												renamingID = '';
											}
										}}
										aria-label={m.studio_layer_name()}
									/>
								{:else}
									<span class="min-w-0 flex-1 truncate">{layer.name}</span>
								{/if}
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={layer.visible
										? m.studio_hide_layer({ name: layer.name })
										: m.studio_show_layer({ name: layer.name })}
									title={layer.visible
										? m.studio_hide_layer({ name: layer.name })
										: m.studio_show_layer({ name: layer.name })}
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
									title={layer.locked
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
						{/snippet}
					</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content
							class="z-50 min-w-48 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
						>
							<ContextMenu.Item class="studio-context-item" onclick={() => startRename(layer)}>
								<PencilIcon class="size-4" />
								{m.studio_rename_layer()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="studio-context-item"
								onclick={() => editor.duplicateSelected()}
							>
								<CopyIcon class="size-4" />
								{m.studio_duplicate()}
							</ContextMenu.Item>
							<ContextMenu.Separator class="my-1 h-px bg-border" />
							<ContextMenu.Item
								class="studio-context-item"
								disabled={editor.selectedLayers.length < 2}
								onclick={() => editor.groupSelected()}
							>
								<GroupIcon class="size-4" />
								{m.studio_group()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="studio-context-item"
								disabled={!editor.selectedLayers.some((selected) => selected.type === 'group')}
								onclick={() => editor.ungroupSelected()}
							>
								<UngroupIcon class="size-4" />
								{m.studio_ungroup()}
							</ContextMenu.Item>
							<ContextMenu.Separator class="my-1 h-px bg-border" />
							<ContextMenu.Item
								class="studio-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'front')}
							>
								<BringToFrontIcon class="size-4" />
								{m.studio_bring_front()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="studio-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'forward')}
							>
								{m.studio_bring_forward()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="studio-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'backward')}
							>
								{m.studio_send_backward()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="studio-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'back')}
							>
								<SendToBackIcon class="size-4" />
								{m.studio_send_back()}
							</ContextMenu.Item>
							<ContextMenu.Separator class="my-1 h-px bg-border" />
							<ContextMenu.Item
								class="studio-context-item text-destructive"
								onclick={() => editor.deleteSelected()}
							>
								<TrashIcon class="size-4" />
								{m.studio_delete_layer()}
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
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

	:global(.studio-context-item) {
		display: flex;
		min-height: 2.25rem;
		cursor: default;
		align-items: center;
		gap: 0.5rem;
		border-radius: 0.375rem;
		padding-inline: 0.5rem;
		outline: none;
	}

	:global(.studio-context-item[data-highlighted]) {
		background: var(--muted);
	}

	:global(.studio-context-item[data-disabled]) {
		opacity: 0.45;
	}
</style>
