<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { publicationBuildQueryOptions } from '@openpost/query-catalog';
	import { publicationBuildQueryAPI } from '$lib/query/publication-builds';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import DataView from './data-view.svelte';
	import { m } from '$lib/paraglide/messages';
	let { workspaceID, buildID }: { workspaceID: string; buildID: string } = $props();
	let open = $state(false);
	const current = $derived(workspaceCtx.currentWorkspace?.id === workspaceID);
	const buildQuery = createQuery(() =>
		publicationBuildQueryOptions(
			publicationBuildQueryAPI,
			open && current ? workspaceID : '',
			open && current ? buildID : ''
		)
	);
	const build = $derived(
		buildQuery.data?.workspace_id === workspaceID && current ? buildQuery.data : undefined
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger
		>{#snippet child({ props })}<Button {...props} variant="outline" size="sm"
				>{m.workflows_inspect_build()}</Button
			>{/snippet}</Dialog.Trigger
	>
	<Dialog.Content class="flex max-h-[85dvh] flex-col gap-3 overflow-hidden sm:max-w-xl">
		<Dialog.Header><Dialog.Title>{m.workflows_build_details()}</Dialog.Title></Dialog.Header>
		{#if buildQuery.isPending}<p role="status" class="text-sm text-muted-foreground">
				{m.common_loading()}
			</p>
		{:else if buildQuery.error}<InlineNotice tone="error" message={String(buildQuery.error)}>
				{#snippet actions()}<Button
						variant="outline"
						size="sm"
						onclick={() => {
							void buildQuery.refetch();
						}}>{m.common_retry()}</Button
					>{/snippet}
			</InlineNotice>
		{:else if build}<div class="min-h-0 overflow-auto">
				<DataView
					label={m.workflows_build_details()}
					value={{
						build_id: build.id,
						state: build.state,
						phase: build.phase,
						error_code: build.error_code,
						error_message: build.error_message,
						result: build.result
					}}
				/>
			</div>{/if}
	</Dialog.Content>
</Dialog.Root>
