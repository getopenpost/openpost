<script lang="ts">
	import { untrack } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		workflowRunQueryOptions,
		inboxQueryKeys,
		type CommentAutomationReply
	} from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { queryClient } from '$lib/query/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { approveRun } from './api';
	import { m } from '$lib/paraglide/messages';
	let { reply }: { reply: CommentAutomationReply } = $props();
	let text = $state(untrack(() => reply.body)),
		busy = $state(false),
		error = $state('');
	const canAdmin = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const run = createQuery(() => ({
		...workflowRunQueryOptions(workflowQueryAPI, reply.workspace_id, reply.run_id),
		enabled: canAdmin && reply.state === 'awaiting_review'
	}));
	async function approve() {
		const captured = reply;
		const current = run.data;
		if (!current || workspaceCtx.currentWorkspace?.id !== captured.workspace_id) return;
		busy = true;
		error = '';
		try {
			await approveRun(captured.workspace_id, current, 0, text);
			if (reply.id === captured.id)
				await queryClient.invalidateQueries({
					queryKey: inboxQueryKeys.engagementRoot(captured.workspace_id)
				});
		} catch (cause) {
			if (reply.id === captured.id)
				error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			if (reply.id === captured.id) busy = false;
		}
	}
</script>

<div class="space-y-3 border-t pt-3">
	<p class="text-xs text-muted-foreground">
		{reply.channel === 'private' ? m.workflows_comment_private() : m.workflows_comment_public()}
	</p>
	{#if reply.state === 'awaiting_review'}<Label for={`reply-${reply.id}`}
			>{m.workflows_comment_saved()}</Label
		><Textarea id={`reply-${reply.id}`} bind:value={text} rows={4} /><Button
			disabled={!canAdmin || busy || !text.trim() || run.data?.state !== 'awaiting_approval'}
			onclick={approve}>{m.workflows_comment_approve()}</Button
		>
	{:else if reply.state !== 'needs_attention'}<p class="text-sm whitespace-pre-wrap" dir="auto">
			{reply.body}
		</p>{/if}
	{#if error}<InlineNotice tone="error" message={error} />{/if}
	<Button
		variant="outline"
		size="sm"
		href={`/workflows?run=${encodeURIComponent(reply.run_id)}&workspace_id=${encodeURIComponent(reply.workspace_id)}`}
		>{m.workflows_comment_open_run()}</Button
	>
</div>
