<script lang="ts">
	import ReorderList from './reorder-list.svelte';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	let {
		items,
		onReorder,
		scope = 'workspace-1'
	}: {
		items: { key: string; name: string }[];
		onReorder: (items: { key: string; name: string }[]) => void;
		scope?: string;
	} = $props();
</script>

<ReorderList {items} {onReorder} {scope} label="Posts">
	{#snippet item(entry, index, handle)}
		<div class="flex min-h-20 items-center gap-2 border-b p-3">
			<Button {...handle} variant="outline" aria-label={`Move ${entry.name}`}>Move</Button><Input
				aria-label={entry.name}
				value={entry.name}
			/><span>{index + 1}</span>
		</div>
	{/snippet}
</ReorderList>
