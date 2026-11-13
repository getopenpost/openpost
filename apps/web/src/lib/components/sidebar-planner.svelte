<script lang="ts">
	import { ContextMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { client } from '$lib/api/client';
	import {
		openPostQueryKeys,
		schedulingPublicationsQueryOptions,
		schedulingQueryKeys
	} from '@openpost/query-catalog';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import { prefetchDraftComposerData } from '$lib/api/performance-cache';
	import type { components } from '$lib/api/types';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { publicationView } from '$lib/stores/publication-view.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { publicationInvalidationForWorkspace } from '$lib/publication-invalidation';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { requestDestructiveAction } from '$lib/destructive-action';
	import { ThemeIcon } from '$lib/themes/icons';

	let { onNavigate }: { onNavigate: (href: string) => void } = $props();

	type Publication = components['schemas']['PublicationResponse'];
	type PlannerDraft = {
		id: string;
		revision: number;
		href: string;
		title: string;
		isThread: boolean;
		postCount: number;
		hasMedia: boolean;
		createdAt: string;
	};

	let drafts = $state.raw<PlannerDraft[]>([]);
	let loadingDrafts = $state(true);
	let draftsError = $state('');
	let draftsDataReady = $state(false);
	let deleteDraftDialogOpen = $state(false);
	let draftPendingDelete = $state<PlannerDraft | null>(null);
	let deletingDraftId = $state('');
	let draftDeleteReturnFocus = $state<HTMLElement | null>(null);
	let draftMutationSequence = 0;
	let draftsRequest = 0;
	let handledInvalidationRevision = 0;
	let draftsWorkspaceId = '';

	interface DraftDeleteView {
		readonly session: QueryMutationSession;
		readonly sequence: number;
		readonly workspaceId: string;
		readonly draft: PlannerDraft;
	}
	const draftContextItemClass =
		'flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45';

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	$effect(() => {
		const currentWorkspaceId = workspaceId;
		untrack(() => void loadDrafts(currentWorkspaceId));
	});

	$effect(() => {
		const batch = ui.publicationInvalidations;
		if (batch.revision === 0 || batch.revision === handledInvalidationRevision) return;
		handledInvalidationRevision = batch.revision;
		untrack(() => {
			const currentWorkspaceId = workspaceId;
			if (!currentWorkspaceId) return;
			const invalidation = publicationInvalidationForWorkspace(batch, currentWorkspaceId);
			if (!invalidation) return;
			if (invalidation.scopes.includes('drafts')) void loadDrafts(currentWorkspaceId, true);
		});
	});

	async function loadDrafts(currentWorkspaceId: string, force = false) {
		if (currentWorkspaceId !== workspaceId) return;
		const request = ++draftsRequest;
		if (!currentWorkspaceId) {
			drafts = [];
			draftsWorkspaceId = '';
			draftsError = '';
			draftsDataReady = false;
			loadingDrafts = false;
			return;
		}
		const workspaceChanged = draftsWorkspaceId !== currentWorkspaceId;
		if (workspaceChanged) {
			draftMutationSequence += 1;
			deleteDraftDialogOpen = false;
			draftPendingDelete = null;
			deletingDraftId = '';
			drafts = [];
			draftsWorkspaceId = currentWorkspaceId;
			draftsDataReady = false;
		}
		draftsError = '';
		loadingDrafts = true;

		try {
			const options = schedulingPublicationsQueryOptions(schedulingQueryAPI, currentWorkspaceId, {
				status: 'draft',
				limit: 50,
				allPages: true
			});
			const cached = queryClient.getQueryData<Publication[]>(options.queryKey);
			if (cached !== undefined && request === draftsRequest) {
				drafts = plannerDrafts(cached);
				draftsDataReady = true;
			}
			if (force) {
				await queryClient.invalidateQueries({
					queryKey: options.queryKey,
					exact: true,
					refetchType: 'none'
				});
			}
			const publications = await queryClient.query(options);
			if (request !== draftsRequest) return;
			drafts = plannerDrafts(publications);
			draftsDataReady = true;
		} catch (cause) {
			if (request !== draftsRequest) return;
			draftsError =
				cause instanceof Error && cause.message ? cause.message : m.sidebar_drafts_load_failed();
		} finally {
			if (request === draftsRequest) loadingDrafts = false;
		}
	}

	function plannerDrafts(publications: Publication[]) {
		return publications
			.map(publicationDraft)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	}

	function publicationDraft(publication: Publication): PlannerDraft {
		const segments = publication.segments ?? [];
		return {
			id: publication.id,
			revision: publication.revision,
			href: `/publications/${encodeURIComponent(publication.id)}`,
			title:
				publication.source_text.trim() ||
				publication.title.trim() ||
				m.calendar_untitled_publication(),
			isThread: publication.intent === 'thread',
			postCount: Math.max(1, segments.length),
			hasMedia:
				(publication.media?.length ?? 0) > 0 ||
				segments.some((segment) => (segment.media?.length ?? 0) > 0),
			createdAt: publication.created_at
		};
	}

	function requestDraftDelete(event: MouseEvent, draft: PlannerDraft) {
		draftPendingDelete = draft;
		void requestDestructiveAction(event, () => (deleteDraftDialogOpen = true), deleteDraft);
	}

	async function deleteDraft(): Promise<DestructiveActionOutcome> {
		const draft = draftPendingDelete;
		if (!draft || deletingDraftId) return { ok: false };
		const view: DraftDeleteView = {
			session: captureQueryMutationSession(),
			sequence: ++draftMutationSequence,
			workspaceId,
			draft
		};
		deletingDraftId = draft.id;
		try {
			const { error, response } = await client.DELETE('/publications/{id}', {
				params: {
					path: { id: view.draft.id },
					query: { confirm: true, expected_revision: view.draft.revision }
				}
			});
			settleQueryMutationSession(view.session, response);
			if (error) {
				if (!draftDeleteViewIsCurrent(view)) return { ok: false };
				throw new Error(error.detail || m.sidebar_delete_draft_failed());
			}

			const listKey = schedulingQueryKeys.publicationLists(view.workspaceId);
			const reconciled = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: listKey }],
				reconcile: () => {
					queryClient.setQueriesData<Publication[]>({ queryKey: listKey }, (current) =>
						current?.filter((publication) => publication.id !== view.draft.id)
					);
					queryClient.removeQueries({
						queryKey: openPostQueryKeys.publications.detail(view.workspaceId, view.draft.id),
						exact: true
					});
				},
				invalidate: [
					{
						queryKey: openPostQueryKeys.publications.list(view.workspaceId),
						refetchType: 'none'
					}
				]
			});
			if (!reconciled || !draftDeleteViewIsCurrent(view)) return { ok: false };
			drafts = drafts.filter((candidate) => candidate.id !== view.draft.id);
			ui.triggerRefresh({
				workspaceId: view.workspaceId,
				scopes: ['activity', 'calendar', 'drafts'],
				activities: ['draft']
			});
			if (page.url.pathname === view.draft.href) onNavigate('/');
			draftPendingDelete = null;
			return {
				ok: true,
				successMessage: m.sidebar_delete_draft_success(),
				returnFocus: draftDeleteReturnFocus
			};
		} catch (error) {
			if (!draftDeleteViewIsCurrent(view)) return { ok: false };
			return {
				ok: false,
				message: error instanceof Error ? error.message : m.sidebar_delete_draft_failed()
			};
		} finally {
			if (view.sequence === draftMutationSequence) deletingDraftId = '';
		}
	}

	function draftDeleteViewIsCurrent(view: DraftDeleteView): boolean {
		return (
			view.sequence === draftMutationSequence &&
			view.workspaceId === workspaceId &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function formatDraftTimestamp(value: string) {
		const timestamp = new Date(value);
		const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / 1000));
		const relative = new Intl.RelativeTimeFormat(getLocaleTag(), { numeric: 'auto' });
		if (elapsedSeconds < 60) return relative.format(0, 'minute');
		if (elapsedSeconds < 3600) return relative.format(-Math.round(elapsedSeconds / 60), 'minute');
		if (elapsedSeconds < 86400) return relative.format(-Math.round(elapsedSeconds / 3600), 'hour');
		if (elapsedSeconds < 604800) return relative.format(-Math.round(elapsedSeconds / 86400), 'day');
		return timestamp.toLocaleDateString(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			year: timestamp.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
		});
	}
