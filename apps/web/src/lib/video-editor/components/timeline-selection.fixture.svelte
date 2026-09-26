<script lang="ts">
	import TimelinePanel from './timeline-panel.svelte';
	let { onedit }: { onedit: () => void } = $props();
	let selectedItemId = $state<string | null>(null);
	let selectedItemIds = $state<string[]>([]);
</script>

<div style="width: 1100px; height: 400px">
	<TimelinePanel {onedit} bind:selectedItemId bind:selectedItemIds />
</div>
<output aria-label="Selected clips">{selectedItemIds.join(',')}</output>
