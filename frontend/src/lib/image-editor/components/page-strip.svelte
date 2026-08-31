<script lang="ts">
	import { useImageEditor } from '../editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import TemplatePreview from './template-preview.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { m } from '$lib/paraglide/messages';
	import type { SelectionPoint } from '../selection';
	import { containsExternalImageDrag, externalFiles } from '../media-drag';

	let {
		onExternalFiles
	}: {
		onExternalFiles?: (
			files: File[],
			point: SelectionPoint,
			pageID: string
		) => void | Promise<void>;
	} = $props();

	const editor = useImageEditor();
	let draggingID = $state('');
	let externalDropPageID = $state('');

	function displayPageName(name: string, index: number): string {
		return /^Page \d+$/.test(name) ? m.image_editor_default_page_name({ number: index + 1 }) : name;
	}

	function reorderPageFromKeyboard(event: KeyboardEvent, pageID: string, index: number): void {
		if (!editor.canEdit || !event.altKey) return;
		if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			editor.reorderPage(pageID, index - 1);
		}
		if (event.key === 'ArrowRight' && index < (editor.document?.pages.length ?? 0) - 1) {
			event.preventDefault();
			editor.reorderPage(pageID, index + 1);
		}
	}

	function handlePageDragOver(event: DragEvent, pageID: string): void {
		event.preventDefault();
		if (!containsExternalImageDrag(event.dataTransfer)) return;
		externalDropPageID = pageID;
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	function handlePageDrop(event: DragEvent, pageID: string, index: number): void {
		event.preventDefault();
		const files = externalFiles(event.dataTransfer);
		externalDropPageID = '';
		if (files.length > 0 && editor.canEdit && editor.document) {
			editor.activePageID = pageID;
			editor.selectedLayerIDs = [];
			void onExternalFiles?.(
				files,
				{ x: editor.document.width_px / 2, y: editor.document.height_px / 2 },
				pageID
			);
			return;
		}
		if (draggingID) editor.reorderPage(draggingID, index);
		draggingID = '';
	}
</script>

<div class="flex size-full flex-col border-t bg-background/95 backdrop-blur">
	<div class="flex h-11 items-center gap-1 border-b px-2 lg:h-9">
		<Button
			variant="ghost"
			size="icon-xs"
			class="size-11 md:size-11 lg:size-7"
			onclick={() => (editor.pagesExpanded = !editor.pagesExpanded)}
			aria-label={editor.pagesExpanded
				? m.image_editor_collapse_pages()
				: m.image_editor_expand_pages()}
		>
			{#if editor.pagesExpanded}<ChevronDownIcon />{:else}<ChevronUpIcon />{/if}
		</Button>
		<span class="text-sm font-medium text-foreground">{m.image_editor_pages()}</span>
		<span class="text-xs text-muted-foreground">{editor.document?.pages.length ?? 0}</span>
		<div class="ml-auto flex gap-1">
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 md:size-11 lg:size-7"
				onclick={() => editor.addPage()}
				disabled={!editor.canEdit}
			>
				<PlusIcon />
				<span class="sr-only">{m.image_editor_add_page()}</span>
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 md:size-11 lg:size-7"
				onclick={() => editor.duplicatePage()}
				disabled={!editor.canEdit}
			>
				<CopyIcon />
				<span class="sr-only">{m.image_editor_duplicate_page()}</span>
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 md:size-11 lg:size-7"
				onclick={() => editor.deletePage()}
				disabled={!editor.canEdit || (editor.document?.pages.length ?? 0) <= 1}
			>
				<TrashIcon />
				<span class="sr-only">{m.image_editor_delete_page()}</span>
			</Button>
		</div>
	</div>
	{#if editor.pagesExpanded && editor.document}
		<div
			class="no-scrollbar flex h-24 shrink-0 items-center gap-2 overflow-x-auto px-3 py-2 lg:h-auto lg:min-h-0 lg:flex-1"
		>
			{#each editor.document.pages as page, index (page.id)}
				<button
					type="button"
					draggable={editor.canEdit}
					class="flex h-16 w-24 shrink-0 flex-col overflow-hidden rounded-md border bg-card text-left {page.id ===
					editor.activePageID
						? 'ring-2 ring-primary'
						: ''} {externalDropPageID === page.id ? 'bg-primary/10 ring-2 ring-primary' : ''}"
					onclick={() => {
						editor.activePageID = page.id;
						editor.selectedLayerIDs = [];
					}}
					ondragstart={() => (draggingID = page.id)}
					ondragover={(event) => handlePageDragOver(event, page.id)}
					ondragleave={() => (externalDropPageID = '')}
					ondrop={(event) => handlePageDrop(event, page.id, index)}
					onkeydown={(event) => reorderPageFromKeyboard(event, page.id, index)}
					data-external-drop={externalDropPageID === page.id ? 'active' : undefined}
					aria-label={m.image_editor_page_label({
						number: index + 1,
						name: displayPageName(page.name, index)
					})}
					aria-current={page.id === editor.activePageID ? 'page' : undefined}
					aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
					title={m.image_editor_page_reorder_hint()}
				>
					<span class="min-h-0 flex-1 overflow-hidden">
						<TemplatePreview
							document={editor.document}
							{page}
							compact
							label={displayPageName(page.name, index)}
						/>
					</span>
					<span class="w-full truncate border-t px-1.5 py-0.5 text-xs">
						{index + 1}. {displayPageName(page.name, index)}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
