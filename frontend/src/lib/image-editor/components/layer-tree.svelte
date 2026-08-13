<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ContextMenu } from 'bits-ui';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { useImageEditor } from '../editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LockIcon from '@lucide/svelte/icons/lock';
	import UnlockIcon from '@lucide/svelte/icons/lock-open';
	import GripIcon from '@lucide/svelte/icons/grip-vertical';
	import TypeIcon from '@lucide/svelte/icons/type';
	import ImageIcon from '@lucide/svelte/icons/image';
	import SquareIcon from '@lucide/svelte/icons/square';
	import GroupIcon from '@lucide/svelte/icons/group';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SquareDashedIcon from '@lucide/svelte/icons/square-dashed';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import BringToFrontIcon from '@lucide/svelte/icons/bring-to-front';
	import SendToBackIcon from '@lucide/svelte/icons/send-to-back';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import UngroupIcon from '@lucide/svelte/icons/ungroup';
	import type { ImageEditorLayer, ImageEditorPage } from '../types';
	import { isEmptyImageEditorPaintLayer } from '../document';
	import { m } from '$lib/paraglide/messages';

	interface LayerTreeItem {
		layer: ImageEditorLayer;
		depth: number;
		hasChildren: boolean;
	}

	const editor = useImageEditor();
	let draggingID = $state('');
	let pointerDraggingID = $state('');
	let pointerTargetID = $state('');
	let pointerTargetPosition = $state<'above' | 'below' | 'inside'>('above');
	let renamingID = $state('');
	let renameDraft = $state('');
	let scrollContainer: HTMLDivElement | null = null;
	let pointerID = -1;
	let pointerStartX = 0;
	let pointerStartY = 0;
	let pointerDragActive = $state(false);
	let pointerCaptureElement: HTMLElement | null = null;
	let touchIdentifier = -1;
	let contextRenameTimer: ReturnType<typeof setTimeout> | undefined;
	const collapsedGroups = new SvelteSet<string>();
	let items = $derived(flattenLayers(editor.activePage, collapsedGroups));

	$effect(() => {
		const selectedID = editor.selectedLayerIDs.at(-1);
		const container = scrollContainer;
		if (!selectedID || !container) return;
		queueMicrotask(() => {
			const row = [...container.querySelectorAll<HTMLElement>('[data-image-editor-layer-id]')].find(
				(candidate) => candidate.dataset.imageEditorLayerId === selectedID
			);
			if (!row || row.contains(document.activeElement)) return;
			row.scrollIntoView({ block: 'nearest' });
		});
	});

	function layerIcon(layer: ImageEditorLayer) {
		return layer.type === 'text'
			? TypeIcon
			: layer.type === 'image'
				? ImageIcon
				: isEmptyImageEditorPaintLayer(layer)
					? SquareDashedIcon
					: layer.type === 'paint'
						? PencilIcon
						: layer.type === 'group'
							? GroupIcon
							: SquareIcon;
	}

	function reorder(
		droppedID: string,
		targetID: string,
		position: 'above' | 'below' | 'inside'
	): void {
		if (position === 'inside') editor.moveLayerToGroup(droppedID, targetID);
		else editor.moveLayerRelative(droppedID, targetID, position);
	}

	function moveWithKeyboard(id: string, delta: number): void {
		editor.reorderLayer(id, delta > 0 ? 'forward' : 'backward');
	}

	function layerAtPoint(
		x: number,
		y: number,
		sourceID: string
	): { id: string; position: 'above' | 'below' | 'inside' } | null {
		const rows = scrollContainer?.querySelectorAll<HTMLElement>('[data-image-editor-layer-id]');
		const source = editor.activePage?.layers.find((layer) => layer.id === sourceID);
		if (!rows?.length || !source) return null;
		const groupDestinations = new Set(
			editor.groupDestinationsForLayer(sourceID).map((group) => group.id)
		);
		let nearest: { id: string; position: 'above' | 'below' | 'inside' } | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const row of rows) {
			const id = row.dataset.imageEditorLayerId ?? '';
			const candidate = editor.activePage?.layers.find((layer) => layer.id === id);
			if (!candidate || id === sourceID) continue;
			const bounds = row.getBoundingClientRect();
			const inside =
				candidate.type === 'group' &&
				groupDestinations.has(candidate.id) &&
				x >= bounds.left + Math.min(44, bounds.width * 0.2) &&
				y >= bounds.top &&
				y <= bounds.bottom;
			if (inside) return { id, position: 'inside' };
			if (candidate.parent_id !== source.parent_id) continue;
			const position = y < (bounds.top + bounds.bottom) / 2 ? 'above' : 'below';
			if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
				return { id, position };
			}
			const distance = Math.abs(y - (bounds.top + bounds.bottom) / 2);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearest = { id, position };
			}
		}
		return nearest;
	}

	function attachScrollContainer(node: HTMLDivElement): () => void {
		scrollContainer = node;
		return () => {
			if (scrollContainer === node) scrollContainer = null;
		};
	}

	function startPointerReorder(event: PointerEvent, id: string): void {
		if (!editor.canEdit || renamingID === id || touchIdentifier >= 0) return;
		event.preventDefault();
		event.stopPropagation();
		editor.selectLayer(id);
		pointerID = event.pointerId;
		pointerStartX = event.clientX;
		pointerStartY = event.clientY;
		pointerDragActive = false;
		pointerDraggingID = id;
		pointerTargetID = id;
		pointerCaptureElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
		try {
			pointerCaptureElement?.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events may not create an active pointer capture.
		}
	}

	function continuePointerReorder(event: PointerEvent): void {
		if (event.pointerId !== pointerID || !pointerDraggingID) return;
		event.preventDefault();
		const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
		if (distance < 6 && !pointerDragActive) return;
		pointerDragActive = true;
		const target = layerAtPoint(event.clientX, event.clientY, pointerDraggingID);
		if (target) {
			pointerTargetID = target.id;
			pointerTargetPosition = target.position;
		}

		autoScroll(event.clientY);
	}

	function finishPointerReorder(event: PointerEvent, cancelled = false): void {
		if (event.pointerId !== pointerID || !pointerDraggingID) return;
		event.preventDefault();
		event.stopPropagation();
		if (!cancelled && pointerDragActive && pointerTargetID) {
			reorder(pointerDraggingID, pointerTargetID, pointerTargetPosition);
		}
		try {
			pointerCaptureElement?.releasePointerCapture(event.pointerId);
		} catch {
			// Pointer capture is already gone.
		}
		pointerID = -1;
		pointerCaptureElement = null;
		pointerDragActive = false;
		pointerDraggingID = '';
		pointerTargetID = '';
	}

	function startTouchReorder(event: TouchEvent, id: string): void {
		const touch = event.changedTouches[0];
		if (!touch || !editor.canEdit || renamingID === id) return;
		event.stopPropagation();
		touchIdentifier = touch.identifier;
		pointerID = -1;
		pointerStartX = touch.clientX;
		pointerStartY = touch.clientY;
		pointerDragActive = false;
		pointerDraggingID = id;
		pointerTargetID = '';
		editor.selectLayer(id);
		window.addEventListener('touchmove', continueTouchReorder, { passive: false });
		window.addEventListener('touchend', finishTouchReorder, { passive: false });
		window.addEventListener('touchcancel', cancelTouchReorder, { passive: false });
	}

	function continueTouchReorder(event: TouchEvent): void {
		const touch = [...event.changedTouches].find(
			(candidate) => candidate.identifier === touchIdentifier
		);
		if (!touch || !pointerDraggingID) return;
		event.preventDefault();
		const distance = Math.hypot(touch.clientX - pointerStartX, touch.clientY - pointerStartY);
		if (distance < 6 && !pointerDragActive) return;
		pointerDragActive = true;
		const target = layerAtPoint(touch.clientX, touch.clientY, pointerDraggingID);
		if (target) {
			pointerTargetID = target.id;
			pointerTargetPosition = target.position;
		}
		autoScroll(touch.clientY);
	}

	function finishTouchReorder(event: TouchEvent): void {
		if (![...event.changedTouches].some((touch) => touch.identifier === touchIdentifier)) return;
		event.preventDefault();
		if (pointerDragActive && pointerTargetID) {
			reorder(pointerDraggingID, pointerTargetID, pointerTargetPosition);
		}
		resetTouchReorder();
	}

	function cancelTouchReorder(event: TouchEvent): void {
		if (![...event.changedTouches].some((touch) => touch.identifier === touchIdentifier)) return;
		resetTouchReorder();
	}

	function resetTouchReorder(): void {
		window.removeEventListener('touchmove', continueTouchReorder);
		window.removeEventListener('touchend', finishTouchReorder);
		window.removeEventListener('touchcancel', cancelTouchReorder);
		touchIdentifier = -1;
		pointerDragActive = false;
		pointerDraggingID = '';
		pointerTargetID = '';
	}

	function autoScroll(clientY: number): void {
		const container = scrollContainer;
		if (!container) return;
		const bounds = container.getBoundingClientRect();
		if (clientY < bounds.top + 48) container.scrollTop -= 14;
		if (clientY > bounds.bottom - 48) container.scrollTop += 14;
	}

	onDestroy(() => {
		resetTouchReorder();
		clearTimeout(contextRenameTimer);
	});

	function startRename(layer: ImageEditorLayer): void {
		if (!editor.canEdit) return;
		editor.selectLayer(layer.id);
		renamingID = layer.id;
		renameDraft = layer.name;
	}

	function commitRename(layer: ImageEditorLayer): void {
		const name = renameDraft.trim();
		if (name && name !== layer.name) editor.updateLayer(layer.id, { name });
		renamingID = '';
	}

	function startContextRename(layer: ImageEditorLayer): void {
		clearTimeout(contextRenameTimer);
		contextRenameTimer = setTimeout(() => {
			contextRenameTimer = undefined;
			startRename(layer);
		}, 0);
	}

	function focusInput(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}

	function ensureContextSelection(layer: ImageEditorLayer): void {
		if (!editor.selectedLayerIDs.includes(layer.id)) editor.selectLayer(layer.id);
	}

	function toggleGroup(id: string): void {
		if (collapsedGroups.has(id)) collapsedGroups.delete(id);
		else collapsedGroups.add(id);
	}

	function flattenLayers(page: ImageEditorPage | null, collapsed: Set<string>): LayerTreeItem[] {
		if (!page) return [];
		const byParent = new SvelteMap<string, ImageEditorLayer[]>();
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

<svelte:window
	onpointermove={continuePointerReorder}
	onpointerupcapture={finishPointerReorder}
	onpointercancelcapture={(event) => finishPointerReorder(event, true)}
/>

<div class="flex h-full min-h-0 flex-col" role="tree" aria-label={m.image_editor_layers()}>
	<div class="flex min-h-10 items-center border-b px-3">
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{m.image_editor_layers()}
		</h2>
		<div class="ml-auto flex items-center gap-1">
			{#if editor.selectedLayerIDs.length > 1}
				<span class="mr-1 text-xs text-muted-foreground">
					{m.image_editor_selected_count({ count: editor.selectedLayerIDs.length })}
				</span>
			{/if}
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => editor.addEmptyLayer()}
				disabled={!editor.canEdit}
				aria-label={m.image_editor_add_layer()}
				title={m.image_editor_add_layer()}
			>
				<PlusIcon />
			</Button>
		</div>
	</div>
	<div {@attach attachScrollContainer} class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if items.length}
			{#each items as item (item.layer.id)}
				{@const layer = item.layer}
				{@const Icon = layerIcon(layer)}
				{@const groupDestinations = editor.groupDestinationsForLayer(layer.id)}
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
								data-image-editor-layer-id={layer.id}
								data-drop-position={pointerTargetID === layer.id && pointerDraggingID !== layer.id
									? pointerTargetPosition
									: undefined}
								aria-label={m.image_editor_layer_accessible({
									name: layer.name,
									type: layer.type,
									state: `${layer.locked ? m.image_editor_locked_state() : ''}${layer.visible ? '' : m.image_editor_hidden_state()}`
								})}
								tabindex="0"
								draggable={editor.canEdit && renamingID !== layer.id}
								class="image-editor-layer-row group flex min-h-10 items-center gap-1 rounded-md pr-1 text-sm {editor.selectedLayerIDs.includes(
									layer.id
								)
									? 'bg-primary/10 text-foreground'
									: 'hover:bg-muted'} {pointerDraggingID === layer.id && pointerDragActive
									? 'opacity-60'
									: ''}"
								style:padding-left={`${item.depth * 14 + 4}px`}
								onclick={(event) =>
									editor.selectLayer(
										layer.id,
										event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
									)}
								ondblclick={() => startRename(layer)}
								ondragstart={() => (draggingID = layer.id)}
								ondragover={(event) => {
									event.preventDefault();
									const target = draggingID
										? layerAtPoint(event.clientX, event.clientY, draggingID)
										: null;
									if (target?.id === layer.id) {
										pointerTargetID = target.id;
										pointerTargetPosition = target.position;
									}
								}}
								ondrop={(event) => {
									if (draggingID) {
										const target = layerAtPoint(event.clientX, event.clientY, draggingID);
										if (target?.id === layer.id) reorder(draggingID, target.id, target.position);
									}
									draggingID = '';
									pointerTargetID = '';
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
									if (event.altKey && event.key === 'ArrowLeft' && layer.parent_id) {
										event.preventDefault();
										editor.moveLayerOutOfGroup(layer.id);
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
											? m.image_editor_expand_group({ name: layer.name })
											: m.image_editor_collapse_group({ name: layer.name })}
									>
										<ChevronRightIcon
											class="size-3.5 transition-transform {collapsedGroups.has(layer.id)
												? ''
												: 'rotate-90'}"
										/>
									</Button>
								{/if}
								<button
									type="button"
									class="image-editor-layer-grip flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
									aria-label={m.image_editor_reorder_layer({ name: layer.name })}
									title={m.image_editor_reorder_layer({ name: layer.name })}
									disabled={!editor.canEdit || renamingID === layer.id}
									data-testid="image-editor-layer-drag-handle"
									onclick={(event) => event.stopPropagation()}
									oncontextmenu={(event) => event.preventDefault()}
									ondragstart={(event) => event.preventDefault()}
									onpointerdown={(event) => startPointerReorder(event, layer.id)}
									onpointerup={finishPointerReorder}
									onpointercancel={(event) => finishPointerReorder(event, true)}
									ontouchstart={(event) => startTouchReorder(event, layer.id)}
								>
									<GripIcon class="size-3.5" />
								</button>
								<Icon class="size-3.5 shrink-0" />
								{#if renamingID === layer.id}
									<Input
										{@attach focusInput}
										class="h-7 min-w-0 flex-1 bg-background px-1.5 text-sm md:text-sm"
										bind:value={renameDraft}
										maxlength={120}
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
										aria-label={m.image_editor_layer_name()}
									/>
								{:else}
									<span class="min-w-0 flex-1 truncate">{layer.name}</span>
								{/if}
								{#if editor.selectedLayerIDs.includes(layer.id)}
									<Button
										variant="ghost"
										size="icon-xs"
										class="image-editor-mobile-order-button"
										aria-label={m.image_editor_move_layer_up({ name: layer.name })}
										title={m.image_editor_move_layer_up({ name: layer.name })}
										onclick={(event) => {
											event.stopPropagation();
											editor.reorderLayer(layer.id, 'forward');
										}}
									>
										<ArrowUpIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										class="image-editor-mobile-order-button"
										aria-label={m.image_editor_move_layer_down({ name: layer.name })}
										title={m.image_editor_move_layer_down({ name: layer.name })}
										onclick={(event) => {
											event.stopPropagation();
											editor.reorderLayer(layer.id, 'backward');
										}}
									>
										<ArrowDownIcon />
									</Button>
								{/if}
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={layer.visible
										? m.image_editor_hide_layer({ name: layer.name })
										: m.image_editor_show_layer({ name: layer.name })}
									title={layer.visible
										? m.image_editor_hide_layer({ name: layer.name })
										: m.image_editor_show_layer({ name: layer.name })}
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
										? m.image_editor_unlock_layer({ name: layer.name })
										: m.image_editor_lock_layer({ name: layer.name })}
									title={layer.locked
										? m.image_editor_unlock_layer({ name: layer.name })
										: m.image_editor_lock_layer({ name: layer.name })}
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
							<ContextMenu.Item
								class="image-editor-context-item"
								onclick={() => startContextRename(layer)}
							>
								<PencilIcon class="size-4" />
								{m.image_editor_rename_layer()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="image-editor-context-item"
								onclick={() => editor.duplicateSelected()}
							>
								<CopyIcon class="size-4" />
								{m.image_editor_duplicate()}
							</ContextMenu.Item>
							<ContextMenu.Separator class="my-1 h-px bg-border" />
							<ContextMenu.Item
								class="image-editor-context-item"
								disabled={editor.selectedLayers.length < 2}
								onclick={() => editor.groupSelected()}
							>
								<GroupIcon class="size-4" />
								{m.image_editor_group()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="image-editor-context-item"
								disabled={!editor.selectedLayers.some((selected) => selected.type === 'group')}
								onclick={() => editor.ungroupSelected()}
							>
								<UngroupIcon class="size-4" />
								{m.image_editor_ungroup()}
							</ContextMenu.Item>
							{#if groupDestinations.length > 0}
								<ContextMenu.Sub>
									<ContextMenu.SubTrigger class="image-editor-context-item">
										<GroupIcon class="size-4" />
										{m.image_editor_move_into_group()}
									</ContextMenu.SubTrigger>
									<ContextMenu.SubContent
										class="z-50 min-w-48 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
									>
										{#each groupDestinations as destination (destination.id)}
											<ContextMenu.Item
												class="image-editor-context-item"
												onclick={() => editor.moveLayerToGroup(layer.id, destination.id)}
											>
												<GroupIcon class="size-4" />
												{m.image_editor_move_to_group({ name: destination.name })}
											</ContextMenu.Item>
										{/each}
									</ContextMenu.SubContent>
								</ContextMenu.Sub>
							{/if}
							{#if layer.parent_id}
								<ContextMenu.Item
									class="image-editor-context-item"
									onclick={() => editor.moveLayerOutOfGroup(layer.id)}
								>
									<UngroupIcon class="size-4" />
									{m.image_editor_move_out_of_group()}
								</ContextMenu.Item>
							{/if}
							<ContextMenu.Separator class="my-1 h-px bg-border" />
							<ContextMenu.Item
								class="image-editor-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'front')}
							>
								<BringToFrontIcon class="size-4" />
								{m.image_editor_bring_front()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="image-editor-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'forward')}
							>
								{m.image_editor_bring_forward()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="image-editor-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'backward')}
							>
								{m.image_editor_send_backward()}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="image-editor-context-item"
								onclick={() => editor.reorderLayer(layer.id, 'back')}
							>
								<SendToBackIcon class="size-4" />
								{m.image_editor_send_back()}
							</ContextMenu.Item>
							<ContextMenu.Separator class="my-1 h-px bg-border" />
							<ContextMenu.Item
								class="image-editor-context-item text-destructive"
								onclick={() => editor.deleteSelected()}
							>
								<TrashIcon class="size-4" />
								{m.image_editor_delete_layer()}
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			{/each}
		{:else}
			<p class="p-3 text-sm text-muted-foreground">{m.image_editor_empty_layers()}</p>
		{/if}
	</div>
</div>

<style>
	.image-editor-layer-row {
		position: relative;
		content-visibility: auto;
		contain-intrinsic-size: 40px;
	}

	.image-editor-layer-row[data-drop-position='above']::before,
	.image-editor-layer-row[data-drop-position='below']::after {
		position: absolute;
		right: 0.25rem;
		left: 0.25rem;
		z-index: 2;
		height: 2px;
		border-radius: 999px;
		background: var(--primary);
		content: '';
	}

	.image-editor-layer-row[data-drop-position='above']::before {
		top: -1px;
	}

	.image-editor-layer-row[data-drop-position='below']::after {
		bottom: -1px;
	}

	.image-editor-layer-row[data-drop-position='inside'] {
		box-shadow: inset 0 0 0 2px var(--primary);
	}

	.image-editor-mobile-order-button {
		display: none;
	}

	@media (pointer: coarse) {
		.image-editor-layer-row {
			min-height: 48px;
			contain-intrinsic-size: 48px;
		}

		.image-editor-layer-grip {
			width: 44px;
			height: 44px;
		}

		.image-editor-mobile-order-button {
			display: inline-flex;
			width: 36px;
			height: 36px;
			flex: none;
		}
	}

	:global(.image-editor-context-item) {
		display: flex;
		min-height: 2.25rem;
		cursor: default;
		align-items: center;
		gap: 0.5rem;
		border-radius: 0.375rem;
		padding-inline: 0.5rem;
		outline: none;
	}

	:global(.image-editor-context-item[data-highlighted]) {
		background: var(--muted);
	}

	:global(.image-editor-context-item[data-disabled]) {
		opacity: 0.45;
	}
</style>
