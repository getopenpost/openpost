<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import {
		formatLinkedSyncOffset,
		linkedSyncBadgeMinimumWidth
	} from '$lib/video-editor/timeline/linked-sync-display';

	let {
		offsetFrames,
		fps,
		clipWidthPx
	}: { offsetFrames: number; fps: number; clipWidthPx: number } = $props();

	const label = $derived(formatLinkedSyncOffset(offsetFrames, fps));
	const description = $derived(m.video_editor_linked_sync_offset({ offset: label }));
	const minimumWidth = $derived(linkedSyncBadgeMinimumWidth(label));
</script>

{#if clipWidthPx >= minimumWidth}
	<span
		class="relative z-10 mr-1 shrink-0 rounded bg-amber-950/80 px-1 py-0.5 font-mono text-[8px] font-semibold text-amber-100 ring-1 ring-amber-400/45"
		title={description}
		aria-label={description}
		data-linked-sync-offset={offsetFrames}
	>
		{label}
	</span>
{/if}
