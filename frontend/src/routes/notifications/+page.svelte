<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import { notificationInbox, type Notification } from '$lib/stores/notifications.svelte';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { notificationTopicIcon, notificationTopicLabel } from '$lib/notification-topics';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import NotificationMutes from '$lib/components/notification-mutes.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CheckIcon from '@lucide/svelte/icons/check-check';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	type NotificationAction = NonNullable<Notification['actions']>[number];
	type ReadFilter = 'all' | 'unread' | 'read';

	interface NotificationGroup {
		key: string;
		label: string;
		items: Notification[];
	}

	let toast = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let statusMessage = $state('');
	let deleteDialogOpen = $state(false);
	let actionPending = $state('');
	let readPending = $state('');
	let bulkActionPending = $state<'mark-read' | 'delete' | ''>('');
	let readFilter = $state<ReadFilter>('all');

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const workspaceName = $derived(workspaceCtx.currentWorkspace?.name ?? '');
	const inbox = $derived(notificationInbox.snapshot(workspaceId));
	const initialLoading = $derived(Boolean(workspaceId) && !inbox.initialized && !inbox.error);
	const filteredNotifications = $derived.by(() =>
		inbox.items.filter((notification) => {
			if (readFilter === 'unread') return !notification.read_at;
			if (readFilter === 'read') return Boolean(notification.read_at);
			return true;
		})
	);
	const notificationGroups = $derived(groupNotifications(filteredNotifications));

	onMount(() => void workspaceCtx.initialize());

	$effect(() => {
		const requestedWorkspace = workspaceId;
		if (requestedWorkspace) void notificationInbox.ensureLoaded(requestedWorkspace);
	});

	async function markAllRead() {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace || bulkActionPending) return;
		bulkActionPending = 'mark-read';
		const result = await notificationInbox.markRead(requestedWorkspace, { all: true });
		if (workspaceId === requestedWorkspace) {
			if (result.ok) announce(m.notifications_mark_all_success());
			else showToast(m.notifications_mark_all_failed(), 'error');
		}
		bulkActionPending = '';
	}

	async function markNotificationRead(notification: Notification): Promise<boolean> {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace || readPending) return false;
		readPending = notification.id;
		const result = await notificationInbox.markRead(requestedWorkspace, {
			ids: [notification.id]
		});
		if (workspaceId === requestedWorkspace) {
			if (result.ok) announce(m.notifications_mark_read_success());
			else showToast(m.notifications_mark_read_failed(), 'error');
		}
		readPending = '';
		return result.ok;
	}

	async function deleteAll() {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace || bulkActionPending) return;
		bulkActionPending = 'delete';
		const result = await notificationInbox.deleteNotifications(requestedWorkspace, { all: true });
		if (workspaceId === requestedWorkspace) {
			if (result.ok) announce(m.notifications_delete_all_success());
			else showToast(m.notifications_delete_all_failed(), 'error');
		}
		bulkActionPending = '';
	}

	async function openNotification(notification: Notification) {
		if (!notification.read_at) await markNotificationRead(notification);
		if (isSafeLocalHref(notification.href)) {
			await goto(resolve(notification.href as '/'));
		}
	}

	async function loadMore() {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace) return;
		const previousCount = notificationInbox.snapshot(requestedWorkspace).items.length;
		const result = await notificationInbox.loadMore(requestedWorkspace);
		if (workspaceId !== requestedWorkspace || !result.ok) return;
		const loadedCount = notificationInbox.snapshot(requestedWorkspace).items.length - previousCount;
		if (loadedCount > 0) announce(m.notifications_more_loaded({ count: loadedCount }));
	}

	async function runNotificationAction(notification: Notification, action: NotificationAction) {
		actionPending = `${notification.id}:${action.label}`;
		try {
			if (action.operation === 'retry_failed_publication' && action.target_id) {
				const { error: apiError } = await client.POST('/publications/{id}/retry-failed', {
					params: { path: { id: action.target_id } }
				});
				if (apiError) {
					showToast(apiError.detail || m.notifications_action_failed(), 'error');
					return;
				}
				showToast(m.notifications_retry_queued(), 'success');
				await openNotification(notification);
				await notificationInbox.refresh(workspaceId, { background: true });
				return;
			}
			if (isSafeLocalHref(action.href)) {
				await openNotification({ ...notification, href: action.href ?? '' });
			}
		} catch {
			showToast(m.notifications_action_failed(), 'error');
		} finally {
			actionPending = '';
		}
	}

	function showToast(message: string, tone: 'success' | 'error') {
		toast = message;
		toastTone = tone;
	}

	function announce(message: string) {
		toast = '';
		statusMessage = message;
	}

	function isSafeLocalHref(href: string | undefined): href is string {
		return Boolean(href?.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\'));
	}

	function groupNotifications(notifications: Notification[]): NotificationGroup[] {
		const groups: NotificationGroup[] = [];
		for (const notification of notifications) {
			const date = new Date(notification.created_at);
			const key = dateGroupKey(date);
			const existing = groups.find((group) => group.key === key);
			if (existing) existing.items.push(notification);
			else groups.push({ key, label: dateGroupLabel(date), items: [notification] });
		}
		return groups;
	}

	function dateGroupKey(date: Date): string {
		if (Number.isNaN(date.getTime())) return 'unknown';
		const difference = calendarDayDifference(date);
		if (difference === 0) return 'today';
		if (difference === 1) return 'yesterday';
		return `date-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
	}

	function dateGroupLabel(date: Date): string {
		if (Number.isNaN(date.getTime())) return m.notifications_heading();
		const difference = calendarDayDifference(date);
		if (difference === 0) return m.notifications_group_today();
		if (difference === 1) return m.notifications_group_yesterday();
		return new Intl.DateTimeFormat(getLocaleTag(), { dateStyle: 'full' }).format(date);
	}

	function calendarDayDifference(date: Date): number {
		const now = new Date();
		const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
		const target = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
		return Math.round((today - target) / 86_400_000);
	}

	function fullDateLabel(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'full',
			timeStyle: 'short'
		}).format(date);
	}

	function timestampLabel(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		const difference = date.getTime() - Date.now();
		const absoluteDifference = Math.abs(difference);
		if (absoluteDifference < 45_000) return m.notifications_time_just_now();
		const relative = new Intl.RelativeTimeFormat(getLocaleTag(), { numeric: 'auto' });
		if (absoluteDifference < 3_600_000) {
			return relative.format(Math.round(difference / 60_000), 'minute');
		}
		if (absoluteDifference < 86_400_000) {
			return relative.format(Math.round(difference / 3_600_000), 'hour');
		}
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}
</script>

<svelte:head>
	<title>{m.notifications_heading()} · OpenPost</title>
</svelte:head>

{#if toast}
	<AppToast
		message={toast}
		tone={toastTone}
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (toast = '')}
	/>
{/if}

<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusMessage}</p>

<PageContainer
	title={m.notifications_heading()}
	description={workspaceName ? m.notifications_description({ workspace: workspaceName }) : ''}
	icon={BellIcon}
	loading={initialLoading}
	loadingLayout="list"
	loadingItems={6}
>
	{#snippet actions()}
		<div class="flex flex-wrap gap-2">
			<Button
				variant="outline"
				onclick={() => void goto(resolve('/settings?tab=notifications' as '/'))}
			>
				<SettingsIcon class="size-4" />{m.notifications_open_settings()}
			</Button>
			<Button
				variant="outline"
				onclick={() => void markAllRead()}
				disabled={inbox.unreadCount === 0 || bulkActionPending !== ''}
			>
				<CheckIcon class="size-4" />{m.notifications_mark_all_read()}
			</Button>
		</div>
	{/snippet}

	<div class="space-y-8">
		<NotificationMutes workspaceID={workspaceId} {workspaceName} />
		{#if inbox.error}
			<InlineNotice tone="error" message={inbox.error || m.notifications_load_failed()}>
				{#snippet actions()}
					<Button
						variant="outline"
						size="sm"
						disabled={inbox.loading}
						onclick={() => void notificationInbox.refresh(workspaceId)}
					>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else if inbox.items.length === 0}
			<EmptyState
				icon={BellIcon}
				title={m.notifications_empty_title()}
				description={m.notifications_empty_description()}
				variant="muted"
			/>
		{:else}
			<section aria-label={m.notifications_heading()}>
				<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
					<div class="space-y-1">
						<p class="text-sm text-muted-foreground">
							{m.notifications_unread_count({ count: inbox.unreadCount })}
						</p>
						<p class="max-w-2xl text-xs leading-5 text-muted-foreground">
							{m.notifications_bulk_scope({ workspace: workspaceName })}
						</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						class="text-destructive"
						disabled={bulkActionPending !== ''}
						onclick={() => (deleteDialogOpen = true)}
					>
						<TrashIcon class="size-4" />{m.notifications_delete_all()}
					</Button>
				</div>

				<div
					class="mb-5 flex flex-wrap gap-2"
					role="group"
					aria-label={m.notifications_filter_label()}
				>
					<Button
						variant={readFilter === 'all' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={readFilter === 'all'}
						onclick={() => (readFilter = 'all')}
					>
						{m.common_all()}
					</Button>
					<Button
						variant={readFilter === 'unread' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={readFilter === 'unread'}
						onclick={() => (readFilter = 'unread')}
					>
						{m.notifications_filter_unread()}
					</Button>
					<Button
						variant={readFilter === 'read' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={readFilter === 'read'}
						onclick={() => (readFilter = 'read')}
					>
						{m.notifications_filter_read()}
					</Button>
				</div>

				{#if filteredNotifications.length === 0}
					<EmptyState
						icon={BellIcon}
						title={m.notifications_no_results_title()}
						description={m.notifications_no_results_description()}
						actionLabel={m.notifications_reset_filter()}
						onAction={() => (readFilter = 'all')}
						variant="muted"
						headingLevel={2}
					/>
				{:else}
					<div class="space-y-7">
						{#each notificationGroups as group (group.key)}
							<section aria-labelledby={`notification-group-${group.key}`}>
								<h2
									id={`notification-group-${group.key}`}
									class="mb-2 text-sm font-semibold text-foreground"
								>
									{group.label}
								</h2>
								<div class="divide-y rounded-lg border bg-card">
									{#each group.items as notification (notification.id)}
										{@const TypeIcon = notificationTopicIcon(notification.type)}
										{@const typeLabel = notificationTopicLabel(notification.type)}
										{@const fullTime = fullDateLabel(notification.created_at)}
										<article
											class={[
												'flex min-h-24 w-full items-start gap-3 p-4',
												!notification.read_at && 'bg-primary/[0.025]'
											]}
											aria-label={m.notifications_item_label({
												type: typeLabel,
												status: notification.read_at
													? m.notifications_status_read()
													: m.notifications_status_unread(),
												title: notification.title,
												time: fullTime
											})}
											data-notification-id={notification.id}
											data-unread={!notification.read_at}
										>
											<span
												class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
												aria-hidden="true"
											>
												<TypeIcon class="size-4" />
											</span>
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
													<span class="text-xs font-medium text-muted-foreground">{typeLabel}</span>
													{#if !notification.read_at}
														<span
															class="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
														>
															{m.notifications_status_unread()}
														</span>
													{/if}
													<time
														datetime={notification.created_at}
														class="text-xs text-muted-foreground"
														aria-label={fullTime}
														title={fullTime}
													>
														{timestampLabel(notification.created_at)}
													</time>
												</div>
												<h3 class="mt-1 text-sm font-semibold break-words">{notification.title}</h3>
												{#if notification.body}
													<p
														class="mt-1 max-w-3xl text-sm leading-5 break-words text-muted-foreground"
													>
														{notification.body}
													</p>
												{/if}
												<div class="mt-3 flex flex-wrap gap-2">
													{#if !notification.read_at}
														<Button
															variant="outline"
															size="sm"
															disabled={readPending !== ''}
															onclick={() => void markNotificationRead(notification)}
														>
															<CheckIcon class="size-4" />{m.notifications_mark_read()}
														</Button>
													{/if}
													{#if isSafeLocalHref(notification.href)}
														<Button
															variant="ghost"
															size="sm"
															disabled={readPending === notification.id}
															onclick={() => void openNotification(notification)}
														>
															{m.notifications_open_notification()}<ArrowRightIcon class="size-4" />
														</Button>
													{/if}
													{#each notification.actions ?? [] as action (`${action.label}:${action.href}:${action.operation}`)}
														<Button
															variant={action.kind === 'primary' ? 'default' : 'outline'}
															size="sm"
															disabled={actionPending !== ''}
															onclick={() => void runNotificationAction(notification, action)}
														>
															{action.label}
														</Button>
													{/each}
												</div>
											</div>
										</article>
									{/each}
								</div>
							</section>
						{/each}
					</div>
				{/if}

				{#if inbox.loadMoreError}
					<InlineNotice
						tone="error"
						message={inbox.loadMoreError || m.notifications_load_more_failed()}
						class="mt-5"
					>
						{#snippet actions()}
							<Button
								variant="outline"
								size="sm"
								disabled={inbox.loadingMore}
								onclick={() => void loadMore()}
							>
								{m.common_retry()}
							</Button>
						{/snippet}
					</InlineNotice>
				{/if}
				{#if inbox.nextCursor}
					<div class="mt-5 flex justify-center">
						<Button variant="outline" disabled={inbox.loadingMore} onclick={() => void loadMore()}>
							{inbox.loadingMore ? m.notifications_loading_more() : m.notifications_load_more()}
						</Button>
					</div>
				{/if}
			</section>
		{/if}
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.notifications_delete_all_confirm_title()}
	description={m.notifications_delete_all_confirm_description({ workspace: workspaceName })}
	confirmLabel={m.notifications_delete_all()}
	onConfirm={deleteAll}
/>
