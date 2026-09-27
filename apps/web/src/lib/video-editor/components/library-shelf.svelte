<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { videoLibrary } from '../library/library-store.svelte';
	import { applyLibraryEntry } from '../library/apply';
	import type { LibraryEntry } from '../library/types';
	import type { ProjectAssetImporter } from '../media/types';
	let {
		kind,
		selectedIds = [],
		oninserted,
		onedit = () => {},
		importAsset
	}: {
		kind: 'text' | 'timer' | 'effects';
		selectedIds?: string[];
		oninserted: (id: string) => void;
		onedit?: () => void;
		importAsset?: ProjectAssetImporter;
	} = $props();
	let busy = $state(false);
	const entries = $derived(
		videoLibrary.entries.filter(
			({ recipe }) =>
				recipe.kind === kind ||
				(kind === 'text' && recipe.kind === 'text-style') ||
				(recipe.kind === 'selection' &&
					recipe.project.timeline?.items.length === 1 &&
					(kind === 'timer'
						? recipe.project.timeline.items[0]?.timer
						: kind === 'text' && recipe.project.timeline.items[0]?.type === 'text'))
		)
	);
	async function apply(entry: LibraryEntry): Promise<void> {
		busy = true;
		try {
			const ids = await applyLibraryEntry($state.snapshot(entry), { selectedIds, importAsset });
			if (ids[0]) oninserted(ids[0]);
			onedit();
			await videoLibrary.update(entry, { lastUsed: Date.now() });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			busy = false;
		}
	}
</script>

{#if entries.length}
	<div class="mb-3 grid gap-1 border-b border-[var(--video-editor-border)] pb-2">
		<p class="text-xs text-[var(--video-editor-muted)]">{m.video_editor_library_saved()}</p>
		{#each entries as entry (entry.id)}<Button
				size="xs"
				variant="ghost"
				class="justify-start truncate"
				disabled={busy}
				onclick={() => apply(entry)}>{entry.name}</Button
			>{/each}
	</div>
{/if}
