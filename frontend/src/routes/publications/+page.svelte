<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onDestroy, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client, type SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { auth, type AuthIdentityToken } from '$lib/stores/auth';
	import { ui } from '$lib/stores/ui.svelte';
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
	import { dismissToast, showToast } from '$lib/toast';
	import { formatSocialAccountName } from '$lib/utils';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		activityPublicationsQueryOptions,
		failedJobsQueryOptions,
		openPostQueryKeys,
		workspaceAccountsQueryOptions,
		type ActivityPublicationBucket
	} from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import {
		PublicationOperationScope,
		type PublicationOperation
	} from './publication-operation-scope';

	type Publication = components['schemas']['PublicationResponse'];
	type ActivityDestination = NonNullable<Publication['renditions']>[number];
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
	let hasLoaded = $state(false);
	let error = $state('');
	let queryError = $state('');
	let dataWorkspaceID = $state('');
	let dataActivityBucket = $state<ActivityPublicationBucket | ''>('');
	let dataRequestSequence = 0;
	let loadingMorePublications = $state(false);
	let loadingMoreJobs = $state(false);
	let destinationActionSequence = 0;
	const failureDismissalToastIDs = new Set<string | number>();
	let activeTab = $state<ActivityTab>(
		page.url.searchParams.get('tab') === 'drafts' ? 'drafts' : 'scheduled'
	);
	const publicationPageSize = 40;
	const jobPageSize = 50;
	const operationScope = new PublicationOperationScope<AuthIdentityToken | undefined>();
	type ActivityOperation = PublicationOperation<AuthIdentityToken | undefined>;

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
	const publicationsQuery = createQuery(() =>
		activityPublicationsQueryOptions(queryAPI, currentWorkspaceID, activeActivityBucket, {
			limit: publicationPageSize
		})
	);
	const failedJobsQuery = createQuery(() => ({
		...failedJobsQueryOptions(queryAPI, currentWorkspaceID, { limit: jobPageSize }),
		enabled: Boolean(currentWorkspaceID && activeActivityBucket === 'failed')
	}));
	const accountsQuery = createQuery(() =>
		workspaceAccountsQueryOptions(queryAPI, currentWorkspaceID)
	);
	const loading = $derived(
		publicationsQuery.isFetching ||
			accountsQuery.isFetching ||
			(activeActivityBucket === 'failed' && failedJobsQuery.isFetching)
	);
	const visibleError = $derived(error || queryError);
	const initialQueriesSettled = $derived(
		!publicationsQuery.isPending &&
			!accountsQuery.isPending &&
			(activeActivityBucket !== 'failed' || !failedJobsQuery.isPending)
	);
	const currentViewLoaded = $derived(
		hasLoaded &&
			dataWorkspaceID === currentWorkspaceID &&
			dataActivityBucket === activeActivityBucket &&
			initialQueriesSettled
	);
	const initialLoading = $derived(
		!currentViewLoaded && !visibleError && (loading || Boolean(currentWorkspaceID))
	);
	let appliedPublicationsResult = '';
	let appliedJobsResult = '';
	let appliedAccountsResult = '';

	$effect(() => {
		const workspaceId = currentWorkspaceID;
		const activityBucket = activeActivityBucket;
		if (dataWorkspaceID === workspaceId && dataActivityBucket === activityBucket) return;
		untrack(() => {
			dismissFailureDismissalToasts();
			operationScope.supersedeView();
			destinationActionSequence += 1;
			retryingDestination = '';
			dataRequestSequence++;
			const workspaceChanged = dataWorkspaceID !== workspaceId;
			dataWorkspaceID = workspaceId;
			dataActivityBucket = activityBucket;
			posts = [];
			publicationPage = { total: 0, nextCursor: '' };
			hasLoaded = false;
			loadingMorePublications = false;
			loadingMoreJobs = false;
			error = '';
			queryError = '';
			if (workspaceChanged) {
				failedJobs = [];
				failedJobsPage = { total: 0, nextCursor: '' };
				accounts = [];
			}
		});
	});

	$effect(() => {
		const data = publicationsQuery.data;
		const resultKey = `${currentWorkspaceID}:${activeActivityBucket}:${publicationsQuery.dataUpdatedAt}`;
		if (!data || appliedPublicationsResult === resultKey) return;
		appliedPublicationsResult = resultKey;
		untrack(() => {
			dataWorkspaceID = currentWorkspaceID;
			dataActivityBucket = activeActivityBucket;
			posts = data.items.map(activityItem);
			publicationPage = { total: data.total, nextCursor: data.nextCursor };
			hasLoaded = true;
		});
	});

	$effect(() => {
		const data = failedJobsQuery.data;
		const resultKey = `${currentWorkspaceID}:${failedJobsQuery.dataUpdatedAt}`;
		if (!data || appliedJobsResult === resultKey) return;
		appliedJobsResult = resultKey;
		untrack(() => {
			failedJobs = data.items;
			failedJobsPage = { total: data.total, nextCursor: data.nextCursor };
		});
	});

	$effect(() => {
		const data = accountsQuery.data;
		const resultKey = `${currentWorkspaceID}:${accountsQuery.dataUpdatedAt}`;
		if (!data || appliedAccountsResult === resultKey) return;
		appliedAccountsResult = resultKey;
		untrack(() => {
			accounts = data;
		});
	});

	$effect(() => {
		if (publicationsQuery.isError) {
			queryError = m.activity_failed_posts();
			return;
		}
		if (!initialQueriesSettled) {
			queryError = '';
			return;
		}
		if (activeActivityBucket === 'failed' && failedJobsQuery.isError) {
			if (!failedJobsQuery.data) {
				failedJobs = [];
				failedJobsPage = { total: 0, nextCursor: '' };
			}
			queryError = m.activity_failed_jobs();
			return;
		}
		if (accountsQuery.isError) {
			if (!accountsQuery.data) accounts = [];
			queryError = m.activity_failed_accounts();
			return;
		}
		queryError = '';
	});

	async function loadData() {
		dataRequestSequence++;
		loadingMorePublications = false;
		loadingMoreJobs = false;
		error = '';
		queryError = '';
		await Promise.all([
			publicationsQuery.refetch(),
			accountsQuery.refetch(),
			...(activeActivityBucket === 'failed' ? [failedJobsQuery.refetch()] : [])
		]);
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
			const response = await queryClient.query(
				activityPublicationsQueryOptions(queryAPI, workspaceId, activityBucket, {
					limit: publicationPageSize,
					cursor
				})
			);
			if (
				requestSequence !== dataRequestSequence ||
				currentWorkspaceID !== workspaceId ||
				activeActivityBucket !== activityBucket
			)
				return;
			const existingIDs = new Set(posts.map((post) => post.id));
			posts = [
				...posts,
				...response.items.map(activityItem).filter((post) => !existingIDs.has(post.id))
			];
			publicationPage = { total: response.total, nextCursor: response.nextCursor };
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
			const response = await queryClient.query(
				failedJobsQueryOptions(queryAPI, workspaceId, { limit: jobPageSize, cursor })
			);
			if (requestSequence !== dataRequestSequence || currentWorkspaceID !== workspaceId) return;
			const existingIDs = new Set(failedJobs.map((job) => job.id));
			failedJobs = [...failedJobs, ...response.items.filter((job) => !existingIDs.has(job.id))];
			failedJobsPage = { total: response.total, nextCursor: response.nextCursor };
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
			formatSocialAccountName(
				account?.account_username,
				account?.platform ?? destination.platform
			) ||
			account?.slug ||
			destination.platform
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

	function captureActivityOperation(
		workspaceId: string,
		activityBucket: ActivityPublicationBucket
	): ActivityOperation {
		return operationScope.capture(auth.captureIdentity(), workspaceId, activityBucket);
	}

	function activityActorIsCurrent(operation: ActivityOperation) {
		return operationScope.actorIsCurrent(operation, (identity) => auth.isIdentityCurrent(identity));
	}

	function activityViewIsCurrent(operation: ActivityOperation) {
		return operationScope.viewIsCurrent(operation, {
			workspaceId: currentWorkspaceID,
			viewKey: dataActivityBucket === activeActivityBucket ? dataActivityBucket : '',
			isIdentityCurrent: (identity) => auth.isIdentityCurrent(identity)
		});
	}

	function invalidateActivity(workspaceId: string) {
		ui.invalidatePublications({ workspaceId, scopes: ['activity'] }, { immediate: true });
	}

	function dismissFailureDismissalToasts() {
		for (const toastID of failureDismissalToastIDs) dismissToast(toastID);
		failureDismissalToastIDs.clear();
	}

	async function reconcileActivityPublication(operation: ActivityOperation, publicationId: string) {
		if (!activityActorIsCurrent(operation)) return false;
		const queryKey = openPostQueryKeys.publications.detail(operation.workspaceId, publicationId);
		await queryClient.cancelQueries({ queryKey, exact: true });
		if (!activityActorIsCurrent(operation)) return false;
		await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
		if (!activityActorIsCurrent(operation)) return false;
		invalidateActivity(operation.workspaceId);
		return true;
	}

	async function runDestinationAction(post: ActivityItem, destination: ActivityDestination) {
		const recovery = deliveryRecoveryAction(destination.delivery, destination.status);
		if (recovery === 'retry' && post.publication_id) {
			const workspaceId = currentWorkspaceID;
			const activityBucket = dataActivityBucket;
			if (!workspaceId || !activityBucket) return;
			const operation = captureActivityOperation(workspaceId, activityBucket);
			const actionSequence = ++destinationActionSequence;
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
				if (!(await reconcileActivityPublication(operation, post.publication_id))) return;
				if (actionSequence === destinationActionSequence && activityViewIsCurrent(operation)) {
					successMessage = m.activity_retry_queued();
					await loadData();
				}
			} catch (cause) {
				if (actionSequence === destinationActionSequence && activityViewIsCurrent(operation)) {
					error = cause instanceof Error ? cause.message : m.activity_delivery_failed();
				}
			} finally {
				if (actionSequence === destinationActionSequence && activityViewIsCurrent(operation)) {
					retryingDestination = '';
				}
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
		const workspaceId = currentWorkspaceID;
		const activityBucket = dataActivityBucket;
		if (!workspaceId || !activityBucket) return;
		const operation = captureActivityOperation(workspaceId, activityBucket);
		error = '';
		const publicationID = post.publication_id;
		try {
			const response = await client.POST('/publications/{id}/failure-dismissal', {
				params: { path: { id: publicationID } }
			});
			if (response.error) {
				if (activityViewIsCurrent(operation)) {
					error = response.error.detail || m.activity_dismiss_failed_error();
				}
				return;
			}
			if (!(await reconcileActivityPublication(operation, publicationID))) return;
			if (!activityViewIsCurrent(operation)) return;
			posts = posts.filter((candidate) => candidate.id !== post.id);
			publicationPage = {
				...publicationPage,
				total: Math.max(0, publicationPage.total - 1)
			};
			const toastID = showToast(m.activity_dismissed_failed(), 'success', {
				actionLabel: m.activity_restore_failed(),
				onAction: () => {
					failureDismissalToastIDs.delete(toastID);
					if (!activityViewIsCurrent(operation)) return;
					void (async () => {
						const restored = await client.DELETE('/publications/{id}/failure-dismissal', {
							params: { path: { id: publicationID } }
						});
						if (restored.error) {
							if (activityViewIsCurrent(operation)) {
								error = restored.error.detail || m.activity_dismiss_failed_error();
							}
							return;
						}
						if (!(await reconcileActivityPublication(operation, publicationID))) return;
						if (activityViewIsCurrent(operation)) await loadData();
					})();
				}
			});
			failureDismissalToastIDs.add(toastID);
		} catch {
			if (activityViewIsCurrent(operation)) error = m.activity_dismiss_failed_error();
		}
	}

	onDestroy(() => {
		dismissFailureDismissalToasts();
		dataRequestSequence += 1;
		destinationActionSequence += 1;
		operationScope.destroy();
	});
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

	{#if visibleError}
		<InlineNotice
			tone="error"
			message={visibleError}
			onDismiss={() => {
				error = '';
				queryError = '';
			}}
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
