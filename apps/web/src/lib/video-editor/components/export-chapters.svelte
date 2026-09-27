<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { chaptersFromMarkers } from '../export/chapters';
	import type { TimelineMarker } from '../project/types';

	let {
		markers,
		fps,
		range
	}: { markers: TimelineMarker[]; fps: number; range: { startFrame: number; endFrame: number } } =
		$props();
	const generated = $derived(chaptersFromMarkers(markers, fps, range));
	let text = $derived(generated);
	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(m.video_editor_chapters_copied());
		} catch {
			toast.error(m.video_editor_chapters_copy_failed());
		}
	}
</script>

<details class="mt-3 border-t border-[var(--video-editor-border)] pt-3">
	<summary
		class="cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [@media(pointer:coarse)]:min-h-11"
		>{m.video_editor_chapters()}</summary
	>
	<div class="mt-2 grid gap-2">
		{#if generated}
			<Textarea
				bind:value={text}
				aria-label={m.video_editor_chapters()}
				rows={5}
				class="font-mono text-xs"
			/>
			<div class="flex flex-wrap justify-end gap-2">
				<Button
					size="sm"
					variant="ghost"
					disabled={text === generated}
					onclick={() => (text = generated)}>{m.video_editor_chapters_reset()}</Button
				>
				<Button size="sm" variant="outline" disabled={!text.trim()} onclick={copy}
					>{m.video_editor_chapters_copy()}</Button
				>
			</div>
		{:else}
			<p class="text-xs text-[var(--video-editor-muted)]">{m.video_editor_chapters_empty()}</p>
		{/if}
	</div>
</details>
