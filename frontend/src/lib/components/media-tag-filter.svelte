<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { MediaTag } from '$lib/media-tags';
	import HashIcon from '@lucide/svelte/icons/hash';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import { m } from '$lib/paraglide/messages';

	let {
		tags,
		selectedIds = [],
		untagged = false,
		canEdit = false,
		onChange,
		onManage
	}: {
		tags: MediaTag[];
		selectedIds?: string[];
		untagged?: boolean;
		canEdit?: boolean;
		onChange: (selectedIds: string[], untagged: boolean) => void;
		onManage?: () => void;
	} = $props();

	function toggle(tagId: string): void {
		onChange(
			selectedIds.includes(tagId)
				? selectedIds.filter((id) => id !== tagId)
				: [...selectedIds, tagId],
			false
		);
	}
</script>

<div class="flex min-w-0 flex-wrap items-center gap-1.5" aria-label={m.media_filter_by_tag()}>
	<Button
		variant={selectedIds.length === 0 && !untagged ? 'secondary' : 'ghost'}
		size="sm"
		class="min-h-11 rounded-full px-3 sm:min-h-8"
		onclick={() => onChange([], false)}
	>
		{m.media_all_tags()}
	</Button>
	<Button
		variant={untagged ? 'secondary' : 'ghost'}
		size="sm"
		class="min-h-11 rounded-full px-3 sm:min-h-8"
		onclick={() => onChange([], true)}
	>
		{m.media_untagged()}
	</Button>
	{#each tags as tag (tag.id)}
		<Button
			variant={selectedIds.includes(tag.id) ? 'secondary' : 'ghost'}
			size="sm"
			class="min-h-11 max-w-48 rounded-full px-2.5 sm:min-h-8"
			aria-pressed={selectedIds.includes(tag.id)}
			onclick={() => toggle(tag.id)}
		>
			<HashIcon class="size-3.5" />
			<span class="truncate">{tag.name}</span>
			<span class="text-xs text-muted-foreground tabular-nums">{tag.item_count}</span>
		</Button>
	{/each}
	{#if canEdit && onManage}
		<Button
			variant="ghost"
			size="icon-sm"
			class="min-h-11 min-w-11 rounded-full sm:min-h-8 sm:min-w-8"
			onclick={onManage}
			aria-label={m.media_manage_tags()}
		>
			<SettingsIcon />
		</Button>
	{/if}
</div>
