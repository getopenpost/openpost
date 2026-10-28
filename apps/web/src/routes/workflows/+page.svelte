<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		repostAutomationQueryOptions,
		workflowsQueryOptions,
		workflowRunSummariesQueryOptions,
		workflowRunQueryOptions,
		workspaceAccountsQueryOptions
	} from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { queryAPI } from '$lib/query/api';
	import { readQueryErrorMessage } from '$lib/query/error-message';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { saveWorkflow, deleteWorkflow, type Workflow, type Definition } from '$lib/workflows/api';
	import { templates, commentTemplates, sourceLabel, runStateLabel } from '$lib/workflows/catalog';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import RepostHistory from '$lib/workflows/repost-history.svelte';
	import GraphPreview from '$lib/workflows/graph-preview.svelte';
	import CommentCampaignSetup from '$lib/workflows/comment-campaign-setup.svelte';
	import RunInspector from '$lib/workflows/run-inspector.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	// An approval notification links straight to the run that is waiting, so the
	// page opens on that run instead of asking the reader to find it again. It is
	// derived rather than read once: clicking a second notification while this
	// page is already open is a same-route navigation, and a value captured at
	// mount would leave the reader on the run they first opened.
	const requestedRun = $derived(page.url.searchParams.get('run') ?? '');
	let replyTemplate = $state<{
		id: string;
		name: string;
		description: string;
		definition: Definition;
	} | null>(null);
	let handledTemplate = '';
	let deleting = $state<Workflow | null>(null),
		deleteOpen = $state(false);
	const requestedWorkspaceID = $derived(page.url.searchParams.get('workspace_id') ?? '');
	let selectedRunWorkspaceID = $state('');
	const workspaceLinkHandled = $derived(page.state.workflowApprovalLink === page.url.href);
	const workspaceLinkPending = $derived(Boolean(requestedWorkspaceID && !workspaceLinkHandled));
	const workspaceID = $derived(
		workspaceLinkPending && workspaceCtx.currentWorkspace?.id !== requestedWorkspaceID
			? ''
			: (workspaceCtx.currentWorkspace?.id ?? '')
	);
	let tab = $state<'workflows' | 'runs' | 'templates'>('workflows'),
		selectedRun = $state(''),
		repostHistoryOpen = $state(false),
		busy = $state(false),
		error = $state('');
	// A notification may point outside the currently selected workspace.
	// Select through the context owner before enabling any workspace-scoped reads.
	$effect(() => {
		const targetID = requestedWorkspaceID;
		const href = page.url.href;
		const workspaces = workspaceCtx.workspaces;
		if (!targetID || workspaceLinkHandled || workspaceCtx.loading || workspaces.length === 0)
			return;
		const target = workspaces.find((workspace) => workspace.id === targetID);
		if (!target) {
			error = m.workflows_load_failed();
			return;
		}
		untrack(() => {
			// The layout remounts this route when workspace access changes.
			// History state keeps the link handled across that remount, while a new
			// notification navigation starts with fresh page state.
			replaceState(page.url, { ...page.state, workflowApprovalLink: href });
			if (workspaceCtx.currentWorkspace?.id === targetID) return;
			void workspaceCtx
				.setWorkspace(target, () => page.url.href === href)
				.then((selected) => {
					if (page.url.href === href) {
						error = selected ? '' : m.workflows_load_failed();
					}
				})
				.catch((cause) => {
					if (page.url.href === href)
						error = cause instanceof Error ? cause.message : m.workflows_load_failed();
				});
		});
	});
	$effect(() => {
		const requested = page.url.searchParams.get('template') ?? '';
		if (!requested || handledTemplate === page.url.href) return;
		const template = commentTemplates().find((item) => item.id === requested);
		if (!template) return;
		handledTemplate = page.url.href;
		const source = template.definition.source;
		const account = page.url.searchParams.get('account_id');
		const rendition = page.url.searchParams.get('rendition_id');
		const post = page.url.searchParams.get('post_id');
		if (account) source.account_ids = [account];
		if (rendition) {
			source.rendition_ids = [rendition];
			source.post_scope = 'selected';
		} else if (post) {
			source.post_ids = [post];
			source.post_scope = 'selected';
		}
		replyTemplate = template;
		tab = 'templates';
	});
	const accountsQuery = createQuery(() => ({
		...workspaceAccountsQueryOptions(queryAPI, workspaceID),
		enabled: Boolean(
			workspaceID && ((tab === 'runs' && selectedRun) || (tab === 'templates' && replyTemplate))
		)
	}));
	const workflowsQuery = createQuery(() => ({
		...workflowsQueryOptions(workflowQueryAPI, workspaceID),
		enabled: Boolean(workspaceID && tab !== 'templates')
	}));
	const repostsQuery = createQuery(() => ({
		...repostAutomationQueryOptions(schedulingQueryAPI, workspaceID),
		enabled: Boolean(workspaceID && tab === 'workflows')
	}));
	const runsQuery = createQuery(() => ({
		...workflowRunSummariesQueryOptions(workflowQueryAPI, workspaceID),
		enabled: Boolean(workspaceID && tab === 'runs' && !selectedRun)
	}));
	$effect(() => {
		if (!requestedRun) return;
		if (requestedWorkspaceID && workspaceLinkHandled && workspaceID !== requestedWorkspaceID) {
			selectedRun = '';
			return;
		}
		selectedRun = requestedRun;
		selectedRunWorkspaceID =
			requestedWorkspaceID || untrack(() => workspaceCtx.currentWorkspace?.id ?? '');
		tab = 'runs';
	});
	$effect(() => {
		if (
			!workspaceLinkPending &&
			workspaceID &&
			selectedRunWorkspaceID &&
			workspaceID !== selectedRunWorkspaceID
		) {
			selectedRun = '';
			selectedRunWorkspaceID = workspaceID;
		}
	});
	// Start the snapshot alongside accounts, before the inspector can mount.
	const selectedRunQuery = createQuery(() =>
		workflowRunQueryOptions(
			workflowQueryAPI,
			workspaceID,
			tab === 'runs' && selectedRunWorkspaceID === workspaceID ? selectedRun : ''
		)
	);
	const visibleQueries = $derived(
		tab === 'workflows'
			? [workflowsQuery, repostsQuery]
			: tab === 'templates'
				? replyTemplate
					? [accountsQuery]
					: []
				: selectedRun
					? [accountsQuery, ...(selectedRunQuery.data ? [] : [selectedRunQuery])]
					: [runsQuery]
	);
	const loading = $derived(
		visibleQueries.map((query) => query.isPending && !query.error).some(Boolean)
	);
	let runList = $state<HTMLDivElement | null>(null);
	async function returnToRuns(event: MouseEvent) {
		const action = event.currentTarget;
		const ownedFocus = document.activeElement === action;
		const origin = selectedRun;
		const originWorkspace = workspaceID;
		selectedRun = '';
		await tick();
		if (!ownedFocus || !(action instanceof HTMLElement)) return;
		if (workspaceID !== originWorkspace || tab !== 'runs' || selectedRun) return;
		if (document.activeElement !== action && document.activeElement !== document.body) return;
		const card = runList?.querySelector<HTMLButtonElement>(`#workflow-run-${CSS.escape(origin)}`);
		(card ?? runList)?.focus();
	}
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

