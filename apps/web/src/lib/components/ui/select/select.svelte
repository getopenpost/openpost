<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';

	type Props =
		| (Omit<Extract<SelectPrimitive.RootProps, { type: 'single' }>, 'type'> & { type?: 'single' })
		| Extract<SelectPrimitive.RootProps, { type: 'multiple' }>;

	let {
		open = $bindable(false),
		value = $bindable(),
		type = 'single',
		...restProps
	}: Props = $props();
</script>

<SelectPrimitive.Root bind:open bind:value={value as never} {type} {...restProps} />
