<script lang="ts">
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import AudioEffectsPanel from './audio-effects-panel.svelte';
	const item = $derived(timelineStore.itemById.get('audio'));
</script>

{#if item}<AudioEffectsPanel {item} open />{/if}
<button type="button">Elsewhere</button>