<svelte:head><title>{m.workflows_title()} · {appBranding.profile.display_name}</title></svelte:head>
<PageContainer
	title={m.workflows_title()}
	description={m.workflows_subtitle()}
	themeIconRole="repeat"
	loading={loading && !error}
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
		{#if error}<InlineNotice tone="error" message={error} />{/if}
		{#each visibleQueries.filter((query) => query.error) as query}<InlineNotice
				tone="error"
				message={readQueryErrorMessage(query.error) || m.workflows_load_failed()}
				>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => query.refetch()}
						>{m.common_retry()}</Button
					>{/snippet}</InlineNotice
			>{/each}
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
			{:else if workflowsQuery.isSuccess && repostsQuery.isSuccess}<EmptyState
					themeIconRole="repeat"
					title={m.workflows_no_workflows()}
					description={m.workflows_no_workflows_help()}
					actionLabel={m.workflows_templates()}
					onAction={() => (tab = 'templates')}
				/>{/if}
			<Button variant="ghost" href="/workflows/reposts">{m.repost_heading()}</Button>
		{:else if tab === 'templates'}
			{#if replyTemplate}{#key replyTemplate}<CommentCampaignSetup
						template={replyTemplate}
						accounts={accountsQuery.data ?? []}
						{workspaceID}
						{busy}
						onsubmit={create}
						onclose={() => (replyTemplate = null)}
					/>{/key}{:else}
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
								onclick={() => {
									if (template.definition.source.kind === 'comment_received')
										replyTemplate = template;
									else void create(template.name, template.definition);
								}}>{m.workflows_use_template()}</Button
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
			{/if}
		{:else if selectedRun}<Button variant="ghost" onclick={returnToRuns}
				><ThemeIcon role="arrow-left" class="size-4" />{m.workflows_runs()}</Button
			>
			{#if accountsQuery.data && selectedRunQuery.data}<RunInspector
					{workspaceID}
					runID={selectedRun}
					accounts={accountsQuery.data}
				/>{/if}
		{:else}
			<details class="rounded-lg border p-4" bind:open={repostHistoryOpen}>
				<summary class="min-h-11 cursor-pointer text-sm font-medium">{m.repost_heading()}</summary
				>{#if repostHistoryOpen}<RepostHistory {workspaceID} />{/if}
			</details>
			<div
				bind:this={runList}
				role="region"
				tabindex="-1"
				aria-label={m.workflows_runs()}
				class="focus-visible:outline-2 focus-visible:outline-ring {runsQuery.data?.length
					? 'divide-y rounded-lg border bg-card'
					: ''}"
			>
				{#each runsQuery.data ?? [] as run (run.id)}<button
						id={`workflow-run-${run.id}`}
						type="button"
						class="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
						onclick={() => {
							selectedRun = run.id;
							selectedRunWorkspaceID = workspaceID;
						}}
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
			{#if !runsQuery.data?.length && runsQuery.isSuccess}<EmptyState
					themeIconRole="history"
					title={m.workflows_no_runs()}
					description={workflowsQuery.data?.some((workflow) => workflow.enabled)
						? m.workflows_no_runs_active_help()
						: m.workflows_no_runs_help()}
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
