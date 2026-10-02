<script lang="ts">
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import AudioEffectsPanel from './audio-effects-panel.svelte';
	let { focusAfterOrder = false }: { focusAfterOrder?: boolean } = $props();
	let elsewhere = $state<HTMLButtonElement>();
	let previousOrder: string | undefined;
	const item = $derived(timelineStore.itemById.get('audio'));
	$effect(() => {
		const order = item?.audioEffects?.map((effect) => effect.id).join(',');
		if (focusAfterOrder && previousOrder !== undefined && order !== previousOrder)
			elsewhere?.focus();
		previousOrder = order;
	});
</script>

{#if item}<AudioEffectsPanel {item} open />{/if}
<button bind:this={elsewhere} type="button">Elsewhere</button>