</script>

{#if loadingDrafts || drafts.length > 0 || draftsError}
	<!-- Fits the header and one whole draft row before the sidebar scrolls. -->
	<div class="flex min-h-24 flex-1 flex-col overflow-hidden" data-testid="desktop-sidebar-planner">
		<section class="flex min-h-0 flex-1 flex-col pt-2">
			<div class="mb-1 flex h-7 shrink-0 items-center justify-between px-2">
				<div class="flex items-center gap-1.5">
					<span
						bind:this={draftDeleteReturnFocus}
						tabindex="-1"
						class="text-xs font-medium text-sidebar-foreground/70 outline-none"
						>{m.sidebar_drafts()}</span
					>
				</div>
				<button
					type="button"
					class="rounded-sm px-1.5 py-1 text-xs font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
					onclick={() =>
						onNavigate(
							publicationView.current === 'grid'
								? '/publications?tab=drafts&view=grid'
								: '/publications?tab=drafts'
						)}
				>
					{m.sidebar_view_all()}
				</button>
			</div>

			{#if draftsError}
				<InlineNotice tone="error" message={draftsError} class="mx-1 mb-1">
					{#snippet actions()}
						<button
							type="button"
							class="min-h-9 rounded-md px-2 text-xs font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
							onclick={() => void loadDrafts(workspaceId, true)}
						>
							{m.common_retry()}
						</button>
					{/snippet}
				</InlineNotice>
			{/if}

			{#if loadingDrafts && !draftsDataReady}
				<div class="space-y-1 px-1 py-1" role="status" aria-label={m.sidebar_drafts_loading()}>
					{#each [1, 2, 3] as placeholder (placeholder)}
						<div class="flex h-9 items-center gap-2 px-1.5">
							<Skeleton class="size-6 rounded-md" />
							<Skeleton class="h-3 flex-1" />
						</div>
					{/each}
				</div>
			{:else if drafts.length > 0}
				<ul
					class="sidebar-planner-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1"
					data-testid="sidebar-draft-list"
				>
					{#each drafts as draft (draft.id)}
						{@const activeDraft = page.url.pathname === draft.href}
						<li>
							<ContextMenu.Root>
								<ContextMenu.Trigger>
									{#snippet child({ props })}
										<a
											{...props}
											href={resolve(draft.href as '/')}
											class={[
												'group/draft flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
												activeDraft && 'bg-sidebar-accent/60'
											]}
											onpointerenter={() => prefetchDraftComposerData(draft.id, workspaceId)}
											onpointerdown={() => prefetchDraftComposerData(draft.id, workspaceId)}
											onfocus={() => prefetchDraftComposerData(draft.id, workspaceId)}
											aria-label={m.sidebar_resume_draft({ title: draft.title })}
											aria-current={activeDraft ? 'page' : undefined}
										>
											<span class="min-w-0 flex-1">
												<span
													class="block truncate text-xs leading-5 font-medium text-sidebar-foreground/88"
													>{draft.title}</span
												>
												<span
													class="flex items-center gap-1 text-xs leading-4 text-sidebar-foreground/70"
												>
													<span>{formatDraftTimestamp(draft.createdAt)}</span>
													{#if draft.isThread}
														<span aria-hidden="true">·</span>
														<span>{m.sidebar_thread_count({ count: draft.postCount })}</span>
													{/if}
												</span>
											</span>
											{#if draft.hasMedia}
												<ThemeIcon
													role="image"
													class="size-3 shrink-0 text-sidebar-foreground/38"
													aria-label={m.sidebar_has_media()}
												/>
											{/if}
										</a>
									{/snippet}
								</ContextMenu.Trigger>
								<ContextMenu.Portal>
									<ContextMenu.Content
										class="z-50 min-w-48 rounded-lg bg-popover/95 p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
									>
										<ContextMenu.Item
											class={draftContextItemClass}
											onclick={() => onNavigate(draft.href)}
										>
											<ThemeIcon role="file" class="size-4" />
											{m.sidebar_resume_draft_action()}
										</ContextMenu.Item>
										<ContextMenu.Separator class="my-1 h-px bg-border" />
										<ContextMenu.Item
											class="{draftContextItemClass} text-destructive data-highlighted:text-destructive"
											disabled={deletingDraftId === draft.id}
											onclick={(event) => requestDraftDelete(event, draft)}
										>
											<ThemeIcon role="delete" class="size-4" aria-hidden="true" />
											{m.common_delete()}
										</ContextMenu.Item>
									</ContextMenu.Content>
								</ContextMenu.Portal>
							</ContextMenu.Root>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
{/if}

<DestructiveConfirmDialog
	bind:open={deleteDraftDialogOpen}
	title={m.sidebar_delete_draft_confirm()}
	description={m.compose_delete_draft_body()}
	onConfirm={deleteDraft}
/>

<style>
	.sidebar-planner-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklch, var(--sidebar-foreground) 22%, transparent) transparent;
	}

	.sidebar-planner-scrollbar::-webkit-scrollbar {
		width: 6px;
	}

	.sidebar-planner-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}

	.sidebar-planner-scrollbar::-webkit-scrollbar-button {
		display: none;
		width: 0;
		height: 0;
	}

	.sidebar-planner-scrollbar::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background-color: color-mix(in oklch, var(--sidebar-foreground) 22%, transparent);
	}

	@media (hover: hover) and (pointer: fine) {
		.sidebar-planner-scrollbar::-webkit-scrollbar-thumb:hover {
			background-color: color-mix(in oklch, var(--sidebar-foreground) 34%, transparent);
		}
	}
</style>
