<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';

	type Props =
		| (Omit<Extract<SelectPrimitive.RootProps, { type: 'single' }>, 'type'> & { type?: 'single' })
		| Extract<SelectPrimitive.RootProps, { type: 'multiple' }>;

	let { open = $bindable(false), value = $bindable(), ...restProps }: Props = $props();
</script>

{#if restProps.type === 'multiple'}
	<SelectPrimitive.Root {...restProps} bind:open bind:value={value as string[]} />
{:else}
	<SelectPrimitive.Root {...restProps} type="single" bind:open bind:value={value as string} />
{/if}
