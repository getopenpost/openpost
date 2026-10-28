<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { commentAutomationQueryOptions, inboxQueryKeys } from '@openpost/query-catalog';
	import type { components } from '$lib/api/types';
	import { commentAutomationQueryAPI } from '$lib/query/comment-automation';
	import { queryClient } from '$lib/query/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { takeOverComment } from '$lib/workflows/api';
	import CommentReplyReview from '$lib/workflows/comment-reply-review.svelte';
	import InlineNotice from './inline-notice.svelte';
	import { Button } from './ui/button';
	import { m } from '$lib/paraglide/messages';
	let { item }: { item: components['schemas']['EngagementItem'] } = $props();
	let expanded = $state(false),
		busy = $state(false),
		error = $state('');
	const canAdmin = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const canEdit = $derived(['admin', 'editor'].includes(workspaceCtx.currentWorkspace?.role ?? ''));
	const replies = createQuery(() => ({
		...commentAutomationQueryOptions(commentAutomationQueryAPI, item.workspace_id, item.id),
		enabled: Boolean(expanded && item.automation_state),
		refetchInterval:
			expanded && ['sending', 'acknowledging', 'ready'].includes(item.automation_state ?? '')
				? 3000
				: false
	}));
	const stateLabel = $derived(
		item.automation_state === 'awaiting_review'
			? m.workflows_comment_pending()
			: item.automation_state === 'sent'
				? m.workflows_comment_sent()
				: item.automation_state === 'cancelled'
					? m.workflows_comment_stopped()
					: item.automation_state === 'needs_attention'
						? m.workflows_comment_attention()
						: item.automation_state === 'failed'
							? m.workflows_comment_failed()
							: item.automation_state === 'skipped'
								? m.workflows_comment_skipped()
								: m.workflows_comment_sending()
	);
	const link = $derived(
		'/workflows?template=' +
			(item.platform === 'instagram' ? 'instagram-playbook' : 'comment-resource') +
			'&account_id=' +
			encodeURIComponent(item.social_account_id) +
			(item.rendition_id
				? '&rendition_id=' + encodeURIComponent(item.rendition_id)
				: item.conversation_remote_id
					? '&post_id=' + encodeURIComponent(item.conversation_remote_id)
					: '')
	);
	async function takeOver() {
		const captured = item;
		busy = true;
		error = '';
		try {
			await takeOverComment(captured.workspace_id, captured.id);
			if (item.id === captured.id)
				await queryClient.invalidateQueries({
					queryKey: inboxQueryKeys.engagementRoot(captured.workspace_id)
				});
		} catch (cause) {
			if (item.id === captured.id)
				error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			if (item.id === captured.id) busy = false;
		}
	}
</script>

{#if item.kind === 'comment' && item.platform !== 'x'}
	<div class="mt-3 space-y-3">
		{#if item.automation_state}<details class="space-y-3" bind:open={expanded}>
				<summary class="min-h-11 cursor-pointer py-2 text-sm font-medium">{stateLabel}</summary
				>{#if expanded}{#if replies.isError}<InlineNotice
							tone="error"
							message={m.workflows_load_failed()}
						/>{/if}{#each replies.data ?? [] as reply (reply.id)}<CommentReplyReview
							{reply}
						/>{/each}{/if}
			</details>{/if}
		{#if error}<InlineNotice tone="error" message={error} />{/if}
		{#if canEdit}<div class="flex flex-wrap gap-2">
				{#if canAdmin}<Button variant="ghost" size="sm" href={link}
						>{m.workflows_comment_automate()}</Button
					>{/if}{#if item.automation_state && !['sent', 'failed', 'skipped', 'cancelled'].includes(item.automation_state)}<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={takeOver}>{m.workflows_comment_takeover()}</Button
					>{/if}
			</div>{/if}
	</div>
{/if}
