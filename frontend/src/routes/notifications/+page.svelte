<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import BellIcon from 'lucide-svelte/icons/bell';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import CheckIcon from 'lucide-svelte/icons/check-check';

	type Notification = components['schemas']['UserNotification'];
	type ChannelPreference = components['schemas']['ChannelPreference'];
	type Preferences = Record<string, ChannelPreference>;

	const criticalTypes = new Set([
		'publish_failed',
		'account_needs_attention',
		'reply_failed',
		'workspace_invite'
	]);
	const eventTypes = [
		'post_published',
		'publish_failed',
		'account_needs_attention',
		'new_engagement',
		'new_message',
		'reply_failed',
		'workspace_invite'
	];

	let loading = $state(true);
	let error = $state('');
	let notifications = $state.raw<Notification[]>([]);
	let unreadCount = $state(0);
	let preferences = $state.raw<Preferences>({});
	let loadedWorkspace = $state('');
	let saving = $state(false);
	let toast = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let deleteDialogOpen = $state(false);

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');

	onMount(() => void workspaceCtx.initialize());

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspace) {
			loadedWorkspace = workspaceId;
			void load();
		}
	});

	async function load() {
		if (!workspaceId) return;
		loading = true;
		error = '';
		const requestedWorkspace = workspaceId;
		const [notificationResponse, preferenceResponse] = await Promise.all([
			client.GET('/notifications', {
				params: { query: { workspace_id: requestedWorkspace, limit: 100 } }
			}),
			client.GET('/notifications/preferences')
		]);
		if (workspaceId !== requestedWorkspace) return;
		if (notificationResponse.error) {
			error = notificationResponse.error.detail || m.notifications_load_failed();
		} else {
			notifications = notificationResponse.data?.items ?? [];
			unreadCount = notificationResponse.data?.unread_count ?? 0;
		}
		if (!preferenceResponse.error) {
			preferences = preferenceResponse.data ?? {};
		}
		loading = false;
	}

	async function markAllRead() {
		const { error: apiError } = await client.POST('/notifications/read', {
			body: { all: true }
		});
		if (apiError) {
			showToast(m.notifications_load_failed(), 'error');
			return;
		}
		const now = new Date().toISOString();
		notifications = notifications.map((notification) => ({ ...notification, read_at: now }));
		unreadCount = 0;
	}

	async function deleteAll() {
		const { error: apiError } = await client.POST('/notifications/delete', {
			body: { all: true }
		});
		if (apiError) {
			showToast(m.notifications_load_failed(), 'error');
			return;
		}
		notifications = [];
		unreadCount = 0;
	}

	async function openNotification(notification: Notification) {
		if (!notification.read_at) {
			await client.POST('/notifications/read', { body: { ids: [notification.id] } });
			notifications = notifications.map((item) =>
				item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
			);
			unreadCount = Math.max(0, unreadCount - 1);
		}
		if (notification.href.startsWith('/')) {
			await goto(resolve(notification.href as '/'));
		}
	}

	function updatePreference(eventType: string, enabled: boolean) {
		const current = preferences[eventType] ?? { in_app: true };
		preferences = {
			...preferences,
			[eventType]: { ...current, in_app: enabled }
		};
	}

	async function savePreferences() {
		saving = true;
		const { data, error: apiError } = await client.PUT('/notifications/preferences', {
			body: preferences
		});
		saving = false;
		if (apiError) {
			showToast(m.notifications_load_failed(), 'error');
			return;
		}
		preferences = data ?? preferences;
		showToast(m.notifications_preferences_saved(), 'success');
	}

	function showToast(message: string, tone: 'success' | 'error') {
		toast = message;
		toastTone = tone;
	}

	function eventLabel(eventType: string) {
		switch (eventType) {
			case 'post_published':
				return m.notifications_event_post_published();
			case 'publish_failed':
				return m.notifications_event_publish_failed();
			case 'account_needs_attention':
				return m.notifications_event_account_needs_attention();
			case 'new_engagement':
				return m.notifications_event_new_engagement();
			case 'new_message':
				return m.notifications_event_new_message();
			case 'reply_failed':
				return m.notifications_event_reply_failed();
			default:
				return m.notifications_event_workspace_invite();
		}
	}

	function dateLabel(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
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

<PageContainer
	title={m.notifications_heading()}
	description={m.notifications_description()}
	icon={BellIcon}
	{loading}
	loadingLayout="list"
	loadingItems={6}
>
	{#snippet actions()}
		<Button variant="outline" onclick={() => void markAllRead()} disabled={unreadCount === 0}>
			<CheckIcon class="size-4" />{m.notifications_mark_all_read()}
		</Button>
	{/snippet}

	<div class="space-y-8">
		{#if error}
			<InlineNotice tone="error" message={error} />
		{:else if notifications.length === 0}
			<EmptyState
				icon={BellIcon}
				title={m.notifications_empty_title()}
				description={m.notifications_empty_description()}
				variant="muted"
			/>
		{:else}
			<section aria-label={m.notifications_heading()}>
				<div class="mb-3 flex items-center justify-between">
					<p class="text-sm text-muted-foreground">
						{m.notifications_unread_count({ count: unreadCount })}
					</p>
					<Button
						variant="ghost"
						size="sm"
						class="text-destructive"
						onclick={() => (deleteDialogOpen = true)}
					>
						<TrashIcon class="size-4" />{m.notifications_delete_all()}
					</Button>
				</div>
				<div class="divide-y rounded-lg border bg-card">
					{#each notifications as notification (notification.id)}
						<button
							type="button"
							class={[
								'flex min-h-20 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
								!notification.read_at && 'bg-primary/[0.025]'
							]}
							onclick={() => void openNotification(notification)}
						>
							<span
								class={[
									'mt-1 size-2 shrink-0 rounded-full',
									notification.read_at ? 'bg-transparent' : 'bg-primary'
								]}
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1">
								<span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
									<span class="text-sm font-semibold">{notification.title}</span>
									<span class="text-xs text-muted-foreground">
										{dateLabel(notification.created_at)}
									</span>
								</span>
								{#if notification.body}
									<span class="mt-1 block text-sm leading-5 text-muted-foreground">
										{notification.body}
									</span>
								{/if}
							</span>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<section aria-label={m.notifications_preferences()}>
			<SectionHeader
				title={m.notifications_preferences()}
				description={m.notifications_critical_help()}
			/>
			<div class="mt-4 overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/35 text-left">
						<tr>
							<th class="px-4 py-3 font-medium">{m.notifications_preferences()}</th>
							<th class="w-28 px-4 py-3 text-center font-medium">{m.notifications_in_app()}</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each eventTypes as eventType (eventType)}
							{@const preference = preferences[eventType] ?? { in_app: true }}
							<tr>
								<td class="px-4 py-3">{eventLabel(eventType)}</td>
								<td class="px-4 py-3 text-center">
									<Checkbox
										checked={preference.in_app}
										disabled={criticalTypes.has(eventType)}
										aria-label={`${eventLabel(eventType)} · ${m.notifications_in_app()}`}
										onCheckedChange={(checked) => updatePreference(eventType, checked)}
									/>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="mt-3 flex justify-end">
				<Button onclick={() => void savePreferences()} disabled={saving}>
					{m.notifications_save_preferences()}
				</Button>
			</div>
		</section>
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.notifications_delete_all_confirm_title()}
	description={m.notifications_delete_all_confirm_description()}
	confirmLabel={m.notifications_delete_all()}
	onConfirm={deleteAll}
/>
