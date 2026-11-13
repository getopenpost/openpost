<script lang="ts" module>
	import type { components as Components } from '$lib/api/types';

	/** The Automations template that drafts replies for one comment's post. */
	export function commentAutomationLink(item: Components['schemas']['EngagementItem']): string {
		return (
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
	}

	export function canAutomateComment(item: Components['schemas']['EngagementItem']): boolean {
		return item.kind === 'comment' && item.platform !== 'x';
	}
</script>

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
	import Disclosure from '$lib/components/disclosure.svelte';
	let { item }: { item: components['schemas']['EngagementItem'] } = $props();
	let expanded = $state(false),
		busy = $state(false),
		error = $state('');
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

{#if canAutomateComment(item) && (item.automation_state || error)}
	<div class="mt-3 space-y-3">
		{#if item.automation_state}<Disclosure summary={stateLabel} bind:open={expanded}>
				{#if replies.isError}<InlineNotice
						tone="error"
						message={m.workflows_load_failed()}
					/>{/if}{#each replies.data ?? [] as reply (reply.id)}<CommentReplyReview {reply} />{/each}
			</Disclosure>{/if}
		{#if error}<InlineNotice tone="error" message={error} />{/if}
		{#if canEdit && item.automation_state && !['sent', 'failed', 'skipped', 'cancelled'].includes(item.automation_state)}<div
				class="flex flex-wrap gap-2"
			>
				<Button variant="outline" size="sm" disabled={busy} onclick={takeOver}
					>{m.workflows_comment_takeover()}</Button
				>
			</div>{/if}
	</div>
{/if}
