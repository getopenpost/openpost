<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { screenshotTemplateDetailOptions } from '@openpost/query-catalog';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { screenshotTemplateAPI } from '$lib/query/screenshot-templates';
	import Editor from '$lib/screenshot-templates/editor.svelte';
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let openedWorkspace = $state('');
	$effect(() => {
		if (!workspaceId) return;
		if (!openedWorkspace) {
			openedWorkspace = workspaceId;
			return;
		}
		if (openedWorkspace !== workspaceId) void goto(resolveAppPath('/templates'));
	});
	const design = createQuery(() =>
		screenshotTemplateDetailOptions(screenshotTemplateAPI, workspaceId, page.params.id ?? '')
	);
</script>

<svelte:head><title>{design.data?.title ?? m.templates_title()} · OpenPost</title></svelte:head>
{#if design.isPending && !design.data}<PageLoading
		layout="composer"
	/>{:else if design.isError && !design.data}<div class="p-4">
		<InlineNotice tone="error" message={m.templates_load_failed()}
			>{#snippet actions()}<Button variant="outline" onclick={() => design.refetch()}
					>{m.common_retry()}</Button
				><Button variant="ghost" href={resolveAppPath('/templates')}>{m.common_back()}</Button
				>{/snippet}</InlineNotice
		>
	</div>{:else if design.data}{#key `${workspaceId}:${design.data.id}`}<Editor
			design={design.data}
			returnToken={page.url.searchParams.get('return_token') ?? ''}
		/>{/key}{/if}
