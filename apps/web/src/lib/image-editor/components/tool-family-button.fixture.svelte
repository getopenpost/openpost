<script lang="ts">
	import ToolFamilyButton from './tool-family-button.svelte';

	let { onactivate }: { onactivate: () => void } = $props();
</script>

<ToolFamilyButton label="Pixel select" active={false} onclick={onactivate}>
	{#snippet icon()}<span aria-hidden="true">□</span>{/snippet}
	{#snippet menu()}
		<button type="button" role="menuitem">Rectangle select</button>
		<button type="button" role="menuitem">Ellipse select</button>
	{/snippet}
</ToolFamilyButton>
