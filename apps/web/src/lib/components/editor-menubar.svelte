<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Menubar from '$lib/components/ui/menubar';
	import { cn } from '$lib/utils';

	interface Props {
		ariaLabel: string;
		children: Snippet;
		class?: string;
	}

	let { ariaLabel, children, class: className }: Props = $props();
</script>

<Menubar.Root
	class={cn('hidden h-8 gap-0 border-0 bg-transparent p-0 lg:flex', className)}
	aria-label={ariaLabel}
>
	{@render children()}
</Menubar.Root>
