<script lang="ts">
	import { ContextMenu as ContextMenuPrimitive } from 'bits-ui';

	let {
		open = $bindable(false),
		dir = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
		...restProps
	}: ContextMenuPrimitive.RootProps = $props();
</script>

<ContextMenuPrimitive.Root bind:open {dir} {...restProps} />
