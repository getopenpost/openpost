<script lang="ts">
	import type { Column } from '@tanstack/table-core';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';

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
		<ArrowUpIcon class="size-3" />
	{:else if sorted === 'desc'}
		<ArrowDownIcon class="size-3" />
	{:else}
		<ArrowUpDownIcon class="size-3" />
	{/if}
</Button>
