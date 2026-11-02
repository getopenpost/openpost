<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { repostAutomationQueryOptions } from '@openpost/query-catalog';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import Disclosure from '$lib/components/disclosure.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	let { workspaceID }: { workspaceID: string } = $props();
	const query = createQuery(() => ({
		...repostAutomationQueryOptions(schedulingQueryAPI, workspaceID),
		refetchInterval: 15000
	}));
	function status(value: string): string {
		return value === 'pending'
			? m.workflows_waiting()
			: value === 'ready'
				? m.workflows_queued()
				: value === 'succeeded'
					? m.workflows_succeeded()
					: value === 'failed'
						? m.workflows_failed()
						: m.workflows_skipped();
	}
</script>

{#if query.error}<InlineNotice tone="error" message={String(query.error)} />
{:else if query.isPending}<PageLoading layout="list" items={3} />
{:else if !query.data?.executions?.length}<EmptyState
		themeIconRole="history"
		title={m.workflows_no_runs()}
		description={m.repost_description()}
	/>
{:else}
	<div class="divide-y rounded-lg border bg-card">
		{#each query.data.executions as run (run.id)}
			<Disclosure class="p-4" summary={run.policy_name || m.composer_repost_custom()}>
				{#snippet summaryEnd()}
					<span class="flex flex-col items-end text-xs font-normal text-muted-foreground">
						<span>{status(run.status)} · {run.current_stage}/{run.total_stages}</span>
						<span>{new Date(run.created_at).toLocaleString()}</span>
					</span>
				{/snippet}
				<div class="mt-3 space-y-3 text-sm">
					<p>
						{query.data.accounts?.find((account) => account.id === run.target_account_id)
							?.username || run.target_account_id}
					</p>
					{#if run.next_check_at && (run.status === 'pending' || run.status === 'ready')}<p>
							{m.workflows_waiting()}: {new Date(run.next_check_at).toLocaleString()}
						</p>{/if}
					{#if run.error}<InlineNotice
							tone={run.status === 'failed' ? 'error' : 'info'}
							message={run.error}
						/>{/if}
					{#each run.history ?? [] as stage}<p>
							{stage.stage}/{run.total_stages} · {new Date(
								stage.executed_at
							).toLocaleString()}{#if stage.external_url}
								· <a
									class="underline underline-offset-4"
									href={stage.external_url}
									target="_blank"
									rel="noopener noreferrer">{m.workflows_review_post()}</a
								>{/if}
						</p>{/each}
					<Button variant="outline" href={`/publications/${run.publication_id}`}
						>{m.workflows_review_post()}</Button
					>
					<Disclosure
						summary={m.workflows_details()}
						summaryClass="text-xs font-normal text-muted-foreground"
					>
						<pre class="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(
								{ rule: run.rule, history: run.history },
								null,
								2
							)}</pre>
					</Disclosure>
				</div>
			</Disclosure>
		{/each}
	</div>
{/if}
