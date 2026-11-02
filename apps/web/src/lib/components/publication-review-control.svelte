<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		publicationReviewsQueryOptions,
		publicationReviewKeys,
		workspaceTeamQueryOptions,
		workspaceAccountsQueryOptions,
		type Publication
	} from '@openpost/query-catalog';
	import { publicationReviewQueryAPI } from '$lib/query/publication-reviews';
	import Disclosure from '$lib/components/disclosure.svelte';
	import { workspaceSettingsQueryAPI } from '$lib/query/workspace-settings';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import { client } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from './app-select.svelte';
	import InlineNotice from './inline-notice.svelte';
	import PublicationReviewPreview from './publication-review-preview.svelte';
	import { m } from '$lib/paraglide/messages';
	let {
		workspaceId,
		publicationId = '',
		reviewState = '',
		prepare,
		onChanged
	}: {
		workspaceId: string;
		publicationId?: string;
		reviewState?: string;
		prepare?: () => Promise<Publication>;
		onChanged: (post: Publication) => void | Promise<void>;
	} = $props();
	let open = $state(false),
		busy = $state(false),
		error = $state(''),
		reviewerId = $state(''),
		note = $state(''),
		feedback = $state('');
	let post = $state.raw<Publication>();
	const team = createQuery(() => workspaceTeamQueryOptions(workspaceSettingsQueryAPI, workspaceId));
	const accounts = createQuery(() => ({
		...workspaceAccountsQueryOptions(queryAPI, workspaceId),
		enabled: open
	}));
	const reviews = createQuery(() => ({
		...publicationReviewsQueryOptions(
			publicationReviewQueryAPI,
			workspaceId,
			post?.id ?? publicationId
		),
		enabled: open && Boolean(post?.id ?? publicationId)
	}));
	const clients = $derived(
		(team.data?.members ?? []).filter(
			(member) => member.role === 'client' && member.status === 'active'
		)
	);
	const canEdit = $derived(
		Boolean(
			workspaceCtx.currentWorkspace?.id === workspaceId && workspaceCtx.currentWorkspace.can_edit
		)
	);
	const latest = $derived(reviews.data?.[0]);
	const canDecide = $derived(
		latest?.current &&
			!latest.decision &&
			latest.reviewer_id === $auth.user?.id &&
			post?.review_state === 'pending'
	);
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});
	function scope() {
		const session = captureQueryMutationSession(),
			workspace = workspaceId,
			id = publicationId;
		return () =>
			!destroyed &&
			workspace === workspaceId &&
			(!id || id === publicationId) &&
			queryMutationSessionIsCurrent(session);
	}
	async function show() {
		const current = scope();
		busy = true;
		error = '';
		open = true;
		try {
			const next = prepare
				? await prepare()
				: await queryAPI.getPublication(workspaceId, publicationId, new AbortController().signal);
			if (current()) post = next;
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.review_failed();
		} finally {
			if (current()) busy = false;
		}
	}
	async function reconcile(id: string, current: () => boolean) {
		const next = await queryAPI.getPublication(workspaceId, id, new AbortController().signal);
		if (!current()) return;
		post = next;
		await onChanged(next);
		ui.invalidatePublications(
			{ workspaceId, scopes: ['activity', 'calendar', 'drafts'] },
			{ immediate: true }
		);
		await queryClient.invalidateQueries({ queryKey: publicationReviewKeys.list(workspaceId, id) });
	}
	async function send() {
		if (!post || busy || !reviewerId) return;
		const target = post,
			current = scope();
		busy = true;
		error = '';
		try {
			const result = await client.POST('/publications/{id}/reviews', {
				params: { path: { id: target.id } },
				body: { expected_revision: target.revision, reviewer_id: reviewerId, note }
			});
			if (result.error) throw new Error(result.error.detail || m.review_failed());
			await reconcile(target.id, current);
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.review_failed();
		} finally {
			if (current()) busy = false;
		}
	}
	async function decide(decision: 'approved' | 'changes_requested') {
		if (!post || !latest || !canDecide || busy) return;
		const target = post,
			request = latest,
			current = scope();
		busy = true;
		error = '';
		try {
			const result = await client.PUT('/publications/{id}/reviews/{review_id}', {
				params: { path: { id: target.id, review_id: request.id } },
				body: { expected_epoch: request.epoch, decision, feedback }
			});
			if (result.error) throw new Error(result.error.detail || m.review_failed());
			await reconcile(target.id, current);
		} catch (cause) {
			if (current()) error = cause instanceof Error ? cause.message : m.review_failed();
		} finally {
			if (current()) busy = false;
		}
	}
	function stateLabel(state: string) {
		return state === 'approved'
			? m.review_approved()
			: state === 'pending'
				? m.review_pending()
				: state === 'changes_requested'
					? m.review_changes_requested()
					: m.review_needs_review();
	}
