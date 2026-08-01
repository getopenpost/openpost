<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { client, type SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import CalendarIcon from 'lucide-svelte/icons/calendar-days';
	import CheckCircleIcon from 'lucide-svelte/icons/circle-check';
	import XCircleIcon from 'lucide-svelte/icons/circle-x';
	import RefreshIcon from 'lucide-svelte/icons/refresh-cw';
	import FileTextIcon from 'lucide-svelte/icons/file-text';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import PostsIcon from 'lucide-svelte/icons/files';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import ClockIcon from 'lucide-svelte/icons/clock';
	import CopyIcon from 'lucide-svelte/icons/copy';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';

	type Publication = components['schemas']['PublicationResponse'];
	type ActivityDestination = NonNullable<Publication['renditions']>[number];
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
		payload?: string;
		run_at: string;
		last_error?: string;
	};

	let posts = $state.raw<ActivityItem[]>([]);
	let failedJobs = $state.raw<JobLog[]>([]);
	let accounts = $state.raw<SocialAccount[]>([]);
	let copiedReportPostID = $state('');
	let retryingDestination = $state('');
	let successMessage = $state('');
	let loading = $state(true);
	let hasLoaded = $state(false);
	let error = $state('');
	let dataWorkspaceID = $state('');
	let dataRequestSequence = 0;
	let activeTab = $state(page.url.searchParams.get('tab') === 'drafts' ? 'drafts' : 'scheduled');

	const scheduledPosts = $derived(
		posts
			.filter((post) => post.status === 'scheduled')
			.toSorted((a, b) => timestamp(a.scheduled_at) - timestamp(b.scheduled_at))
	);
	const publishedPosts = $derived(
		posts
			.filter((post) => post.status === 'published')
			.toSorted(
				(a, b) =>
					timestamp(b.actual_run_at || b.scheduled_at || b.created_at) -
					timestamp(a.actual_run_at || a.scheduled_at || a.created_at)
			)
	);
	const failedPosts = $derived(
		posts
			.filter((post) => post.status === 'failed')
			.toSorted((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
	);
	const drafts = $derived(
		posts
			.filter((post) => post.status === 'draft')
			.toSorted((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
	);
	const currentWorkspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const currentViewLoaded = $derived(hasLoaded && dataWorkspaceID === currentWorkspaceID);
	const initialLoading = $derived(
		!currentViewLoaded && !error && (loading || Boolean(currentWorkspaceID))
	);

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		if (workspaceID) void loadData(workspaceID);
	});

	async function loadData(requestedWorkspaceID = workspaceCtx.currentWorkspace?.id ?? '') {
		const requestSequence = ++dataRequestSequence;
		let workspaceId = requestedWorkspaceID;
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

			if (dataWorkspaceID !== workspaceId) {
				dataWorkspaceID = workspaceId;
				posts = [];
				failedJobs = [];
				accounts = [];
				hasLoaded = false;
			}

			const [postsResponse, jobsResponse, accountsResponse] = await Promise.all([
				client.GET('/publications', {
					params: { query: { workspace_id: workspaceId, limit: 200, offset: 0 } }
				}),
				client.GET('/jobs', {
					params: {
						query: { workspace_id: workspaceId, status: 'failed', limit: 100, offset: 0 }
					}
				}),
				client.GET('/accounts', { params: { query: { workspace_id: workspaceId } } })
			]);

			if (
				requestSequence !== dataRequestSequence ||
				(workspaceCtx.currentWorkspace?.id ?? '') !== workspaceId
			) {
				return;
			}
			if (postsResponse.error || !postsResponse.data) {
				throw new Error(m.activity_failed_posts());
			}
			posts = postsResponse.data.map(activityItem);
			failedJobs = jobsResponse.error
				? []
				: (jobsResponse.data ?? []).filter((job) => job.status === 'failed');
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
				workspaceCtx.currentWorkspace?.id !== workspaceId
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
			href:
				(publication.intent === 'post' || publication.intent === 'thread') &&
				publication.text_post_id
					? `/posts/${encodeURIComponent(publication.text_post_id)}`
					: `/publications/${encodeURIComponent(publication.id)}`,
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

	function failedJobPostID(job: JobLog) {
		if (!job.payload) return '';
		try {
			return JSON.parse(job.payload).post_id ?? '';
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
			default:
				return m.activity_status_draft();
		}
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

	function destinationStatusLabel(status: string) {
		switch (status) {
			case 'success':
			case 'published':
				return m.activity_destination_published();
			case 'failed':
				return m.activity_destination_failed();
			case 'skipped':
				return m.activity_destination_skipped();
			default:
				return m.activity_destination_pending();
		}
	}

	function destinationStatusClass(status: string) {
		switch (status) {
			case 'success':
			case 'published':
				return 'text-emerald-700 dark:text-emerald-300';
			case 'failed':
				return 'text-destructive';
			default:
				return 'text-muted-foreground';
		}
	}

	function destinationSummary(post: ActivityItem) {
		const destinations = post.destinations ?? [];
		return m.activity_delivery_summary({
			published: destinations.filter((destination) =>
				['success', 'published'].includes(destination.status)
			).length,
			failed: destinations.filter((destination) => destination.status === 'failed').length
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
			lines.push(`${m.activity_report_status()}: ${destinationStatusLabel(destination.status)}`);
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
		switch (destination.error_action) {
			case 'retry':
				return m.activity_retry_destination();
			case 'reconnect':
				return m.activity_reconnect_account();
			case 'billing':
				return m.activity_open_billing();
			case 'open_provider':
				return m.activity_review_account();
			default:
				return m.common_edit();
		}
	}

	async function runDestinationAction(post: ActivityItem, destination: ActivityDestination) {
		if (
			destination.error_action === 'retry' &&
			destination.error_retryable &&
			post.publication_id
		) {
			const key = `${post.id}:${destination.social_account_id}`;
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
		if (destination.error_action === 'reconnect' || destination.error_action === 'open_provider') {
			await goto(resolve('/accounts'));
			return;
		}
		if (destination.error_action === 'billing') {
			await goto(resolve('/settings') + '?tab=billing#billing');
			return;
		}
		await goto(resolve(post.href as '/'));
	}
</script>

{#snippet postList(items: ActivityItem[], emptyTitle: string, emptyDescription: string)}
	{#if items.length === 0}
		<EmptyState
			icon={FileTextIcon}
			title={emptyTitle}
			description={emptyDescription}
			variant="muted"
		/>
	{:else}
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
						{#if post.destinations?.length && post.status !== 'failed'}
							<div class="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
								{#each post.destinations as destination (destination.social_account_id)}
									<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
										<PlatformIcon platform={destination.platform} class="size-3.5" />
										<span>{destinationName(destination)}</span>
										<span class={destinationStatusClass(destination.status)}
											>· {destinationStatusLabel(destination.status)}</span
										>
									</span>
								{/each}
							</div>
						{:else if post.destinations?.length}
							<div
								class="mt-3 max-w-2xl rounded-md border border-destructive/15 bg-destructive/[0.035]"
							>
								<div
									class="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/10 px-3 py-2"
								>
									<div>
										<p class="text-xs font-medium">{m.activity_delivery_details()}</p>
										<p class="text-xs text-muted-foreground">{destinationSummary(post)}</p>
									</div>
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
								</div>
								<div class="divide-y divide-border/70 px-3">
									{#each post.destinations as destination (destination.social_account_id)}
										<div class="flex items-start gap-2.5 py-2.5 text-xs">
											<PlatformIcon
												platform={destination.platform}
												class="mt-0.5 size-4 shrink-0"
											/>
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
													<span class="font-medium">{destinationName(destination)}</span>
													<span class={destinationStatusClass(destination.status)}
														>{destinationStatusLabel(destination.status)}</span
													>
												</div>
												{#if destination.status === 'failed'}
													<p class="mt-1 leading-5 text-destructive/90">
														{m.activity_failure_reason({
															reason: destination.error_message || m.activity_unknown_failure()
														})}
													</p>
													<Button
														variant="link"
														size="sm"
														class="mt-1 h-auto min-h-8 px-0 text-xs"
														disabled={retryingDestination ===
															`${post.id}:${destination.social_account_id}`}
														onclick={() => runDestinationAction(post, destination)}
													>
														{destinationActionLabel(destination)}
													</Button>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
					<Button
						variant="ghost"
						size="sm"
						class="min-h-10 shrink-0"
						onclick={() => goto(resolve(post.href as '/'))}
						aria-label={m.activity_edit_post({ title: truncate(postText(post), 40) })}
					>
						<PencilIcon class="size-4 sm:mr-1.5" />
						<span class="hidden sm:inline">{m.common_edit()}</span>
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
		<Button size="sm" onclick={() => goto(resolve('/'))}>
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
				<TabsTrigger value="scheduled"
					>{m.activity_tab_scheduled()}
					<span class="text-muted-foreground">{scheduledPosts.length}</span></TabsTrigger
				>
				<TabsTrigger value="published"
					>{m.activity_tab_published()}
					<span class="text-muted-foreground">{publishedPosts.length}</span></TabsTrigger
				>
				<TabsTrigger value="failed"
					>{m.activity_tab_failed()}
					<span class="text-muted-foreground">{failedPosts.length + failedJobs.length}</span
					></TabsTrigger
				>
				<TabsTrigger value="drafts"
					>{m.activity_tab_drafts()}
					<span class="text-muted-foreground">{drafts.length}</span></TabsTrigger
				>
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
							{m.activity_technical_details({ count: failedJobs.length })}
						</summary>
						<div class="mt-3 divide-y rounded-md bg-muted/35 px-4">
							{#each failedJobs as job (job.id)}
								<div class="flex items-start justify-between gap-4 py-3 text-sm">
									<div>
										<p class="font-medium">{job.type.replaceAll('_', ' ')}</p>
										<p class="mt-1 text-xs text-destructive">
											{job.last_error || m.activity_delivery_failed()}
										</p>
									</div>
									{#if failedJobPostID(job)}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => goto(resolve('/posts/[id]', { id: failedJobPostID(job) }))}
											>{m.activity_open_post()}</Button
										>
									{/if}
								</div>
							{/each}
						</div>
					</details>
				{/if}
			</TabsContent>
			<TabsContent value="drafts">
				{@render postList(drafts, m.activity_empty_drafts_title(), m.activity_empty_drafts_body())}
			</TabsContent>
		</Tabs>
	{/if}
</PageContainer>
