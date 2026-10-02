<script lang="ts">
	import CompositionTimeline from './composition-timeline.svelte';
	let { onedit = () => {} }: { onedit?: () => void } = $props();
	let selectedItemId = $state<string | null>(null);
</script>

<CompositionTimeline {selectedItemId} onselectitem={(id) => (selectedItemId = id)} {onedit} />
