<script lang="ts">
	import { goto } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		repostAutomationQueryOptions,
		workflowsQueryOptions,
		workflowRunsQueryOptions
	} from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { saveWorkflow, deleteWorkflow, type Workflow, type Definition } from '$lib/workflows/api';
	import { templates, sourceLabel, runStateLabel } from '$lib/workflows/catalog';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import RepostHistory from '$lib/workflows/repost-history.svelte';
	import GraphPreview from '$lib/workflows/graph-preview.svelte';
	import RunInspector from '$lib/workflows/run-inspector.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let deleting = $state<Workflow | null>(null),
		deleteOpen = $state(false);
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const workflowsQuery = createQuery(() => workflowsQueryOptions(workflowQueryAPI, workspaceID));
	const repostsQuery = createQuery(() =>
		repostAutomationQueryOptions(schedulingQueryAPI, workspaceID)
	);
	const runsQuery = createQuery(() => workflowRunsQueryOptions(workflowQueryAPI, workspaceID));
	let tab = $state<'workflows' | 'runs' | 'templates'>('workflows'),
		selectedRun = $state(''),
		busy = $state(false),
		error = $state('');
	async function create(
		name: string = m.workflows_untitled(),
		definition: Definition = { schema: 1, source: { kind: 'manual' }, steps: [] }
	) {
		busy = true;
		error = '';
		try {
			const workflow = await saveWorkflow(workspaceID, '', {
				name,
				description: '',
				expected_revision: 0,
				definition
			});
			await goto(`/workflows/${workflow.id}`);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{m.workflows_title()} · OpenPost</title></svelte:head>
<PageContainer
	title={m.workflows_title()}
	description={m.workflows_subtitle()}
	themeIconRole="repeat"
	loading={[
		workflowsQuery.isPending && !workflowsQuery.error,
		repostsQuery.isPending && !repostsQuery.error
	].some(Boolean)}
>
	{#snippet actions()}<Button
			disabled={busy || !workspaceID || workspaceCtx.currentWorkspace?.role === 'viewer'}
			onclick={() => create()}><ThemeIcon role="add" class="size-4" />{m.workflows_new()}</Button
		>{/snippet}
	{#snippet navigation()}<div class="flex flex-wrap gap-2 border-b pb-3">
			{#each [{ id: 'workflows', label: m.workflows_your_workflows() }, { id: 'runs', label: m.workflows_runs() }, { id: 'templates', label: m.workflows_templates() }] as item}<Button
					variant={tab === item.id ? 'secondary' : 'ghost'}
					size="sm"
					onclick={() => {
						tab = item.id as typeof tab;
						selectedRun = '';
					}}>{item.label}</Button
				>{/each}
			<Button size="sm" variant="ghost" href="/workflows/connections"
				>{m.workflows_connections()}</Button
			>
		</div>{/snippet}
	<div class="space-y-6">
		{#if repostsQuery.error}<InlineNotice tone="error" message={String(repostsQuery.error)} />{/if}
		{#if error || workflowsQuery.error}<InlineNotice
				tone="error"
				message={error || String(workflowsQuery.error)}
			/>{/if}
		{#if tab === 'workflows'}
			{#if workflowsQuery.data?.length || repostsQuery.data?.policies?.length}<div
					class="divide-y rounded-lg border bg-card"
				>
					{#each workflowsQuery.data ?? [] as workflow (workflow.id)}<div class="flex items-center">
							<a
								href={`/workflows/${workflow.id}`}
								class="flex min-h-24 min-w-0 flex-1 items-center gap-4 p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
								><span class="hidden w-48 shrink-0 sm:block"
									><GraphPreview definition={workflow.definition} /></span
								><span class="min-w-0 flex-1"
									><span class="block truncate font-medium">{workflow.name}</span><span
										class="mt-1 block text-sm text-muted-foreground"
										>{sourceLabel(workflow.definition.source.kind)}</span
									>{#if workflow.source_error}<span class="mt-1 block text-xs text-destructive"
											>{m.workflows_source_error()}</span
										>{/if}</span
								><span class="text-xs text-muted-foreground"
									>{workflow.enabled
										? m.workflows_active()
										: workflow.published_revision
											? m.workflows_paused()
											: m.workflows_draft()}</span
								><ThemeIcon role="chevron-right" class="size-4 shrink-0" /></a
							>
							{#if workspaceCtx.currentWorkspace?.role === 'admin'}<Button
									variant="ghost"
									size="icon-sm"
									class="mr-3"
									disabled={workflow.enabled}
									aria-label={`${m.common_delete()}: ${workflow.name}`}
									onclick={() => {
										deleting = workflow;
										deleteOpen = true;
									}}><ThemeIcon role="delete" class="size-4" /></Button
								>{/if}
						</div>{/each}
					{#each repostsQuery.data?.policies ?? [] as policy (policy.id)}
						<a
							href={`/workflows/reposts?policy=${policy.id}`}
							class="flex min-h-24 min-w-0 items-center gap-4 p-4 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
						>
							<span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
								><ThemeIcon role="repeat" class="size-5" /></span
							>
							<span class="min-w-0 flex-1"
								><span class="block truncate font-medium">{policy.name}</span><span
									class="mt-1 block text-sm text-muted-foreground">{m.repost_heading()}</span
								></span
							>
							<span class="text-xs text-muted-foreground"
								>{policy.enabled ? m.workflows_active() : m.workflows_paused()}</span
							><ThemeIcon role="chevron-right" class="size-4 shrink-0" />
						</a>
					{/each}
				</div>
			{:else if !workflowsQuery.error}<EmptyState
					themeIconRole="repeat"
					title={m.workflows_no_workflows()}
					description={m.workflows_no_workflows_help()}
					actionLabel={m.workflows_templates()}
					onAction={() => (tab = 'templates')}
				/>{/if}
			<Button variant="ghost" href="/workflows/reposts">{m.repost_heading()}</Button>
		{:else if tab === 'templates'}
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each templates() as template (template.id)}<div
						class="flex flex-col items-start gap-4 rounded-lg border bg-card p-4"
					>
						<GraphPreview definition={template.definition} />
						<div class="min-w-0 flex-1">
							<h2 class="font-medium">{template.name}</h2>
							<p class="mt-2 text-sm leading-6 text-muted-foreground">{template.description}</p>
						</div>
						<Button
							variant="outline"
							disabled={busy || workspaceCtx.currentWorkspace?.role === 'viewer'}
							onclick={() => create(template.name, template.definition)}
							>{m.workflows_use_template()}</Button
						>
					</div>{/each}
				{#each [{ id: 'repost', name: m.repost_new_rule(), description: m.repost_delay_days( { count: 1 } ) }, { id: 'cycle', name: m.workflows_repost_cycle(), description: `${m.repost_delay_days({ count: 1 })} · ${m.repost_delay_days({ count: 3 })}` }, { id: 'popular', name: m.workflows_repost_popular(), description: m.repost_engagement_gates_body() }] as template (template.id)}
					<div class="flex flex-col items-start gap-4 rounded-lg border bg-card p-4">
						<div class="min-w-0 flex-1">
							<h2 class="font-medium">{template.name}</h2>
							<p class="mt-2 text-sm leading-6 text-muted-foreground">{template.description}</p>
						</div>
						<Button
							href={`/workflows/reposts?template=${template.id}`}
							variant="outline"
							disabled={workspaceCtx.currentWorkspace?.role !== 'admin'}
							>{m.workflows_use_template()}</Button
						>
					</div>
				{/each}
			</div>
		{:else if selectedRun}<Button variant="ghost" onclick={() => (selectedRun = '')}
				><ThemeIcon role="arrow-left" class="size-4" />{m.workflows_runs()}</Button
			><RunInspector {workspaceID} runID={selectedRun} />
		{:else}
			<details class="rounded-lg border p-4">
				<summary class="min-h-11 cursor-pointer text-sm font-medium">{m.repost_heading()}</summary
				><RepostHistory {workspaceID} />
			</details>
			{#if runsQuery.error}<InlineNotice tone="error" message={String(runsQuery.error)} />{/if}
			<div class="divide-y rounded-lg border bg-card">
				{#each runsQuery.data ?? [] as run (run.id)}<button
						type="button"
						class="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
						onclick={() => (selectedRun = run.id)}
						><span class="hidden w-48 shrink-0 sm:block"
							><GraphPreview definition={run.definition} {run} /></span
						><span class="min-w-0 flex-1"
							><span class="block truncate text-sm font-medium">{run.workflow_name}</span><span
								class="mt-1 block text-xs text-muted-foreground"
								>{new Date(run.created_at).toLocaleString()} · {run.mode === 'preview'
									? m.workflows_preview()
									: run.mode === 'test'
										? m.workflows_test_node()
										: m.workflows_live()}</span
							></span
						><span class="text-sm">{runStateLabel(run.state)}</span></button
					>{/each}
			</div>
			{#if !runsQuery.data?.length && !runsQuery.isPending}<EmptyState
					themeIconRole="history"
					title={m.workflows_no_runs()}
					description={m.workflows_no_runs_help()}
				/>{/if}
		{/if}
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteOpen}
	title={`${m.common_delete()}: ${deleting?.name ?? ''}`}
	description={m.workflows_delete_help()}
	onConfirm={async () => {
		if (!deleting) return { ok: false };
		await deleteWorkflow(workspaceID, deleting.id);
		return { ok: true };
	}}
/>
