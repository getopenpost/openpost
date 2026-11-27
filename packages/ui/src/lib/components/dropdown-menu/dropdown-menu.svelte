<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

	let {
		open = $bindable(false),
		dir = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
		...restProps
	}: DropdownMenuPrimitive.RootProps = $props();
</script>

<DropdownMenuPrimitive.Root bind:open {dir} {...restProps} />
