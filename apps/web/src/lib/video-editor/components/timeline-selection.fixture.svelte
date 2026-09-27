<script lang="ts">
	import TimelinePanel from './timeline-panel.svelte';
	let { onedit, topSpace = 0 }: { onedit: () => void; topSpace?: number } = $props();
	let selectedItemId = $state<string | null>(null);
	let selectedItemIds = $state<string[]>([]);
</script>

<div style="width: 1100px; height: 400px" style:margin-top={`${topSpace}px`}>
	<TimelinePanel {onedit} bind:selectedItemId bind:selectedItemIds />
</div>
<output aria-label="Selected clips">{selectedItemIds.join(',')}</output>
