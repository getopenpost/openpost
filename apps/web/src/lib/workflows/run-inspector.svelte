<script lang="ts">
	import { z } from 'zod';
	import { untrack } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		workflowRunQueryOptions,
		publicationDetailQueryOptions,
		openPostQueryKeys
	} from '@openpost/query-catalog';
	import { queryClient } from '$lib/query/client';
	import { ui } from '$lib/stores/ui.svelte';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { queryAPI } from '$lib/query/api';
	import { approveRun, cancelRun } from './api';
	import { runStateLabel } from './catalog';
	import { Button } from '$lib/components/ui/button';
	import ApprovalContent from './approval-content.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	let { workspaceID, runID }: { workspaceID: string; runID: string } = $props();
	const usageSchema = z.object({ total_tokens: z.number(), cost_usd: z.number().nullish() });
	const canAdmin = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const runQuery = createQuery(() => ({
		...workflowRunQueryOptions(workflowQueryAPI, workspaceID, runID),
		refetchInterval: (query) =>
			query.state.data && ['succeeded', 'failed', 'cancelled'].includes(query.state.data.state)
				? false
				: 3000
	}));
	const run = $derived(runQuery.data);
	let refreshedRun = '';
	$effect(() => {
		if (
			!run ||
			run.mode !== 'live' ||
			run.workspace_id !== workspaceID ||
			workspaceCtx.currentWorkspace?.id !== workspaceID
		)
			return;
		const version = `${run.id}:${run.revision}`;
		if (version === refreshedRun) return;
		refreshedRun = version;
		untrack(() => {
			void queryClient.invalidateQueries({
				queryKey: openPostQueryKeys.publications.all(workspaceID),
				refetchType: 'none'
			});
			ui.invalidatePublications({ workspaceId: workspaceID });
		});
	});
	const approval = $derived(
		run?.steps?.find((step) => step.step_id === run.current_step_id && step.kind === 'approval')
	);
	const publicationID = $derived(
		run?.state === 'awaiting_approval' ? String(approval?.inputs?.publication_id ?? '') : ''
	);
	const publicationQuery = createQuery(() =>
		publicationDetailQueryOptions(queryAPI, workspaceID, publicationID, 'live')
	);
	let busy = $state(false),
		error = $state('');
	async function act(action: 'approve' | 'cancel') {
		if (!run) return;
		busy = true;
		error = '';
		try {
			if (action === 'approve' && publicationQuery.data)
				await approveRun(workspaceID, run, publicationQuery.data.revision);
			else if (action === 'cancel') await cancelRun(workspaceID, run);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-4" aria-live="polite">
	{#if error || runQuery.error}<InlineNotice
			tone="error"
			message={error || String(runQuery.error)}
		/>{/if}
	{#if run}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<p class="font-medium">{runStateLabel(run.state)}</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{m.workflows_run_revision({ revision: run.workflow_revision })} · {run.mode === 'preview'
						? m.workflows_preview()
						: run.mode === 'test'
							? m.workflows_test_node()
							: m.workflows_live()}
				</p>
			</div>
			{#if ['queued', 'running', 'waiting', 'awaiting_approval'].includes(run.state)}<Button
					variant="outline"
					disabled={!canAdmin || busy}
					onclick={() => act('cancel')}>{m.workflows_cancel_run()}</Button
				>{/if}
		</div>
		{#if run.mode === 'preview'}<InlineNotice
				tone="info"
				message={m.workflows_run_preview_notice()}
			/>{/if}
		{#if run.error}<InlineNotice tone="error" message={run.error} />{/if}
		{#if run.wake_at}<p class="text-sm text-muted-foreground">
				{m.workflows_waiting()}: {new Date(run.wake_at).toLocaleString()}
			</p>{/if}
		{#if publicationID}
			<section class="space-y-3 rounded-lg border bg-card p-4">
				<h3 class="text-sm font-medium">{m.workflows_approval()}</h3>
				{#if publicationQuery.error}<InlineNotice
						tone="error"
						message={String(publicationQuery.error)}
					/>{/if}
				{#if publicationQuery.data}
					<p class="text-xs text-muted-foreground">
						{m.workflows_post_revision_label({ revision: publicationQuery.data.revision })}
					</p>
					<ApprovalContent publication={publicationQuery.data} />
					<div class="flex flex-wrap gap-2">
						<Button variant="outline" href={`/publications/${publicationID}`}
							>{m.workflows_edit()}</Button
						><Button
							disabled={!canAdmin || busy || publicationQuery.data.status !== 'draft'}
							onclick={() => act('approve')}>{m.workflows_approve()}</Button
						>
					</div>
				{/if}
			</section>
		{/if}
		{#each run.steps ?? [] as step (step.step_id)}
			{@const usage = usageSchema.safeParse(step.output?.usage)}
			{@const postID =
				run.mode === 'live'
					? z
							.string()
							.catch('')
							.parse(
								step.kind === 'schedule'
									? step.inputs?.publication_id
									: step.kind === 'create_draft' || step.kind === 'build_draft'
										? step.output?.id
										: undefined
							)
					: ''}
			<details
				class="rounded-lg border bg-card p-3"
				open={step.state === 'failed' || step.state === 'awaiting_approval'}
			>
				<summary
					class="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:py-3"
					>{step.name}
					<span class="ml-2 font-normal text-muted-foreground">{runStateLabel(step.state)}</span
					></summary
				>
				{#if usage.success}<p class="mt-2 text-xs text-muted-foreground">
						{m.workflows_usage_tokens({
							count: usage.data.total_tokens
						})}{#if usage.data.cost_usd != null}
							· {m.workflows_usage_cost({ amount: usage.data.cost_usd.toFixed(6) })}{/if}
					</p>{/if}
				{#if step.error}<p class="mt-3 text-sm text-destructive">{step.error}</p>{/if}
				{#if postID}<Button
						class="mt-3"
						size="sm"
						variant="outline"
						href={`/publications/${encodeURIComponent(postID)}`}>{m.workflows_edit()}</Button
					>{/if}
				<div class="mt-3 space-y-3">
					{#each [{ label: m.workflows_inputs(), data: step.inputs }, { label: m.workflows_outputs(), data: step.output }] as item}<div
						>
							<h4 class="mb-1 text-xs font-medium text-muted-foreground">{item.label}</h4>
							<pre
								class="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">{JSON.stringify(
									item.data ?? {},
									null,
									2
								)}</pre>
						</div>{/each}
				</div>
			</details>
		{/each}
		{#if !run.steps?.length}<p class="text-sm text-muted-foreground">
				{m.workflows_no_step_data()}
			</p>{/if}
	{/if}
</div>
