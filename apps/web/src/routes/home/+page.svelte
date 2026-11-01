<script lang="ts">
	import { createInfiniteQuery, createQuery } from '@tanstack/svelte-query';
	import { appBranding } from '$lib/app-branding.svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import GoingOutSection, {
		type GoingOutPost
	} from '$lib/components/home/going-out-section.svelte';
	import NeedsYouSection from '$lib/components/home/needs-you-section.svelte';
	import QuickActions from '$lib/components/home/quick-actions.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import WorkspaceSetupGuide from '$lib/components/workspace-setup-guide.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { queryGET } from '$lib/query/transport';
	import { client } from '$lib/api/client';
	import { queryAPI } from '$lib/query/api';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import { analyticsQueryAPI } from '$lib/query/analytics';
	import { m } from '$lib/paraglide/messages';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { workspaceClock } from '$lib/components/compose/schedule-timezone';
	import { publicationCalendarOccurrence } from '$lib/publication-calendar';
	import {
		analyticsOverviewQueryOptions,
		failedJobsQueryOptions,
		inboxSummaryQueryOptions,
		schedulingPublicationsQueryOptions,
		workspaceAccountsQueryOptions,
		type InboxSummary
	} from '@openpost/query-catalog';
	import { goto } from '$app/navigation';
	import { ui } from '$lib/stores/ui.svelte';
	import type { components } from '$lib/api/types';

	type Publication = components['schemas']['PublicationResponse'];

	const HORIZON_DAYS = 14;
	const GOING_OUT_LIMIT = 5;

	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const canEdit = $derived(workspaceCtx.currentWorkspace?.can_edit ?? false);
	const viewerTimeZone = $derived(
		workspaceCtx.settingsWorkspaceID === workspaceID
			? workspaceCtx.settings.timezone || 'UTC'
			: 'UTC'
	);

	// Day-granular so the query key stays stable between renders.
	const calendarFrom = $derived.by(() => {
		const clock = workspaceClock(viewerTimeZone);
		return clock.date.toDate(viewerTimeZone).toISOString();
	});
	const calendarBefore = $derived.by(() => {
		const clock = workspaceClock(viewerTimeZone);
		return clock.date.add({ days: HORIZON_DAYS }).toDate(viewerTimeZone).toISOString();
	});

	// The web inbox adapter owns engagement reads; the summary is a distinct read, so
	// this page injects its own transport into the shared catalog option.
	const inboxSummaryQueryAPI = {
		async getInboxSummary(workspaceId: string, signal: AbortSignal): Promise<InboxSummary> {
			const { data } = await queryGET({
				signal,
				fallback: m.home_load_failed(),
				request: (requestSignal) =>
					client.GET('/inbox/summary', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		}
	};

	const scheduledQuery = createQuery(() =>
		schedulingPublicationsQueryOptions(schedulingQueryAPI, workspaceID, {
			calendarFrom,
			calendarBefore,
			limit: 50
		})
	);
	const failedQuery = createQuery(() =>
		failedJobsQueryOptions(queryAPI, workspaceID, { limit: 5 })
	);
	const inboxQuery = createQuery(() => inboxSummaryQueryOptions(inboxSummaryQueryAPI, workspaceID));
	const accountsQuery = createQuery(() => workspaceAccountsQueryOptions(queryAPI, workspaceID));
	const analyticsQuery = createInfiniteQuery(() =>
		analyticsOverviewQueryOptions(analyticsQueryAPI, workspaceID, { days: 7, limit: 50 })
	);

	const scheduledLoading = $derived(scheduledQuery.isPending && !scheduledQuery.data);
	const failedLoading = $derived(failedQuery.isPending && !failedQuery.data);
	const readError = $derived.by(() => {
		if (scheduledQuery.isError && !scheduledQuery.data) return m.home_load_failed();
		return '';
	});

	const todayKey = $derived(workspaceClock(viewerTimeZone).date.toString());

	const upcoming = $derived.by(() => {
		const publications = (scheduledQuery.data ?? [])
			.map((publication) => ({
				publication,
				occurrence: publicationCalendarOccurrence(publication)
			}))
			.filter(
				(item): item is { publication: Publication; occurrence: string } =>
					item.occurrence !== null &&
					(item.publication.status === 'scheduled' || item.publication.status === 'publishing')
			)
			.toSorted((a, b) => a.occurrence.localeCompare(b.occurrence));
		return publications;
	});

	const goingOutPosts = $derived<GoingOutPost[]>(
		upcoming.slice(0, GOING_OUT_LIMIT).map(({ publication, occurrence }) => ({
			id: publication.id,
			title: publication.title,
			occurrence,
			timeZone: viewerTimeZone
		}))
	);

	const todayCount = $derived(
		upcoming.filter(({ occurrence }) => localDay(occurrence).key === todayKey).length
	);

	interface Weekday {
		key: string;
		label: string;
	}

	const nextPost = $derived(upcoming[0] ?? null);
	const lastPost = $derived(upcoming[upcoming.length - 1] ?? null);

	function localDay(instant: string): Weekday {
		const date = new Date(instant);
		return {
			key: date.toLocaleDateString('en-CA', { timeZone: viewerTimeZone }),
			label: date.toLocaleDateString(getLocaleTag(), {
				weekday: 'long',
				timeZone: viewerTimeZone
			})
		};
	}

	const greeting = $derived.by(() => {
		if (scheduledLoading || scheduledQuery.isError) return '';
		if (upcoming.length === 0) return m.home_greeting_none();
		if (todayCount > 0) {
			return todayCount === 1 ? m.home_greeting_one() : m.home_greeting({ count: todayCount });
		}
		if (nextPost) return m.home_greeting_next({ day: localDay(nextPost.occurrence).label });
		return '';
	});

	const closure = $derived.by(() => {
		if (scheduledLoading || scheduledQuery.isError || !lastPost) return null;
		const day = localDay(lastPost.occurrence);
		if (day.key === todayKey) return m.home_covered_today();
		return m.home_covered_until({ day: day.label });
	});

	const failedCount = $derived(failedQuery.data?.items.length ?? 0);
	const unreadReplies = $derived(inboxQuery.data?.unread_comments ?? 0);
	const unreadMessages = $derived(inboxQuery.data?.unread_conversations ?? 0);
	const disconnectedCount = $derived(
		(accountsQuery.data ?? []).filter((account) => !account.is_active).length
	);
	const pendingReviews = $derived(
		upcoming
			.filter(({ publication }) =>
				['pending', 'needs_review'].includes(publication.review_state ?? '')
			)
			.map(({ publication }) => ({ id: publication.id, title: publication.title }))
	);

	const analyticsSentence = $derived.by(() => {
		const summary = analyticsQuery.data?.pages[0]?.summary;
		if (!summary || summary.engagement.measured <= 0) return '';
		return m.home_analytics_sentence({
			value: summary.engagement.value.toLocaleString(getLocaleTag())
		});
	});

	function startNewPost() {
		if (!ui.startNewPost()) return;
		void goto(resolveAppPath('/'));
	}
</script>

<svelte:head>
	<title>{m.nav_home()} · {appBranding.profile.display_name}</title>
</svelte:head>

<PageContainer title={m.nav_home()} themeIconRole="home" description={greeting || undefined}>
	<div class="space-y-6">
		{#if readError}
			<InlineNotice tone="error" message={readError}>
				{#snippet actions()}
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							void scheduledQuery.refetch();
							void failedQuery.refetch();
							void inboxQuery.refetch();
							void accountsQuery.refetch();
							void analyticsQuery.refetch();
						}}
					>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}

		<WorkspaceSetupGuide {workspaceID} context="home" />

		{#if scheduledLoading}
			<div class="space-y-2" data-testid="home-loading">
				<Skeleton class="h-4 w-32" />
				<Skeleton class="h-11 w-full" />
				<Skeleton class="h-11 w-full" />
			</div>
		{:else if goingOutPosts.length > 0}
			<GoingOutSection posts={goingOutPosts} />
		{/if}

		{#if failedLoading}
			<Skeleton class="h-11 w-full" />
		{:else}
			<NeedsYouSection
				{failedCount}
				{unreadReplies}
				{unreadMessages}
				{disconnectedCount}
				{pendingReviews}
			/>
		{/if}

		{#if analyticsSentence}
			<section aria-labelledby="home-how-its-going-heading" data-testid="home-how-its-going">
				<h2 id="home-how-its-going-heading" class="text-sm font-medium text-muted-foreground">
					{m.home_section_how_its_going()}
				</h2>
				<p class="mt-2 text-sm leading-6">{analyticsSentence}</p>
			</section>
		{/if}

		<QuickActions {canEdit} />

		{#if closure}
			<p class="text-sm leading-6 text-muted-foreground" data-testid="home-closure">
				{closure}
			</p>
		{:else if !scheduledLoading && !scheduledQuery.isError && upcoming.length === 0 && canEdit}
			<div class="space-y-3">
				<p class="text-sm leading-6 text-muted-foreground">{m.home_empty_prompt()}</p>
				<Button variant="focal" class="min-h-11 sm:min-h-9" onclick={startNewPost}>
					{m.sidebar_new_post()}
				</Button>
			</div>
		{/if}
	</div>
</PageContainer>
