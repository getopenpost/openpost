<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import { preserveOpeningFocus } from '../opening-focus';
	import { cn } from '../../utils.js';

	let {
		ref = $bindable(null),
		class: className,
		align = 'center',
		sideOffset = 4,
		onOpenAutoFocus,
		...restProps
	}: PopoverPrimitive.ContentProps = $props();
	function handleOpenAutoFocus(event: Event) {
		preserveOpeningFocus(event, () => ref, onOpenAutoFocus);
	}
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{align}
		{sideOffset}
		onOpenAutoFocus={handleOpenAutoFocus}
		class={cn(
			'z-50 w-72 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none',
			className
		)}
		{...restProps}
	/>
</PopoverPrimitive.Portal>
