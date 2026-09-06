<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { useImageEditor } from '../editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import TemplatePreview from './template-preview.svelte';
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
	let keyboardDraggingID = $state('');
	let previewOrder = $state<string[] | null>(null);
	let previewDocument = $state.raw<typeof editor.document>(null);
	let reorderAnnouncement = $state('');
	let insertionPageID = $state('');
	let strip = $state<HTMLDivElement>();
	function focusPage(id: string) {
		void tick().then(() =>
			strip?.querySelector<HTMLButtonElement>(`[data-page-id="${CSS.escape(id)}"]`)?.focus()
		);
	}
	const hintID = $props.id();
	const pages = $derived(editor.document?.pages ?? []);
	const displayPages = $derived(
		previewOrder ? previewOrder.flatMap((id) => pages.find((page) => page.id === id) ?? []) : pages
	);
	$effect(() => {
		if (previewDocument !== editor.document) cancelReorder();
	});
	function cancelReorder() {
		if (keyboardDraggingID) reorderAnnouncement = m.interaction_reorder_cancelled();
		keyboardDraggingID = '';
		previewOrder = null;
		previewDocument = editor.document;
	}

	function displayPageName(name: string, index: number): string {
		return /^Page \d+$/.test(name) ? m.image_editor_default_page_name({ number: index + 1 }) : name;
	}

	function commitPageMove(pageID: string, target: number, announcement: 'moved' | 'dropped'): void {
		const source = pages.findIndex((page) => page.id === pageID);
		if (source < 0 || target < 0 || target >= pages.length || source === target) return;
		const name = displayPageName(pages[source].name, source);
		editor.reorderPage(pageID, target);
		reorderAnnouncement =
			announcement === 'dropped'
				? m.interaction_reorder_dropped({ name, position: target + 1 })
				: m.interaction_reorder_moved({ name, position: target + 1, total: pages.length });
		focusPage(pageID);
	}

	function moveActivePage(delta: -1 | 1): void {
		const source = pages.findIndex((page) => page.id === editor.activePageID);
		commitPageMove(editor.activePageID, source + delta, 'moved');
	}

	function reorderPageFromKeyboard(event: KeyboardEvent, pageID: string, index: number): void {
		if (!editor.canEdit) return;
		if (event.key === 'Tab') {
			cancelReorder();
			return;
		}
		const name = displayPageName(displayPages[index]?.name ?? '', index);
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			if (keyboardDraggingID === pageID) {
				const target = previewOrder?.indexOf(pageID) ?? index;
				cancelReorder();
				if (pages.findIndex((page) => page.id === pageID) !== target)
					editor.reorderPage(pageID, target);
				reorderAnnouncement = m.interaction_reorder_dropped({ name, position: target + 1 });
				focusPage(pageID);
			} else {
				previewDocument = editor.document;
				keyboardDraggingID = pageID;
				previewOrder = pages.map((page) => page.id);
				reorderAnnouncement = m.interaction_reorder_grabbed({
					name,
					position: index + 1,
					total: pages.length
				});
			}
			return;
		}
		if (event.key === 'Escape' && keyboardDraggingID) {
			event.preventDefault();
			event.stopPropagation();
			cancelReorder();
			reorderAnnouncement = m.interaction_reorder_cancelled();
			focusPage(pageID);
			return;
		}
		const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (!delta || (!keyboardDraggingID && !event.altKey)) return;
		event.preventDefault();
		event.stopPropagation();
		const target = index + delta;
		if (target < 0 || target >= pages.length) return;
		if (!keyboardDraggingID) {
			commitPageMove(pageID, target, 'moved');
			return;
		}
		const next = [...(previewOrder ?? [])];
		next.splice(index, 1);
		next.splice(target, 0, pageID);
		previewOrder = next;
		focusPage(pageID);
		reorderAnnouncement = m.interaction_reorder_moved({
			name,
			position: target + 1,
			total: pages.length
		});
	}

	function handlePageDragOver(event: DragEvent, pageID: string): void {
		event.preventDefault();
		if (draggingID && draggingID !== pageID) insertionPageID = pageID;
		if (!containsExternalImageDrag(event.dataTransfer)) return;
		externalDropPageID = pageID;
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	function handlePageDrop(event: DragEvent, pageID: string, index: number): void {
		event.preventDefault();
		const files = externalFiles(event.dataTransfer);
		externalDropPageID = '';
		insertionPageID = '';
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
		if (draggingID) commitPageMove(draggingID, index, 'dropped');
		draggingID = '';
	}
</script>

<svelte:window onblur={() => cancelReorder()} />

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
			<ThemeIcon role={editor.pagesExpanded ? 'chevron-down' : 'chevron-up'} />
		</Button>
		<span class="sr-only text-sm font-medium text-foreground sm:not-sr-only"
			>{m.image_editor_pages()}</span
		>
		<span class="hidden text-xs text-muted-foreground sm:inline"
			>{editor.document?.pages.length ?? 0}</span
		>
		<div class="ml-auto flex gap-1">
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 lg:size-7"
				aria-label={m.interaction_reorder_previous()}
				title={m.interaction_reorder_previous()}
				disabled={!editor.canEdit ||
					pages.findIndex((page) => page.id === editor.activePageID) <= 0}
				onclick={() => moveActivePage(-1)}><ThemeIcon role="arrow-left" /></Button
			>
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 lg:size-7"
				aria-label={m.interaction_reorder_next()}
				title={m.interaction_reorder_next()}
				disabled={!editor.canEdit ||
					pages.findIndex((page) => page.id === editor.activePageID) >= pages.length - 1}
				onclick={() => moveActivePage(1)}><ThemeIcon role="arrow-right" /></Button
			>

			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 md:size-11 lg:size-7"
				onclick={() => editor.addPage()}
				disabled={!editor.canEdit}
			>
				<ThemeIcon role="add" />
				<span class="sr-only">{m.image_editor_add_page()}</span>
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 md:size-11 lg:size-7"
				onclick={() => editor.duplicatePage()}
				disabled={!editor.canEdit}
			>
				<ThemeIcon role="copy" />
				<span class="sr-only">{m.image_editor_duplicate_page()}</span>
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="size-11 md:size-11 lg:size-7"
				onclick={() => editor.deletePage()}
				disabled={!editor.canEdit || (editor.document?.pages.length ?? 0) <= 1}
			>
				<ThemeIcon role="delete" />
				<span class="sr-only">{m.image_editor_delete_page()}</span>
			</Button>
		</div>
	</div>
	{#if editor.pagesExpanded && editor.document}
		<div
			bind:this={strip}
			class="no-scrollbar flex h-24 shrink-0 items-center gap-2 overflow-x-auto px-3 py-2 lg:h-auto lg:min-h-0 lg:flex-1"
		>
			{#each displayPages as page, index (page.id)}
				<button
					animate:flip={{ duration: prefersReducedMotion.current ? 0 : 200 }}
					class:page-grabbed={keyboardDraggingID === page.id}
					class:page-insertion={insertionPageID === page.id}
					onblur={(event) => {
						if (event.relatedTarget && keyboardDraggingID === page.id) cancelReorder();
					}}
					data-page-id={page.id}
					aria-pressed={keyboardDraggingID === page.id}
					aria-describedby={hintID}
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
					ondragstart={() => {
						cancelReorder();
						draggingID = page.id;
					}}
					ondragend={() => {
						draggingID = '';
						insertionPageID = '';
					}}
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
					aria-keyshortcuts="Space Enter ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Escape"
					title={m.interaction_reorder_hint()}
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

<span id={hintID} class="sr-only">{m.interaction_reorder_hint()}</span>
<span class="sr-only" role="status" aria-live="polite" aria-atomic="true"
	>{reorderAnnouncement}</span
>

<style>
	.page-grabbed {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
		background: var(--muted);
	}
	.page-insertion {
		box-shadow: -6px 0 0 -2px var(--primary);
	}
</style>
