<script lang="ts">
	import ToolFamilyButton from './tool-family-button.svelte';

	let {
		onactivate,
		layout = 'rail'
	}: {
		onactivate: () => void;
		layout?: 'rail' | 'bottom';
	} = $props();
	let active = $state(false);

	function activate(): void {
		active = true;
		onactivate();
	}
</script>

<ToolFamilyButton label="Pixel select" {active} {layout} onclick={activate}>
	{#snippet icon()}
		<span aria-hidden="true">□</span>
		{#if layout === 'bottom'}<span>Pixel select</span>{/if}
	{/snippet}
	{#snippet menu()}
		<button type="button" role="menuitem">Rectangle select</button>
		<button type="button" role="menuitem">Ellipse select</button>
	{/snippet}
</ToolFamilyButton>
