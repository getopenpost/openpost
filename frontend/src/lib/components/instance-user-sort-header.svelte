<script lang="ts">
	import type { Column } from '@tanstack/table-core';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';

	type InstanceUser = components['schemas']['InstanceUserResponse'];

	interface Props {
		column: Column<InstanceUser, unknown>;
		label: string;
		sortLabel: string;
	}

	let { column, label, sortLabel }: Props = $props();
	const sorted = $derived(column.getIsSorted());
</script>

<Button
	variant="ghost"
	size="xs"
	class="-ml-2 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
	onclick={() => column.toggleSorting(sorted === 'asc')}
	aria-label={sortLabel}
>
	{label}
	{#if sorted === 'asc'}
		<ThemeIcon role="arrow-up" class="size-3" />
	{:else if sorted === 'desc'}
		<ThemeIcon role="arrow-down" class="size-3" />
	{:else}
		<span class="relative size-3" aria-hidden="true">
			<ThemeIcon role="arrow-up" class="absolute inset-x-0 -top-0.5 h-2 w-3" />
			<ThemeIcon role="arrow-down" class="absolute inset-x-0 -bottom-0.5 h-2 w-3" />
		</span>
	{/if}
</Button>
