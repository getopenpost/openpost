<script lang="ts">
	import { ContextMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { CalendarDate } from '@internationalized/date';
	import { tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client } from '$lib/api/client';
	import { prefetchDraftComposerData } from '$lib/api/performance-cache';
	import type { components } from '$lib/api/types';
	import { workspaceClock } from '$lib/components/compose/schedule-timezone';
	import { buildRollingCalendarWeeks } from '$lib/components/sidebar-rolling-calendar';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ui } from '$lib/stores/ui.svelte';
	import { publicationInvalidationForWorkspace } from '$lib/publication-invalidation';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { workspaceColor } from '$lib/workspace-color';
	import { requestDestructiveAction } from '$lib/destructive-action';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let { onNavigate }: { onNavigate: (href: string) => void } = $props();

	type Publication = components['schemas']['PublicationResponse'];
	type PlannerOverview = components['schemas']['ScheduleOverviewOutputBody'];
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

	let dayCounts = $state.raw(new SvelteMap<string, number>());
	let drafts = $state.raw<PlannerDraft[]>([]);
	let loadingDrafts = $state(true);
	let deleteDraftDialogOpen = $state(false);
	let draftPendingDelete = $state<PlannerDraft | null>(null);
	let deletingDraftId = $state('');
	let draftDeleteError = $state('');
	let overviewRequest = 0;
	let draftsRequest = 0;
	let overviewWorkspaceKey = '';
	let loadedOverviewMonths = new SvelteSet<string>();
	let pendingOverviewMonths = new SvelteSet<string>();
	let handledInvalidationRevision = 0;
	let draftsWorkspaceId = '';
	let renderedWeekCount = $state(12);
	let focusedDayKey = $state('');
	let visibleCalendarDayKey = $state('');
	const weeksPerBatch = 8;
	const calendarWeekHeight = 36;
	const draftContextItemClass =
		'flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45';

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const viewerTimeZone = $derived(workspaceCtx.settings.timezone || 'UTC');
	const plannerColor = $derived(
		workspaceCtx.currentWorkspace ? workspaceColor(workspaceCtx.currentWorkspace) : '#f97316'
	);
	const plannerToday = $derived(workspaceClock(viewerTimeZone).date);
	const rollingWeeks = $derived(
		buildRollingCalendarWeeks(plannerToday, workspaceCtx.weekStartsOn, renderedWeekCount)
	);
	const overviewMonthKeys = $derived(plannerOverviewMonths(rollingWeeks));
	const visibleCalendarDate = $derived(
		rollingWeeks.flat().find((day) => day.key === visibleCalendarDayKey)?.date ?? plannerToday
	);
	const visibleCalendarMonth = $derived(formatCalendarMonth(visibleCalendarDate));
	const keyboardFocusDayKey = $derived.by(() => {
		const focusedDay = rollingWeeks.flat().find((day) => day.key === focusedDayKey && !day.past);
		return focusedDay?.key ?? plannerToday.toString();
	});
	$effect(() => {
		const currentWorkspaceId = workspaceId;
		const workspaceKey = `${currentWorkspaceId}|${viewerTimeZone}`;
		const months = overviewMonthKeys;
		untrack(() => void loadOverviewMonths(currentWorkspaceId, workspaceKey, months));
	});

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
			if (invalidation.scopes.includes('calendar')) {
				const months =
					invalidation.dateKeys.length > 0
						? [...new Set(invalidation.dateKeys.map((dateKey) => dateKey.slice(0, 7)))]
						: overviewMonthKeys;
				void loadOverviewMonths(
					currentWorkspaceId,
					`${currentWorkspaceId}|${viewerTimeZone}`,
					[...new Set([...overviewMonthKeys, ...months])],
					months
				);
			}
			if (invalidation.scopes.includes('drafts')) void loadDrafts(currentWorkspaceId);
		});
	});

	async function loadOverviewMonths(
		currentWorkspaceId: string,
		workspaceKey: string,
		months: string[],
		invalidateMonths: string[] = []
	) {
		if (!currentWorkspaceId) {
			dayCounts = new SvelteMap();
			overviewWorkspaceKey = '';
			loadedOverviewMonths = new SvelteSet();
			pendingOverviewMonths = new SvelteSet();
			return;
		}
		if (overviewWorkspaceKey !== workspaceKey) {
			overviewRequest++;
			dayCounts = new SvelteMap();
			overviewWorkspaceKey = workspaceKey;
			loadedOverviewMonths = new SvelteSet();
			pendingOverviewMonths = new SvelteSet();
		}
		if (invalidateMonths.length > 0) {
			overviewRequest++;
			loadedOverviewMonths = new SvelteSet(
				[...loadedOverviewMonths].filter((month) => !invalidateMonths.includes(month))
			);
			pendingOverviewMonths = new SvelteSet();
		}
		const request = overviewRequest;
		const requestedMonths = months.filter(
			(month) => !loadedOverviewMonths.has(month) && !pendingOverviewMonths.has(month)
		);
		if (requestedMonths.length === 0) return;
		for (const month of requestedMonths) pendingOverviewMonths.add(month);
		try {
			const overviews = await Promise.all(
				requestedMonths.map(async (month): Promise<[string, PlannerOverview]> => {
					const { data, error } = await client.GET('/posts/schedule-overview', {
						params: { query: { workspace_id: currentWorkspaceId, month } }
					});
					if (error || !data) throw new Error(error?.detail);
					return [month, data];
				})
			);
			if (request !== overviewRequest || overviewWorkspaceKey !== workspaceKey) return;
			const nextCounts = new SvelteMap(dayCounts);
			for (const [month, overview] of overviews) {
				for (const dateKey of [...nextCounts.keys()]) {
					if (dateKey.startsWith(`${month}-`)) nextCounts.delete(dateKey);
				}
				for (const day of overview.days ?? []) nextCounts.set(day.date, day.count);
				loadedOverviewMonths.add(month);
			}
			dayCounts = nextCounts;
		} catch {
			// Keep the last successful planner state visible during a background refresh.
		} finally {
			if (request === overviewRequest) {
				for (const month of requestedMonths) pendingOverviewMonths.delete(month);
			}
		}
	}

	async function loadDrafts(currentWorkspaceId: string) {
		const request = ++draftsRequest;
		if (!currentWorkspaceId) {
			drafts = [];
			draftsWorkspaceId = '';
			loadingDrafts = false;
			return;
		}
		const workspaceChanged = draftsWorkspaceId !== currentWorkspaceId;
		if (workspaceChanged) {
			drafts = [];
			draftsWorkspaceId = currentWorkspaceId;
		}
		loadingDrafts = workspaceChanged || drafts.length === 0;

		try {
			const publicationResult = await client.GET('/publications', {
				params: {
					query: {
						workspace_id: currentWorkspaceId,
						status: 'draft',
						limit: 50,
						offset: 0
					}
				}
			});
			if (request !== draftsRequest) return;
			const publications = publicationResult.error ? [] : (publicationResult.data ?? []);
			drafts = publications
				.map(publicationDraft)
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		} catch {
			// A refresh failure must not replace useful drafts with an empty state.
		} finally {
			if (request === draftsRequest) loadingDrafts = false;
		}
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
		draftDeleteError = '';
		return requestDestructiveAction(event, () => (deleteDraftDialogOpen = true), deleteDraft);
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
			ui.triggerRefresh({
				workspaceId,
				scopes: ['activity', 'calendar', 'drafts']
			});
			if (page.url.pathname === draft.href) onNavigate('/');
		} catch (error) {
			draftDeleteError = error instanceof Error ? error.message : m.sidebar_delete_draft_failed();
			void loadDrafts(workspaceId);
		} finally {
			deletingDraftId = '';
			draftPendingDelete = null;
		}
	}

	function openPlannerDay(date: CalendarDate) {
		focusedDayKey = date.toString();
		ui.openDayPosts(date);
	}

	async function moveCalendarFocus(event: KeyboardEvent, date: CalendarDate) {
		const grid = (event.currentTarget as HTMLElement).closest('[role="grid"]');
		const days = rollingWeeks.flat();
		const currentIndex = days.findIndex((day) => day.key === date.toString());
		if (currentIndex < 0) return;

		let nextIndex: number;
		switch (event.key) {
			case 'ArrowLeft':
				nextIndex = currentIndex - 1;
				break;
			case 'ArrowRight':
				nextIndex = currentIndex + 1;
				break;
			case 'ArrowUp':
				nextIndex = currentIndex - 7;
				break;
			case 'ArrowDown':
				nextIndex = currentIndex + 7;
				break;
			case 'Home':
				nextIndex = currentIndex - (currentIndex % 7);
				break;
			case 'End':
				nextIndex = currentIndex + (6 - (currentIndex % 7));
				break;
			default:
				return;
		}

		event.preventDefault();
		nextIndex = Math.max(0, nextIndex);
		const todayIndex = days.findIndex((day) => day.today);
		if (todayIndex >= 0) nextIndex = Math.max(todayIndex, nextIndex);
		if (nextIndex >= days.length) {
			renderedWeekCount += weeksPerBatch;
			await tick();
		}

		const target = rollingWeeks.flat()[nextIndex];
		if (!target || target.past) return;
		focusedDayKey = target.key;
		await tick();
		grid?.querySelector<HTMLButtonElement>(`button[data-calendar-date="${target.key}"]`)?.focus();
	}

	function loadMoreWeeks(event: Event) {
		const calendar = event.currentTarget as HTMLElement;
		const visibleWeekIndex = Math.min(
			rollingWeeks.length - 1,
			Math.max(0, Math.floor((calendar.scrollTop + calendarWeekHeight / 2) / calendarWeekHeight))
		);
		const visibleWeek = rollingWeeks[visibleWeekIndex];
		visibleCalendarDayKey =
			visibleWeek?.find((day) => day.today)?.key ?? visibleWeek?.[3]?.key ?? '';

		const remaining = calendar.scrollHeight - calendar.scrollTop - calendar.clientHeight;
		if (remaining <= 72) renderedWeekCount += weeksPerBatch;
	}

	function formatCalendarMonth(date: CalendarDate) {
		return date.toDate(viewerTimeZone).toLocaleDateString(getLocaleTag(), {
			month: 'long',
			year: 'numeric',
			timeZone: viewerTimeZone
		});
	}

	function plannerOverviewMonths(weeks: ReturnType<typeof buildRollingCalendarWeeks>) {
		return [...new Set(weeks.flat().map((day) => day.key.slice(0, 7)))];
	}

	function formatWeekday(date: CalendarDate) {
		return date
			.toDate(viewerTimeZone)
			.toLocaleDateString(getLocaleTag(), { weekday: 'short', timeZone: viewerTimeZone })
			.slice(0, 2);
	}

	function formatDayLabel(date: CalendarDate) {
		return date.toDate(viewerTimeZone).toLocaleDateString(getLocaleTag(), {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			timeZone: viewerTimeZone
		});
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

<div class="flex min-h-0 flex-1 flex-col" data-testid="desktop-sidebar-planner">
	<section
		class="shrink-0 border-b border-sidebar-border px-2 pb-3"
		aria-label={m.sidebar_calendar()}
	>
		<div class="flex h-8 items-center justify-between px-2">
			<span
				class="truncate text-sm font-semibold text-sidebar-foreground/88"
				data-testid="sidebar-calendar-month"
			>
				{visibleCalendarMonth}
			</span>
			<button
				type="button"
				class="inline-flex h-7 items-center justify-center rounded-md px-2 text-xs text-sidebar-foreground/52 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				onclick={() => openPlannerDay(plannerToday)}
			>
				{m.common_today()}
			</button>
		</div>
		<div
			class="sidebar-calendar-scrollbar h-41 overflow-y-auto overscroll-contain select-none"
			data-testid="sidebar-rolling-calendar"
			onscroll={loadMoreWeeks}
		>
			<div role="grid" aria-label={m.calendar_label()} class="relative">
				<div
					role="row"
					class="sticky top-0 z-10 grid h-8 grid-cols-7 items-center bg-sidebar pt-1"
					data-testid="sidebar-calendar-weekdays"
				>
					{#each rollingWeeks[0] ?? [] as day (day.key)}
						<span
							role="columnheader"
							class="text-center text-xs font-normal text-sidebar-foreground/52"
						>
							{formatWeekday(day.date)}
						</span>
					{/each}
				</div>

				{#each rollingWeeks as week (week[0]?.key)}
					<div role="row" class="grid h-9 grid-cols-7 items-center">
						{#each week as day (day.key)}
							<div role="gridcell" class="flex items-center justify-center">
								<button
									type="button"
									data-calendar-date={day.key}
									class={[
										'relative inline-flex size-7 items-center justify-center rounded-md text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
										day.today
											? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
											: day.past
												? 'cursor-not-allowed text-sidebar-foreground/28'
												: 'text-sidebar-foreground/88 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
									]}
									disabled={day.past}
									tabindex={day.key === keyboardFocusDayKey ? 0 : -1}
									aria-label={formatDayLabel(day.date)}
									aria-current={day.today ? 'date' : undefined}
									onclick={() => openPlannerDay(day.date)}
									onfocus={() => (focusedDayKey = day.key)}
									onkeydown={(event) => void moveCalendarFocus(event, day.date)}
								>
									{day.date.day}
									{#if (dayCounts.get(day.key) ?? 0) > 0}
										<span
											class="pointer-events-none absolute bottom-0.5 size-1 rounded-full ring-1 ring-sidebar"
											style:background-color={plannerColor}
											aria-hidden="true"
										></span>
									{/if}
								</button>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</section>

	<section class="flex min-h-0 flex-1 flex-col px-2 pt-2">
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
										data-sveltekit-preload-code="eager"
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
											<span class="block truncate text-xs font-medium text-sidebar-foreground/88"
												>{draft.title}</span
											>
											<span
												class="flex items-center gap-1 text-[11px] leading-4 text-sidebar-foreground/45"
											>
												<span>{formatDraftTimestamp(draft.createdAt)}</span>
												{#if draft.isThread}
													<span aria-hidden="true">·</span>
													<span>{m.sidebar_thread_count({ count: draft.postCount })}</span>
												{/if}
											</span>
										</span>
										{#if draft.hasMedia}
											<ImageIcon
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
										<FileTextIcon class="size-4" />
										{m.sidebar_resume_draft_action()}
									</ContextMenu.Item>
									<ContextMenu.Separator class="my-1 h-px bg-border" />
									<ContextMenu.Item
										class="{draftContextItemClass} text-destructive data-highlighted:text-destructive"
										disabled={deletingDraftId === draft.id}
										onclick={(event) => requestDraftDelete(event, draft)}
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

<style>
	.sidebar-calendar-scrollbar,
	.sidebar-planner-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklch, var(--sidebar-foreground) 22%, transparent) transparent;
	}

	.sidebar-calendar-scrollbar::-webkit-scrollbar,
	.sidebar-planner-scrollbar::-webkit-scrollbar {
		width: 6px;
	}

	.sidebar-calendar-scrollbar::-webkit-scrollbar-track,
	.sidebar-planner-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}

	.sidebar-calendar-scrollbar::-webkit-scrollbar-button,
	.sidebar-planner-scrollbar::-webkit-scrollbar-button {
		display: none;
		width: 0;
		height: 0;
	}

	.sidebar-calendar-scrollbar::-webkit-scrollbar-thumb,
	.sidebar-planner-scrollbar::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background-color: color-mix(in oklch, var(--sidebar-foreground) 22%, transparent);
	}

	.sidebar-calendar-scrollbar::-webkit-scrollbar-thumb:hover,
	.sidebar-planner-scrollbar::-webkit-scrollbar-thumb:hover {
		background-color: color-mix(in oklch, var(--sidebar-foreground) 34%, transparent);
	}
</style>
