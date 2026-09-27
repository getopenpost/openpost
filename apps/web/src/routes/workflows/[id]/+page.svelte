<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		workflowQueryOptions,
		workflowConnectionsQueryOptions,
		workspaceAccountsQueryOptions
	} from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { queryAPI } from '$lib/query/api';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import Editor from '$lib/workflows/editor.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const workflowQuery = createQuery(() =>
		workflowQueryOptions(workflowQueryAPI, workspaceID, page.params.id ?? '')
	);
	const accountsQuery = createQuery(() => workspaceAccountsQueryOptions(queryAPI, workspaceID));
	const connectionsQuery = createQuery(() => ({
		...workflowConnectionsQueryOptions(workflowQueryAPI, workspaceID),
		enabled: Boolean(workspaceID) && workspaceCtx.currentWorkspace?.role !== 'viewer'
	}));
	const error = $derived(workflowQuery.error || accountsQuery.error || connectionsQuery.error);
	// Read every observer before combining states, so faster responses remain subscribed.
	const loading = $derived(
		[
			workflowQuery.isPending,
			accountsQuery.isPending,
			connectionsQuery.isPending && workspaceCtx.currentWorkspace?.role !== 'viewer'
		].some(Boolean)
	);
</script>

<svelte:head><title>{m.workflows_title()} · OpenPost</title></svelte:head>
{#if workflowQuery.data && !loading}
	{#key `${workspaceID}:${workflowQuery.data.id}`}<Editor
			initial={workflowQuery.data}
			accounts={accountsQuery.data ?? []}
			connections={connectionsQuery.data ?? []}
		/>{/key}
{:else}<PageContainer title={m.workflows_title()} themeIconRole="repeat" loading={loading && !error}
		>{#if error}<InlineNotice tone="error" message={String(error)} />{/if}<Button
			variant="outline"
			href="/workflows">{m.workflows_back()}</Button
		></PageContainer
	>{/if}