</script>

{#if reviewState || (canEdit && workspaceCtx.currentWorkspace?.client_reviews_enabled && clients.length)}
	<Button type="button" variant="outline" size="sm" onclick={() => void show()}
		>{reviewState ? stateLabel(reviewState) : m.review_send()}</Button
	>
{/if}
<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
		<Dialog.Header
			><Dialog.Title>{m.review_title()}</Dialog.Title><Dialog.Description
				>{m.review_description()}</Dialog.Description
			></Dialog.Header
		>
		<div class="min-h-0 space-y-5 overflow-y-auto">
			{#if error || reviews.error}<InlineNotice
					tone="error"
					message={error || m.review_failed()}
				/><Button
					variant="outline"
					onclick={() => {
						void show();
						void reviews.refetch();
					}}
					disabled={busy}>{m.common_retry()}</Button
				>{/if}
			{#if busy && !post}<p role="status">{m.common_loading()}</p>{/if}
			{#if post}
				{#if post.review_state}<p class="font-medium" role="status">
						{stateLabel(post.review_state)}
					</p>{/if}
				{#if latest}
					{#if latest.note}<p class="text-sm whitespace-pre-wrap">{latest.note}</p>{/if}
					{#if latest.feedback}<p class="text-sm whitespace-pre-wrap">{latest.feedback}</p>{/if}
				{/if}
				{#if canDecide}
					<PublicationReviewPreview publication={latest!.snapshot} accounts={accounts.data ?? []} />
					<label class="grid gap-2 text-sm"
						>{m.review_feedback()}<Textarea
							bind:value={feedback}
							maxlength={4000}
							disabled={busy}
						/></label
					>
					<div class="flex flex-wrap gap-2">
						<Button
							onclick={() => void decide('approved')}
							disabled={busy || accounts.isPending || Boolean(accounts.error)}
							>{m.review_approve()}</Button
						><Button
							variant="outline"
							onclick={() => void decide('changes_requested')}
							disabled={busy || !feedback.trim()}>{m.review_request_changes()}</Button
						>
					</div>
				{:else if canEdit && workspaceCtx.currentWorkspace?.client_reviews_enabled && post.status === 'draft'}
					<AppSelect
						value={reviewerId}
						options={clients.map((member) => ({ value: member.user_id, label: member.email }))}
						onValueChange={(value) => (reviewerId = value)}
						ariaLabel={m.review_client()}
						placeholder={m.review_client()}
						disabled={busy}
					/>
					<label class="grid gap-2 text-sm"
						>{m.review_note()}<Textarea bind:value={note} maxlength={4000} disabled={busy} /></label
					>
					<PublicationReviewPreview publication={post} accounts={accounts.data ?? []} />
					<Button onclick={() => void send()} disabled={busy || !reviewerId}
						>{m.review_send()}</Button
					>
				{:else if canEdit && post.status === 'scheduled'}<p class="text-sm">
						{m.review_cancel_schedule()}
					</p>{/if}
				{#if (reviews.data?.length ?? 0) > 0}<Disclosure summary={m.review_history()}>
						<div class="mt-3 grid gap-4">
							{#each reviews.data ?? [] as review (review.id)}<article
									class="space-y-2 border-t pt-3"
								>
									<p class="text-sm">
										{new Date(review.created_at).toLocaleString()} · {review.decision
											? stateLabel(review.decision)
											: m.review_pending()}
									</p>
									{#if !review.current}<p class="text-xs text-muted-foreground">
											{m.review_previous_version()}
										</p>{/if}
									<p class="text-sm whitespace-pre-wrap">{review.feedback || review.note}</p>
									<Disclosure summary={m.review_submitted_version()}>
										<PublicationReviewPreview
											publication={review.snapshot}
											accounts={accounts.data ?? []}
										/>
									</Disclosure>
								</article>{/each}
						</div>
					</Disclosure>{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
