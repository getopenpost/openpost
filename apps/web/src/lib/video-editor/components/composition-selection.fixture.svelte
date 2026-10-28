<script lang="ts">
	import CompositionTimeline from './composition-timeline.svelte';
	let {
		onedit = () => {},
		onselectitem
	}: { onedit?: () => void; onselectitem?: (id: string | null) => void } = $props();
	let selectedItemId = $state<string | null>(null);
</script>

<CompositionTimeline
	{selectedItemId}
	onselectitem={(id) => {
		selectedItemId = id;
		onselectitem?.(id);
	}}
	{onedit}
/>
