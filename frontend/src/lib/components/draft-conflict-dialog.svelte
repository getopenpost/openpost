<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { DraftConflictProblem } from '$lib/draft-conflict';

	interface Props {
		open?: boolean;
		conflict: DraftConflictProblem | null;
		onReload: () => void | Promise<void>;
		onSaveCopy: () => void | Promise<void>;
		onOverwrite: () => void | Promise<void>;
	}

	let { open = $bindable(false), conflict, onReload, onSaveCopy, onOverwrite }: Props = $props();
	let pendingAction = $state<'reload' | 'copy' | 'overwrite' | ''>('');
	const changedDomains = $derived(
		conflict?.conflict.changed_domains.length
			? conflict.conflict.changed_domains.join(', ')
			: 'draft'
	);

	async function run(
		action: 'reload' | 'copy' | 'overwrite',
		callback: () => void | Promise<void>
	) {
		if (pendingAction) return;
		pendingAction = action;
		try {
			await callback();
			open = false;
		} finally {
			pendingAction = '';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content aria-busy={Boolean(pendingAction)} showCloseButton={false} class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.draft_conflict_title()}</Dialog.Title>
			<Dialog.Description>{m.draft_conflict_body()}</Dialog.Description>
		</Dialog.Header>
		<p class="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
			{m.draft_conflict_changed({ domains: changedDomains })}
			{#if conflict?.conflict.changed_by_name}
				<span class="mt-1 block">
					{m.draft_conflict_changed_by({ name: conflict.conflict.changed_by_name })}
				</span>
			{/if}
		</p>
		<Dialog.Footer class="sm:grid sm:grid-cols-2">
			<Button
				variant="outline"
				disabled={Boolean(pendingAction)}
				onclick={() => run('reload', onReload)}
			>
				{#if pendingAction === 'reload'}<LoaderIcon class="size-4 animate-spin" />{/if}
				{m.draft_conflict_reload()}
			</Button>
			<Button
				variant="outline"
				disabled={Boolean(pendingAction)}
				onclick={() => run('copy', onSaveCopy)}
			>
				{#if pendingAction === 'copy'}<LoaderIcon class="size-4 animate-spin" />{/if}
				{m.draft_conflict_copy()}
			</Button>
			<Button disabled={Boolean(pendingAction)} onclick={() => run('overwrite', onOverwrite)}>
				{#if pendingAction === 'overwrite'}<LoaderIcon class="size-4 animate-spin" />{/if}
				{m.draft_conflict_overwrite()}
			</Button>
			<Button variant="ghost" disabled={Boolean(pendingAction)} onclick={() => (open = false)}>
				{m.draft_conflict_keep_editing()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
