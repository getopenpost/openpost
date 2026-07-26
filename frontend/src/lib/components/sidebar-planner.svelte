<script lang="ts">
	import { ContextMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { getLocalTimeZone, today, type DateValue } from '@internationalized/date';
	import { SvelteMap } from 'svelte/reactivity';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceDateKeyFromISO } from '$lib/components/compose/schedule-timezone';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import * as CalendarUi from '$lib/components/ui/calendar';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ui } from '$lib/stores/ui.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import FileTextIcon from 'lucide-svelte/icons/file-text';
	import ImageIcon from 'lucide-svelte/icons/image';
	import MaximizeIcon from 'lucide-svelte/icons/maximize-2';
	import TrashIcon from 'lucide-svelte/icons/trash-2';

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

	let selectedDate = $state<DateValue | undefined>(undefined);
	let calendarPlaceholder = $state<DateValue>(today(getLocalTimeZone()));
	let dayCounts = $state.raw(new SvelteMap<string, number>());
	let drafts = $state.raw<PlannerDraft[]>([]);
	let loadingDrafts = $state(true);
	let deleteDraftDialogOpen = $state(false);
	let draftPendingDelete = $state<PlannerDraft | null>(null);
	let deletingDraftId = $state('');
	let draftDeleteError = $state('');
	let overviewRequest = 0;
	let draftsRequest = 0;
	const draftContextItemClass =
		'flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45';

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const monthString = $derived.by(() => {
		const date = calendarPlaceholder.toDate(getLocalTimeZone());
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
	});
	$effect(() => {
		const currentWorkspaceId = workspaceId;
		const currentMonth = monthString;
		const refresh = ui.refreshCounter;
		void refresh;
		void loadOverview(currentWorkspaceId, currentMonth);
	});

	$effect(() => {
		const currentWorkspaceId = workspaceId;
		const refresh = ui.refreshCounter;
		void refresh;
		void loadDrafts(currentWorkspaceId);
	});

	async function loadOverview(currentWorkspaceId: string, month: string) {
		const request = ++overviewRequest;
		if (!currentWorkspaceId) {
			dayCounts = new SvelteMap();
			return;
		}
		try {
			const publications: Publication[] = [];
			let offset = 0;
			while (true) {
				const { data, error, response } = await client.GET('/publications', {
					params: {
						query: {
							workspace_id: currentWorkspaceId,
							status: 'scheduled',
							limit: 200,
							offset
						}
					}
				});
				if (error) throw new Error(error.detail);
				publications.push(...(data ?? []));
				if (response.headers.get('X-Has-More') !== 'true') break;
				const nextOffset = Number(response.headers.get('X-Next-Offset') ?? offset + 200);
				if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
				offset = nextOffset;
			}
			if (request !== overviewRequest) return;
			const nextCounts = new SvelteMap<string, number>();
			for (const publication of publications) {
				if (!publication.scheduled_at) continue;
				const key = workspaceDateKeyFromISO(
					publication.scheduled_at,
					workspaceCtx.settings.timezone || 'UTC'
				);
				if (!key?.startsWith(month)) continue;
				nextCounts.set(key, (nextCounts.get(key) ?? 0) + 1);
			}
			dayCounts = nextCounts;
		} catch {
			if (request === overviewRequest) dayCounts = new SvelteMap();
		}
	}

	async function loadDrafts(currentWorkspaceId: string) {
		const request = ++draftsRequest;
		loadingDrafts = true;
		if (!currentWorkspaceId) {
			drafts = [];
			loadingDrafts = false;
			return;
		}

		try {
			const publicationResult = await client.GET('/publications', {
				params: {
					query: {
						workspace_id: currentWorkspaceId,
						status: 'draft',
						limit: 8,
						offset: 0
					}
				}
			});
			if (request !== draftsRequest) return;
			const publications = publicationResult.error ? [] : (publicationResult.data ?? []);
			drafts = publications
				.map(publicationDraft)
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
				.slice(0, 8);
		} catch {
			if (request === draftsRequest) drafts = [];
		} finally {
			if (request === draftsRequest) loadingDrafts = false;
		}
	}

	function publicationDraft(publication: Publication): PlannerDraft {
		const segments = publication.segments ?? [];
		return {
			id: publication.id,
			revision: publication.revision,
			href:
				(publication.intent === 'post' || publication.intent === 'thread') &&
				publication.text_post_id
					? `/posts/${encodeURIComponent(publication.text_post_id)}`
					: `/publications/${encodeURIComponent(publication.id)}`,
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

	function requestDraftDelete(draft: PlannerDraft) {
		draftPendingDelete = draft;
		draftDeleteError = '';
		deleteDraftDialogOpen = true;
	}

	async function deleteDraft() {
		const draft = draftPendingDelete;
		if (!draft || deletingDraftId) return;
		deletingDraftId = draft.id;
		draftDeleteError = '';
		try {
			const { error } = await client.DELETE('/publications/{id}', {
				params: {
					path: { id: draft.id },
					query: { confirm: true, expected_revision: draft.revision }
				}
			});
			if (error) {
				throw new Error(error.detail || m.sidebar_delete_draft_failed());
			}

			drafts = drafts.filter((candidate) => candidate.id !== draft.id);
			ui.triggerRefresh();
			if (page.url.pathname === draft.href) onNavigate('/');
		} catch (error) {
			draftDeleteError = error instanceof Error ? error.message : m.sidebar_delete_draft_failed();
			void loadDrafts(workspaceId);
		} finally {
			deletingDraftId = '';
			draftPendingDelete = null;
		}
	}

	function handleDateChange(date: DateValue | undefined) {
		selectedDate = undefined;
		if (date) ui.openDayPosts(date);
	}

	type DayMarkerArgs = { day: DateValue; outsideMonth: boolean };
</script>

{#snippet dayMarker({ day, outsideMonth }: DayMarkerArgs)}
	{@const count = dayCounts.get(day.toString()) ?? 0}
	<div class="relative flex size-(--cell-size) items-center justify-center">
		<CalendarUi.Day />
		{#if !outsideMonth && count > 0}
			<span
				class="pointer-events-none absolute bottom-0.5 size-1 rounded-full bg-primary ring-1 ring-sidebar"
				aria-hidden="true"
			></span>
		{/if}
	</div>
{/snippet}

{#snippet calendarAction()}
	<button
		type="button"
		class="relative z-10 inline-flex size-7 items-center justify-center rounded-md text-sidebar-foreground/52 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
		onclick={() => onNavigate('/calendar')}
		aria-label={m.sidebar_calendar()}
		title={m.sidebar_calendar()}
	>
		<MaximizeIcon class="size-3.5" />
	</button>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col" data-testid="desktop-sidebar-planner">
	<section class="shrink-0 border-b border-sidebar-border px-2 pb-3">
		<CalendarUi.Calendar
			type="single"
			bind:value={selectedDate}
			bind:placeholder={calendarPlaceholder}
			onValueChange={handleDateChange}
			day={dayMarker}
			captionAction={calendarAction}
			locale={getLocaleTag()}
			weekStartsOn={workspaceCtx.settings.week_start as 0 | 1 | 2 | 3 | 4 | 5 | 6}
			class="w-full bg-transparent p-0 select-none [--cell-size:1.75rem] [&_[role=gridcell]_[role=button][data-today]]:bg-sidebar-primary [&_[role=gridcell]_[role=button][data-today]]:text-sidebar-primary-foreground [&_tr]:justify-between"
		/>
	</section>

	<section class="flex min-h-0 flex-1 flex-col px-2 py-3">
		<div class="mb-1 flex h-7 shrink-0 items-center justify-between px-2">
			<div class="flex items-center gap-1.5">
				<span class="text-xs font-medium tracking-[0.1em] text-sidebar-foreground/52 uppercase"
					>{m.sidebar_drafts()}</span
				>
				{#if !loadingDrafts && drafts.length > 0}
					<span class="text-xs text-sidebar-foreground/38 tabular-nums">{drafts.length}</span>
				{/if}
			</div>
			<button
				type="button"
				class="rounded-sm px-1.5 py-1 text-xs font-medium text-sidebar-foreground/58 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				onclick={() => onNavigate('/activity?tab=drafts')}
			>
				{m.sidebar_view_all()}
			</button>
		</div>

		{#if loadingDrafts}
			<div class="space-y-1 px-1 py-1" aria-label={m.sidebar_drafts_loading()}>
				{#each [1, 2, 3] as placeholder (placeholder)}
					<div class="flex h-9 items-center gap-2 px-1.5">
						<Skeleton class="size-6 rounded-md" />
						<Skeleton class="h-3 flex-1" />
					</div>
				{/each}
			</div>
		{:else if drafts.length === 0}
			<button
				type="button"
				class="flex w-full items-start gap-2 rounded-md px-2 py-2.5 text-left hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				onclick={() => onNavigate('/')}
			>
				<FileTextIcon class="mt-0.5 size-3.5 shrink-0 text-sidebar-foreground/38" />
				<span class="text-xs leading-4 text-sidebar-foreground/52"
					>{m.sidebar_drafts_autosave_empty()}</span
				>
			</button>
		{:else}
			<ul class="min-h-0 flex-1 space-y-0.5 overflow-y-auto" data-testid="sidebar-draft-list">
				{#each drafts as draft (draft.id)}
					<li>
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="group/draft flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
										onclick={() => onNavigate(draft.href)}
										aria-label={m.sidebar_resume_draft({ title: draft.title })}
									>
										<span
											class="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/70 text-sidebar-foreground/58 group-hover/draft:text-sidebar-foreground"
										>
											<FileTextIcon class="size-3.5" />
										</span>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-xs font-medium text-sidebar-foreground/88"
												>{draft.title}</span
											>
											{#if draft.isThread}
												<span class="block text-xs leading-4 text-sidebar-foreground/45"
													>{m.sidebar_thread_count({ count: draft.postCount })}</span
												>
											{/if}
										</span>
										{#if draft.hasMedia}
											<ImageIcon
												class="size-3 shrink-0 text-sidebar-foreground/38"
												aria-label={m.sidebar_has_media()}
											/>
										{/if}
									</button>
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
										<FileTextIcon class="size-4" />
										{m.sidebar_resume_draft({ title: draft.title })}
									</ContextMenu.Item>
									<ContextMenu.Separator class="my-1 h-px bg-border" />
									<ContextMenu.Item
										class="{draftContextItemClass} text-destructive data-highlighted:text-destructive"
										disabled={deletingDraftId === draft.id}
										onclick={() => requestDraftDelete(draft)}
									>
										<TrashIcon class="size-4" aria-hidden="true" />
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

<DestructiveConfirmDialog
	bind:open={deleteDraftDialogOpen}
	title={m.sidebar_delete_draft_confirm()}
	description={m.compose_delete_draft_body()}
	onConfirm={deleteDraft}
/>

{#if draftDeleteError}
	<AppToast
		message={draftDeleteError}
		tone="error"
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (draftDeleteError = '')}
	/>
{/if}
