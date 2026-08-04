<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import type { MediaTag } from '$lib/media-tags';
	import HashIcon from 'lucide-svelte/icons/hash';
	import CheckIcon from 'lucide-svelte/icons/check';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import TagIcon from 'lucide-svelte/icons/tag';
	import { m } from '$lib/paraglide/messages';

	let {
		tags,
		selectedIds = [],
		canEdit = false,
		label = m.media_add_tag(),
		onToggle,
		onCreate
	}: {
		tags: MediaTag[];
		selectedIds?: string[];
		canEdit?: boolean;
		label?: string;
		onToggle: (tagId: string, selected: boolean) => void | Promise<void>;
		onCreate?: (name: string) => void | Promise<void>;
	} = $props();

	let newTagName = $state('');
	let busyTagId = $state('');
	let creating = $state(false);
	let error = $state('');

	async function toggle(tagId: string, selected: boolean): Promise<void> {
		busyTagId = tagId;
		error = '';
		try {
			await onToggle(tagId, selected);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_tag_update_failed();
		} finally {
			busyTagId = '';
		}
	}

	async function create(): Promise<void> {
		const name = newTagName.trim();
		if (!name || !onCreate) return;
		creating = true;
		error = '';
		try {
			await onCreate(name);
			newTagName = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_tag_create_failed();
		} finally {
			creating = false;
		}
	}
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="h-8 rounded-full px-2.5">
				<TagIcon class="size-3.5" />
				{label}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-64 p-2">
		<div class="max-h-64 space-y-1 overflow-y-auto">
			{#each tags as tag (tag.id)}
				<button
					type="button"
					class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					disabled={!canEdit || Boolean(busyTagId)}
					onclick={() => void toggle(tag.id, !selectedIds.includes(tag.id))}
				>
					{#if busyTagId === tag.id}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<span
							class="flex size-4 shrink-0 items-center justify-center rounded-sm border {selectedIds.includes(
								tag.id
							)
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-input'}"
							aria-hidden="true"
						>
							{#if selectedIds.includes(tag.id)}<CheckIcon class="size-3" />{/if}
						</span>
					{/if}
					<HashIcon class="size-3.5 text-muted-foreground" />
					<span class="min-w-0 flex-1 truncate">{tag.name}</span>
				</button>
			{/each}
			{#if tags.length === 0}
				<p class="px-2 py-4 text-center text-sm text-muted-foreground">{m.media_no_tags()}</p>
			{/if}
		</div>
		{#if canEdit && onCreate}
			<form
				class="mt-2 flex gap-1.5 border-t pt-2"
				onsubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<Input bind:value={newTagName} maxlength={64} class="h-9" placeholder={m.media_new_tag()} />
				<Button
					type="submit"
					size="icon-sm"
					disabled={creating || !newTagName.trim()}
					aria-label={m.media_create_tag()}
				>
					{#if creating}<LoaderIcon class="animate-spin" />{:else}<PlusIcon />{/if}
				</Button>
			</form>
		{/if}
		{#if error}<p class="mt-2 text-xs text-destructive" role="alert">{error}</p>{/if}
	</Popover.Content>
</Popover.Root>
