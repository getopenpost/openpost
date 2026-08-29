<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client, type SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PublicationDeliveryCard from '$lib/components/publication-delivery-card.svelte';
	import { deliveryRecoveryAction, deliveryStateLabel } from '$lib/delivery-presentation';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import XCircleIcon from '@lucide/svelte/icons/circle-x';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PostsIcon from '@lucide/svelte/icons/files';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { resolveAppPath } from '$lib/app-path';
	import { showToast } from '$lib/toast';

	type Publication = components['schemas']['PublicationResponse'];
	type ActivityDestination = NonNullable<Publication['renditions']>[number];
	type ActivityPublicationBucket = 'scheduled' | 'published' | 'failed' | 'draft';
	type ActivityTab = 'scheduled' | 'published' | 'failed' | 'drafts';
	type ActivityPageState = { total: number; nextCursor: string };
	type ActivityItem = {
		id: string;
		publication_id: string;
		href: string;
		content: string;
		status: string;
		scheduled_at?: string;
		actual_run_at?: string;
		created_at: string;
		isThread: boolean;
		postCount: number;
		destinations: ActivityDestination[];
	};

	type JobLog = {
		id: string;
		type: string;
		status: string;
		publication_id?: string;
		payload?: string;
		run_at: string;
		last_error?: string;
	};

	let posts = $state.raw<ActivityItem[]>([]);
	let failedJobs = $state.raw<JobLog[]>([]);
	let publicationPage = $state.raw<ActivityPageState>({ total: 0, nextCursor: '' });
	let failedJobsPage = $state.raw<ActivityPageState>({ total: 0, nextCursor: '' });
	let accounts = $state.raw<SocialAccount[]>([]);
	let copiedReportPostID = $state('');
	let retryingDestination = $state('');
	let successMessage = $state('');
	let loading = $state(true);
	let hasLoaded = $state(false);
	let error = $state('');
	let dataWorkspaceID = $state('');
	let dataActivityBucket = $state<ActivityPublicationBucket | ''>('');
	let dataRequestSequence = 0;
	let loadingMorePublications = $state(false);
	let loadingMoreJobs = $state(false);
	let activeTab = $state<ActivityTab>(
		page.url.searchParams.get('tab') === 'drafts' ? 'drafts' : 'scheduled'
	);
	const publicationPageSize = 40;
	const jobPageSize = 50;

	const scheduledPosts = $derived(
		posts
			.filter((post) => activityBucket(post) === 'scheduled')
			.toSorted((a, b) => timestamp(a.scheduled_at) - timestamp(b.scheduled_at))
	);
	const publishedPosts = $derived(
		posts
			.filter((post) => activityBucket(post) === 'published')
			.toSorted(
				(a, b) =>
					timestamp(b.actual_run_at || b.scheduled_at || b.created_at) -
					timestamp(a.actual_run_at || a.scheduled_at || a.created_at)
			)
	);
	const failedPosts = $derived(
		posts
			.filter((post) => activityBucket(post) === 'failed')
			.toSorted((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
	);
	const failureGroups = $derived.by(() => {
		const groups = new SvelteMap<
			string,
			{
				key: string;
				label: string;
				postIDs: SvelteSet<string>;
				samplePost: ActivityItem;
				sampleDestination: ActivityDestination;
			}
		>();
		for (const post of failedPosts) {
			for (const destination of post.destinations.filter((item) =>
				['retry', 'manual_resolution'].includes(deliveryRecoveryAction(item.delivery, item.status))
			)) {
				const recovery = deliveryRecoveryAction(destination.delivery, destination.status);
				const key = `${destination.social_account_id}:${recovery}:${destination.delivery?.error_code || destination.delivery?.error_kind || 'failed'}`;
				const group = groups.get(key) ?? {
					key,
					label: destinationName(destination),
					postIDs: new SvelteSet<string>(),
					samplePost: post,
					sampleDestination: destination
				};
				group.postIDs.add(post.id);
				groups.set(key, group);
			}
		}
		const priority = new Map([
			['manual_resolution', 0],
			['retry', 1]
		]);
		return [...groups.values()].toSorted(
			(left, right) =>
				(priority.get(
					deliveryRecoveryAction(left.sampleDestination.delivery, left.sampleDestination.status)
				) ?? 2) -
				(priority.get(
					deliveryRecoveryAction(right.sampleDestination.delivery, right.sampleDestination.status)
				) ?? 2)
		);
	});
	const drafts = $derived(
		posts
			.filter((post) => activityBucket(post) === 'draft')
			.toSorted((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
	);
	const currentWorkspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const activeActivityBucket = $derived(activityBucketForTab(activeTab));
	const currentViewLoaded = $derived(
		hasLoaded &&
			dataWorkspaceID === currentWorkspaceID &&
			dataActivityBucket === activeActivityBucket
	);
	const initialLoading = $derived(
		!currentViewLoaded && !error && (loading || Boolean(currentWorkspaceID))
	);

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		const activityBucket = activeActivityBucket;
		if (workspaceID) untrack(() => void loadData(workspaceID, activityBucket));
	});

	async function loadData(
		requestedWorkspaceID = workspaceCtx.currentWorkspace?.id ?? '',
		requestedActivityBucket = activeActivityBucket
	) {
		const requestSequence = ++dataRequestSequence;
		let workspaceId = requestedWorkspaceID;
		loadingMorePublications = false;
		loadingMoreJobs = false;
		loading = true;
		error = '';
		try {
			if (!workspaceCtx.currentWorkspace) {
				try {
					await workspaceCtx.initialize();
				} catch {
					throw new Error(m.activity_failed_load());
				}
			}
			workspaceId ||= workspaceCtx.currentWorkspace?.id ?? '';
			if (!workspaceId) throw new Error(m.activity_failed_load());

			if (dataWorkspaceID !== workspaceId || dataActivityBucket !== requestedActivityBucket) {
				const workspaceChanged = dataWorkspaceID !== workspaceId;
				dataWorkspaceID = workspaceId;
				dataActivityBucket = requestedActivityBucket;
				posts = [];
				failedJobs = [];
				if (workspaceChanged) accounts = [];
				publicationPage = { total: 0, nextCursor: '' };
				failedJobsPage = { total: 0, nextCursor: '' };
				hasLoaded = false;
			}

			const [publicationsResponse, jobsResponse, accountsResponse] = await Promise.all([
				client.GET('/publications', {
					params: {
						query: {
							workspace_id: workspaceId,
							activity_bucket: requestedActivityBucket,
							limit: publicationPageSize,
							offset: 0
						}
					}
				}),
				client.GET('/jobs', {
					params: {
						query: { workspace_id: workspaceId, status: 'failed', limit: jobPageSize, offset: 0 }
					}
				}),
				client.GET('/accounts', { params: { query: { workspace_id: workspaceId } } })
			]);

			if (
				requestSequence !== dataRequestSequence ||
				(workspaceCtx.currentWorkspace?.id ?? '') !== workspaceId ||
				activeActivityBucket !== requestedActivityBucket
			) {
				return;
			}
			if (publicationsResponse.error || !publicationsResponse.data) {
				throw new Error(m.activity_failed_posts());
			}
			posts = publicationsResponse.data.map(activityItem);
			publicationPage = pageStateFromResponse(publicationsResponse.response);
			failedJobs = jobsResponse.error
				? []
				: (jobsResponse.data ?? []).filter((job) => job.status === 'failed');
			failedJobsPage = jobsResponse.error
				? { total: 0, nextCursor: '' }
				: pageStateFromResponse(jobsResponse.response);
			accounts = accountsResponse.error ? [] : (accountsResponse.data ?? []);
			error = jobsResponse.error
				? m.activity_failed_jobs()
				: accountsResponse.error
					? m.activity_failed_accounts()
					: '';
			hasLoaded = true;
		} catch (cause) {
			if (
				requestSequence !== dataRequestSequence ||
				workspaceCtx.currentWorkspace?.id !== workspaceId ||
				activeActivityBucket !== requestedActivityBucket
			) {
				return;
			}
			error = cause instanceof Error ? cause.message : m.activity_failed_load();
		} finally {
			if (requestSequence === dataRequestSequence) {
				loading = false;
			}
		}
	}

	function pageStateFromResponse(response: Response): ActivityPageState {
		const total = Number(response.headers.get('X-Total-Count') ?? 0);
		return {
			total: Number.isFinite(total) ? total : 0,
			nextCursor: response.headers.get('X-Next-Cursor') ?? ''
		};
	}

	async function loadMorePublicationHistory() {
		const workspaceId = currentWorkspaceID;
		const cursor = publicationPage.nextCursor;
		const activityBucket = dataActivityBucket;
		if (!workspaceId || !activityBucket || !cursor || loadingMorePublications) return;
		const requestSequence = dataRequestSequence;
		loadingMorePublications = true;
		error = '';
		try {
			const query = {
				workspace_id: workspaceId,
				activity_bucket: activityBucket,
				limit: publicationPageSize,
				offset: 0,
				cursor
			};
			const response = await client.GET('/publications', { params: { query } });
			if (response.error || !response.data) throw new Error(m.activity_failed_posts());
			if (
				requestSequence !== dataRequestSequence ||
				currentWorkspaceID !== workspaceId ||
				activeActivityBucket !== activityBucket
			)
				return;
			const existingIDs = new Set(posts.map((post) => post.id));
			posts = [
				...posts,
				...response.data.map(activityItem).filter((post) => !existingIDs.has(post.id))
			];
			publicationPage = pageStateFromResponse(response.response);
		} catch (cause) {
			if (
				requestSequence !== dataRequestSequence ||
				currentWorkspaceID !== workspaceId ||
				activeActivityBucket !== activityBucket
			)
				return;
			error = cause instanceof Error ? cause.message : m.activity_failed_posts();
		} finally {
			if (requestSequence === dataRequestSequence) loadingMorePublications = false;
		}
	}

	async function loadMoreFailedJobs() {
		const workspaceId = currentWorkspaceID;
		const cursor = failedJobsPage.nextCursor;
		if (!workspaceId || !cursor || loadingMoreJobs) return;
		const requestSequence = dataRequestSequence;
		loadingMoreJobs = true;
		error = '';
		try {
			const query = {
				workspace_id: workspaceId,
				status: 'failed',
				limit: jobPageSize,
				offset: 0,
				cursor
			};
			const response = await client.GET('/jobs', { params: { query } });
			if (response.error || !response.data) throw new Error(m.activity_failed_jobs());
			if (requestSequence !== dataRequestSequence || currentWorkspaceID !== workspaceId) return;
			const existingIDs = new Set(failedJobs.map((job) => job.id));
			failedJobs = [
				...failedJobs,
				...response.data.filter((job) => job.status === 'failed' && !existingIDs.has(job.id))
			];
			failedJobsPage = pageStateFromResponse(response.response);
		} catch (cause) {
			if (requestSequence !== dataRequestSequence || currentWorkspaceID !== workspaceId) return;
			error = cause instanceof Error ? cause.message : m.activity_failed_jobs();
		} finally {
			if (requestSequence === dataRequestSequence) loadingMoreJobs = false;
		}
	}

	function timestamp(value?: string) {
		return value ? new Date(value).getTime() : 0;
	}

	function formatDateTime(value?: string) {
		if (!value) return '';
		return new Date(value).toLocaleString(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: workspaceCtx.settings.timezone || 'UTC'
		});
	}

	function threadPostCount(count: number) {
		return count === 1
			? m.activity_thread_post_one({ count })
			: m.activity_thread_post_many({ count });
	}

	function activityItem(publication: Publication): ActivityItem {
		const segments = publication.segments ?? [];
		const content =
			publication.source_text.trim() ||
			segments.find((segment) => segment.body.trim())?.body.trim() ||
			publication.title.trim() ||
			m.activity_untitled_post();
		const isThread = publication.intent === 'thread' || segments.length > 1;
		return {
			id: publication.id,
			publication_id: publication.id,
			href: `/publications/${encodeURIComponent(publication.id)}`,
			content,
			status: publication.status,
			scheduled_at: publication.scheduled_at,
			actual_run_at: publication.actual_run_at,
			created_at: publication.created_at,
			isThread,
			postCount: Math.max(1, segments.length),
			destinations: publication.renditions ?? []
		};
	}

	function postText(post: ActivityItem) {
		return post.isThread ? `${post.content} · ${threadPostCount(post.postCount)}` : post.content;
	}

	function truncate(value: string, max = 180) {
		return value.length > max ? `${value.slice(0, max).trim()}…` : value;
	}

	function failedJobHref(job: JobLog) {
		if (job.publication_id) {
			return `/publications/${encodeURIComponent(job.publication_id)}`;
		}
		if (!job.payload) return '';
		try {
			const payload = JSON.parse(job.payload);
			if (payload.publication_id) {
				return `/publications/${encodeURIComponent(payload.publication_id)}`;
			}
			return '';
		} catch {
			return '';
		}
	}

	function statusLabel(post: ActivityItem) {
		switch (post.status) {
			case 'scheduled':
				return m.activity_status_scheduled();
			case 'published':
				return m.activity_status_published();
			case 'failed':
				return m.activity_status_failed();
			case 'publishing':
				return m.activity_status_publishing();
			case 'ready':
				return m.activity_status_pending();
			default:
				return m.activity_status_draft();
		}
	}

	function activityBucket(post: ActivityItem): ActivityPublicationBucket {
		switch (post.status) {
			case 'published':
				return 'published';
			case 'failed':
				return 'failed';
			case 'scheduled':
			case 'publishing':
				return 'scheduled';
			case 'ready':
				return post.scheduled_at ? 'scheduled' : 'draft';
			default:
				return 'draft';
		}
	}

	function activityBucketForTab(tab: ActivityTab): ActivityPublicationBucket {
		return tab === 'drafts' ? 'draft' : tab;
	}

	function statusIcon(post: ActivityItem) {
		switch (post.status) {
			case 'scheduled':
				return ClockIcon;
			case 'published':
				return CheckCircleIcon;
			case 'failed':
				return XCircleIcon;
			default:
				return FileTextIcon;
		}
	}

	function statusClass(post: ActivityItem) {
		switch (post.status) {
			case 'scheduled':
				return 'text-amber-700 dark:text-amber-300';
			case 'publishing':
			case 'ready':
				return 'text-blue-700 dark:text-blue-300';
			case 'published':
				return 'text-emerald-700 dark:text-emerald-300';
			case 'failed':
				return 'text-destructive';
			default:
				return 'text-muted-foreground';
		}
	}

	function destinationAccount(destination: ActivityDestination) {
		return accounts.find((account) => account.id === destination.social_account_id);
	}

	function destinationName(destination: ActivityDestination) {
		const account = destinationAccount(destination);
		return (
			account?.slug ||
			(account?.account_username ? `@${account.account_username}` : destination.platform)
		);
	}

	function destinationState(destination: ActivityDestination) {
		return destination.delivery?.state || destination.status;
	}

	function destinationSummary(post: ActivityItem) {
		const destinations = post.destinations ?? [];
		return m.activity_delivery_summary({
			published: destinations.filter((destination) =>
				['success', 'published', 'live'].includes(destinationState(destination))
			).length,
			failed: destinations.filter((destination) =>
				['failed', 'rejected', 'manual_resolution'].includes(destinationState(destination))
			).length
		});
	}

	function buildDeliveryReport(post: ActivityItem) {
		const lines = [
			m.activity_report_heading(),
			`${m.activity_report_post()}: ${post.id}`,
			`${m.activity_report_created()}: ${post.created_at}`
		];
		if (post.scheduled_at) lines.push(`${m.activity_report_scheduled()}: ${post.scheduled_at}`);
		for (const destination of post.destinations ?? []) {
			lines.push(
				'',
				`${m.activity_report_destination()}: ${destinationName(destination)} (${destination.platform})`
			);
			lines.push(
				`${m.activity_report_status()}: ${deliveryStateLabel(destinationState(destination))}`
			);
			if (destination.error_message) {
				lines.push(`${m.activity_report_reason()}: ${destination.error_message}`);
			}
		}
		return lines.join('\n');
	}

	async function copyDeliveryReport(post: ActivityItem) {
		try {
			await navigator.clipboard.writeText(buildDeliveryReport(post));
			copiedReportPostID = post.id;
			setTimeout(() => {
				if (copiedReportPostID === post.id) copiedReportPostID = '';
			}, 2500);
		} catch {
			error = m.activity_report_copy_failed();
		}
	}

	function destinationActionLabel(destination: ActivityDestination) {
		switch (deliveryRecoveryAction(destination.delivery, destination.status)) {
			case 'retry':
				return m.publication_delivery_retry();
			case 'manual_resolution':
				return m.publication_delivery_review_destination();
			default:
				return '';
		}
	}

	async function runDestinationAction(post: ActivityItem, destination: ActivityDestination) {
		const recovery = deliveryRecoveryAction(destination.delivery, destination.status);
		if (recovery === 'retry' && post.publication_id) {
			const key = `${post.id}:${destination.social_account_id}:${destination.target_key}`;
			retryingDestination = key;
			error = '';
			successMessage = '';
			try {
				const { error: retryError } = await client.POST(
					'/publications/{id}/renditions/{account_id}/retry',
					{
						params: {
							path: {
								id: post.publication_id,
								account_id: destination.social_account_id
							},
							query: {
								target_key: destination.target_key
							}
						}
					}
				);
				if (retryError) {
					throw new Error(retryError.detail || m.activity_delivery_failed());
				}
				successMessage = m.activity_retry_queued();
				await loadData();
			} catch (cause) {
				error = cause instanceof Error ? cause.message : m.activity_delivery_failed();
			} finally {
				retryingDestination = '';
			}
			return;
		}
		if (recovery === 'manual_resolution') {
			await goto(
				resolveAppPath(`/settings?tab=accounts&account_id=${destination.social_account_id}`)
			);
			return;
		}
	}

	async function dismissFailedPost(post: ActivityItem) {
		if (!post.publication_id) return;
		error = '';
		const publicationID = post.publication_id;
		const response = await client.POST('/publications/{id}/failure-dismissal', {
			params: { path: { id: publicationID } }
		});
		if (response.error) {
			error = response.error.detail || m.activity_dismiss_failed_error();
			return;
		}
		posts = posts.filter((candidate) => candidate.id !== post.id);
		showToast(m.activity_dismissed_failed(), 'success', {
			actionLabel: m.activity_restore_failed(),
			onAction: () => {
				void (async () => {
					const restored = await client.DELETE('/publications/{id}/failure-dismissal', {
						params: { path: { id: publicationID } }
					});
					if (restored.error) {
						error = restored.error.detail || m.activity_dismiss_failed_error();
						return;
					}
					await loadData();
				})();
			}
		});
	}
</script>

{#snippet postList(items: ActivityItem[], emptyTitle: string, emptyDescription: string)}
	{#if items.length === 0 && !publicationPage.nextCursor}
		<EmptyState
			icon={FileTextIcon}
			title={emptyTitle}
			description={emptyDescription}
			variant="muted"
		/>
	{:else if items.length > 0}
		<div class="divide-y border-y">
			{#each items as post (post.id)}
				{@const StatusIcon = statusIcon(post)}
				<article class="group flex items-start gap-3 py-4 sm:gap-4">
					<div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
						<StatusIcon class={`size-4 ${statusClass(post)}`} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
							<span class={['font-medium', statusClass(post)]}>{statusLabel(post)}</span>
							<span class="text-muted-foreground">
								{formatDateTime(post.actual_run_at || post.scheduled_at || post.created_at)}
							</span>
						</div>
						<p class="mt-1.5 max-w-[72ch] text-sm leading-6 text-foreground/92">
							{truncate(postText(post))}
						</p>
						{#if post.destinations?.length}
							<div
								class={[
									'mt-3 max-w-2xl rounded-md border',
									post.status === 'failed'
										? 'border-destructive/15 bg-destructive/[0.035]'
										: 'border-border bg-card'
								]}
							>
								{#if post.status === 'failed'}
									<div
										class="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/10 px-3 py-2"
									>
										<div>
											<p class="text-xs font-medium">{m.activity_delivery_details()}</p>
											<p class="text-xs text-muted-foreground">{destinationSummary(post)}</p>
										</div>
										<div class="flex items-center gap-1">
											<Button
												variant="ghost"
												size="sm"
												class="h-8 text-xs"
												onclick={() => copyDeliveryReport(post)}
											>
												{#if copiedReportPostID === post.id}
													<CheckCircleIcon class="mr-1.5 size-3.5 text-emerald-600" />
													{m.activity_report_copied()}
												{:else}
													<CopyIcon class="mr-1.5 size-3.5" />
													{m.activity_copy_report()}
												{/if}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												class="h-8 text-xs"
												onclick={() => dismissFailedPost(post)}
											>
												{m.activity_dismiss_failed()}
											</Button>
										</div>
									</div>
								{/if}
								<div class="divide-y divide-border/70 px-3">
									{#each post.destinations as destination (destination.social_account_id)}
										<PublicationDeliveryCard
											rendition={destination}
											destinationLabel={destinationName(destination)}
											variant="compact"
											retrying={retryingDestination ===
												`${post.id}:${destination.social_account_id}:${destination.target_key}`}
											onRetry={() => runDestinationAction(post, destination)}
											onManualResolution={() => runDestinationAction(post, destination)}
										/>
									{/each}
								</div>
							</div>
						{/if}
					</div>
					<Button
						variant="ghost"
						size="sm"
						class="min-h-10 shrink-0"
						onclick={() => goto(resolveAppPath(post.href))}
						aria-label={post.status === 'published' || post.status === 'publishing'
							? m.activity_view_post({ title: truncate(postText(post), 40) })
							: m.activity_edit_post({ title: truncate(postText(post), 40) })}
					>
						{#if post.status === 'published' || post.status === 'publishing'}
							<EyeIcon class="size-4 sm:mr-1.5" />
							<span class="hidden sm:inline">{m.activity_view_details()}</span>
						{:else}
							<PencilIcon class="size-4 sm:mr-1.5" />
							<span class="hidden sm:inline">{m.common_edit()}</span>
						{/if}
					</Button>
				</article>
			{/each}
		</div>
	{/if}
{/snippet}

<svelte:head>
	<title>{m.activity_title()} — {m.common_openpost()}</title>
</svelte:head>

<PageContainer
	title={m.activity_title()}
	description={m.activity_description()}
	icon={PostsIcon}
	loading={initialLoading}
	loadingLayout="list"
	loadingMessage={m.common_loading()}
>
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={() => loadData()} disabled={loading}>
			<RefreshIcon class={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
			{m.common_refresh()}
		</Button>
		<Button size="sm" onclick={() => goto(resolveAppPath('/'))}>
			<PlusIcon class="mr-1.5 size-3.5" />
			{m.activity_new_post()}
		</Button>
	{/snippet}

	{#if error}
		<InlineNotice
			tone="error"
			message={error}
			onDismiss={() => (error = '')}
			dismissLabel={m.common_dismiss()}
		>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => loadData()}>{m.common_refresh()}</Button>
			{/snippet}
		</InlineNotice>
	{/if}
	{#if successMessage}
		<InlineNotice
			tone="success"
			message={successMessage}
			onDismiss={() => (successMessage = '')}
			dismissLabel={m.common_dismiss()}
		/>
	{/if}
	{#if currentViewLoaded}
		<Tabs bind:value={activeTab}>
			<TabsList
				variant="line"
				class="mb-6 no-scrollbar w-full justify-start overflow-x-auto overflow-y-hidden"
			>
				<TabsTrigger value="scheduled">{m.activity_tab_scheduled()}</TabsTrigger>
				<TabsTrigger value="published">{m.activity_tab_published()}</TabsTrigger>
				<TabsTrigger value="failed">{m.activity_tab_failed()}</TabsTrigger>
				<TabsTrigger value="drafts">{m.activity_tab_drafts()}</TabsTrigger>
			</TabsList>

			<TabsContent value="scheduled">
				{@render postList(
					scheduledPosts,
					m.activity_empty_scheduled_title(),
					m.activity_empty_scheduled_body()
				)}
			</TabsContent>
			<TabsContent value="published">
				{@render postList(
					publishedPosts,
					m.activity_empty_published_title(),
					m.activity_empty_published_body()
				)}
			</TabsContent>
			<TabsContent value="failed">
				{#if failureGroups.length > 0}
					<div class="mb-6 space-y-3" aria-label={m.activity_recovery_queue()}>
						{#each failureGroups as group (group.key)}
							<div
								class="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center"
							>
								<div class="min-w-0 flex-1">
									<p class="font-medium">{group.label}</p>
									<p class="mt-1 text-sm text-muted-foreground">
										{group.postIDs.size === 1
											? m.activity_recovery_affected_one()
											: m.activity_recovery_affected({ count: group.postIDs.size })}
										{#if group.sampleDestination.error_message}
											· {group.sampleDestination.error_message}
										{/if}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onclick={() => runDestinationAction(group.samplePost, group.sampleDestination)}
									disabled={retryingDestination ===
										`${group.samplePost.id}:${group.sampleDestination.social_account_id}:${group.sampleDestination.target_key}`}
								>
									{destinationActionLabel(group.sampleDestination)}
								</Button>
							</div>
						{/each}
					</div>
				{/if}
				{@render postList(
					failedPosts,
					m.activity_empty_failed_title(),
					m.activity_empty_failed_body()
				)}
				{#if failedJobs.length > 0}
					<details class="mt-6 border-t pt-4">
						<summary
							class="cursor-pointer text-sm font-medium text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						>
							{m.activity_technical_details({ count: failedJobsPage.total })}
						</summary>
						<p class="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
							{m.activity_technical_details_description()}
						</p>
						<div class="mt-3 divide-y rounded-md bg-muted/35 px-4">
							{#each failedJobs as job (job.id)}
								<div class="flex items-start justify-between gap-4 py-3 text-sm">
									<div>
										<p class="font-medium">{job.type.replaceAll('_', ' ')}</p>
										<p class="mt-1 text-xs text-destructive">
											{job.last_error || m.activity_delivery_failed()}
										</p>
									</div>
									{#if failedJobHref(job)}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => goto(resolveAppPath(failedJobHref(job)))}
											>{m.activity_open_post()}</Button
										>
									{/if}
								</div>
							{/each}
						</div>
						<div class="flex min-h-10 items-center justify-between gap-3 py-3">
							<span class="text-xs text-muted-foreground tabular-nums" aria-live="polite">
								{failedJobs.length} / {failedJobsPage.total}
							</span>
							{#if failedJobsPage.nextCursor}
								<Button
									variant="outline"
									size="sm"
									disabled={loading || loadingMoreJobs}
									onclick={loadMoreFailedJobs}
								>
									{#if loadingMoreJobs}
										<RefreshIcon class="mr-1.5 size-3.5 animate-spin" />
									{/if}
									{m.activity_load_more_jobs({
										count: Math.min(jobPageSize, failedJobsPage.total - failedJobs.length)
									})}
								</Button>
							{/if}
						</div>
					</details>
				{/if}
			</TabsContent>
			<TabsContent value="drafts">
				{@render postList(drafts, m.activity_empty_drafts_title(), m.activity_empty_drafts_body())}
			</TabsContent>
		</Tabs>
		<div class="mt-6 flex min-h-10 items-center justify-between gap-3 border-t pt-4">
			<span class="text-xs text-muted-foreground tabular-nums" aria-live="polite">
				{m.stock_results_count({ shown: posts.length, total: publicationPage.total })}
			</span>
			{#if publicationPage.nextCursor}
				<Button
					variant="outline"
					size="sm"
					disabled={loading || loadingMorePublications}
					onclick={loadMorePublicationHistory}
				>
					{#if loadingMorePublications}
						<RefreshIcon class="mr-1.5 size-3.5 animate-spin" />
					{/if}
					{m.notifications_load_more()}
				</Button>
			{/if}
		</div>
	{/if}
</PageContainer>
