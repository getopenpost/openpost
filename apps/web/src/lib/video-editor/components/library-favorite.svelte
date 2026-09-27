<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { toast } from 'svelte-sonner';
	import { videoLibrary } from '../library/library-store.svelte';
	import type { LibraryRecipe } from '../library/types';
	let {
		catalogId,
		name,
		recipe,
		placement = 'overlay'
	}: {
		catalogId: string;
		name: string;
		recipe: LibraryRecipe;
		placement?: 'overlay' | 'inline';
	} = $props();
	const id = $derived(`${videoLibrary.scope}:${catalogId}`);
	const entry = $derived(videoLibrary.entries.find((value) => value.id === id));
	async function toggle(): Promise<void> {
		try {
			if (entry) await videoLibrary.update(entry, { favorite: !entry.favorite });
			else await videoLibrary.save(name, $state.snapshot(recipe), '', true, id);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	}
</script>

<Button
	size="icon-xs"
	variant="ghost"
	aria-label={m.video_editor_library_favorite({ name })}
	aria-pressed={entry?.favorite ?? false}
	onclick={toggle}
	title={m.video_editor_library_favorite({ name })}
	class={`${placement === 'overlay' ? 'absolute! top-1 right-1 z-10 border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)]' : ''} ${entry?.favorite ? 'text-[var(--video-editor-focus)]' : 'text-[var(--video-editor-muted)]'}`}
	><ThemeIcon role="favorite" /></Button
>
