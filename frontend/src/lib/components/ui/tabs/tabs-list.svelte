<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.ListProps = $props();
</script>

<!-- Tab presentation is decided by the active theme recipe
	([data-theme-tabs] on the theme scope), never by callers. -->
<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn(
		'rounded-lg bg-navigation-hover p-[3px] group-data-horizontal/tabs:h-auto group-data-horizontal/tabs:min-h-11 md:group-data-horizontal/tabs:h-8 md:group-data-horizontal/tabs:min-h-0 group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
		className
	)}
	{...restProps}
/>
