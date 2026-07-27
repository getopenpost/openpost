<!--
	Direction — Communications / Engagement
	Intent: A scan-first operations queue for people managing replies across several accounts.
	World: Existing OpenPost application shell, typography, controls, and neutral surfaces.
	Density: Compact list rows with one expanded response area; filters stay above the queue.
	Composition: Provider identity and author lead; content and actions follow in reading order.
	Responsive: One column at every width, with controls wrapping into touch-safe rows on phones.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { getPlatformName } from '$lib/utils';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import CommunicationsNavigation from '$lib/components/communications-navigation.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import MessagesSquareIcon from 'lucide-svelte/icons/messages-square';
	import RefreshIcon from 'lucide-svelte/icons/refresh-cw';
	import ArchiveIcon from 'lucide-svelte/icons/archive';
	import ExternalLinkIcon from 'lucide-svelte/icons/external-link';
	import InboxIcon from 'lucide-svelte/icons/inbox';
	import ReplyIcon from 'lucide-svelte/icons/reply';
	import EyeOffIcon from 'lucide-svelte/icons/eye-off';
	import TrashIcon from 'lucide-svelte/icons/trash-2';

	type EngagementItem = components['schemas']['EngagementItem'];

	let loading = $state(true);
	let refreshing = $state(false);
	let error = $state('');
	let items = $state.raw<EngagementItem[]>([]);
	let total = $state(0);
	let unreadOnly = $state(false);
	let archived = $state(false);
	let platformFilter = $state('');
	let loadedKey = $state('');
	let dataWorkspaceId = $state('');
	let knownPlatforms = $state.raw<string[]>([]);
	let replyItemId = $state('');
	let replyBody = $state('');
	let actionInFlight = $state('');
	let confirmItem = $state.raw<EngagementItem | null>(null);
	let confirmAction = $state<'hide' | 'delete'>('delete');
	let confirmDialogOpen = $state(false);
	let toast = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const initialLoading = $derived(
		Boolean(workspaceId) && loading && dataWorkspaceId !== workspaceId
	);
	const loadKey = $derived(
		`${workspaceId}:${platformFilter}:${unreadOnly ? 'unread' : 'all'}:${archived ? 'archived' : 'active'}`
	);
	const confirmPlatformName = $derived(
		confirmItem ? getPlatformName(confirmItem.platform) : m.engagement_heading()
	);

	onMount(() => void workspaceCtx.initialize());

	$effect(() => {
		if (workspaceId && loadKey !== loadedKey) {
			loadedKey = loadKey;
			void loadEngagement();
		}
	});

	async function loadEngagement() {
		if (!workspaceId) return;
		loading = true;
		error = '';
		const requestedKey = loadKey;
		const { data, error: apiError } = await client.GET('/engagement', {
			params: {
				query: {
					workspace_id: workspaceId,
					platform: platformFilter || undefined,
					unread_only: unreadOnly,
					archived,
					limit: 100,
					offset: 0
				}
			}
		});
		if (requestedKey !== loadKey) return;
		if (apiError) {
			error = apiError.detail || m.engagement_load_failed();
		} else {
			items = data?.items ?? [];
			total = data?.total ?? 0;
			dataWorkspaceId = workspaceId;
			knownPlatforms = [
				...new Set([...knownPlatforms, ...items.map((item) => item.platform)])
			].sort();
		}
		loading = false;
	}

	async function refresh() {
		if (!workspaceId) return;
		refreshing = true;
		const { error: apiError } = await client.POST('/communications/refresh', {
			body: { workspace_id: workspaceId }
		});
		refreshing = false;
		showToast(
			apiError ? m.communications_refresh_failed() : m.communications_refresh_queued(),
			apiError ? 'error' : 'success'
		);
	}

	async function setState(
		item: EngagementItem,
		state: { read?: boolean; archived?: boolean },
		announce = true
	) {
		if (!workspaceId) return false;
		actionInFlight = item.id;
		const { error: apiError } = await client.POST('/engagement/state', {
			body: { workspace_id: workspaceId, ids: [item.id], ...state }
		});
		actionInFlight = '';
		if (apiError) {
			if (announce) showToast(m.engagement_action_failed(), 'error');
			return false;
		}
		if (state.archived !== undefined || (state.read && unreadOnly)) {
			items = items.filter((candidate) => candidate.id !== item.id);
			total = Math.max(0, total - 1);
		} else if (state.read !== undefined) {
			items = items.map((candidate) =>
				candidate.id === item.id
					? {
							...candidate,
							read_at: state.read ? new Date().toISOString() : undefined
						}
					: candidate
			);
		}
		if (announce) {
			showToast(
				state.archived === true
					? m.engagement_archived_success()
					: state.archived === false
						? m.engagement_restored_success()
						: m.engagement_read_success(),
				'success'
			);
		}
		return true;
	}

	async function queueAction(item: EngagementItem, action: 'reply' | 'hide' | 'delete') {
		if (!workspaceId) return;
		actionInFlight = item.id;
		const { error: apiError } = await client.POST('/engagement/{item_id}/actions', {
			params: { path: { item_id: item.id } },
			body: {
				workspace_id: workspaceId,
				action,
				message: action === 'reply' ? replyBody.trim() : undefined
			}
		});
		actionInFlight = '';
		if (apiError) {
			showToast(apiError.detail || m.engagement_action_failed(), 'error');
			return;
		}
		if (action === 'reply') {
			replyItemId = '';
			replyBody = '';
		}
		await setState(item, { read: true }, false);
		showToast(m.engagement_action_queued(), 'success');
	}

	function showToast(message: string, tone: 'neutral' | 'success' | 'error') {
		toast = message;
		toastTone = tone;
	}

	function requestProviderAction(item: EngagementItem, action: 'hide' | 'delete') {
		confirmItem = item;
		confirmAction = action;
		confirmDialogOpen = true;
	}

	async function confirmProviderAction() {
		const item = confirmItem;
		const action = confirmAction;
		confirmItem = null;
		if (item) await queueAction(item, action);
	}

	function authorLabel(item: EngagementItem) {
		return item.author_name || item.author_handle || m.common_untitled_user();
	}

	function hasTimestamp(value: string | undefined) {
		return Boolean(value && !value.startsWith('0001-01-01'));
	}

	function dateLabel(value: string | undefined) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}
</script>

<svelte:head>
	<title>{m.engagement_heading()} · OpenPost</title>
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
	title={m.engagement_heading()}
	description={m.engagement_description()}
	icon={MessagesSquareIcon}
	loading={false}
	loadingLayout="list"
	loadingItems={6}
>
	{#snippet actions()}
		<Button variant="outline" onclick={refresh} disabled={refreshing || !workspaceId}>
			<RefreshIcon class={refreshing ? 'size-4 animate-spin' : 'size-4'} />
			{m.communications_refresh()}
		</Button>
	{/snippet}

	<div class="space-y-5">
		<CommunicationsNavigation active="engagement" />

		<div class="flex flex-wrap items-center gap-3">
			<Select.Root
				type="single"
				value={platformFilter || 'all'}
				onValueChange={(value) => (platformFilter = value === 'all' ? '' : value)}
			>
				<Select.Trigger class="h-11 w-44 sm:h-9" aria-label={m.engagement_all_platforms()}>
					{platformFilter ? getPlatformName(platformFilter) : m.engagement_all_platforms()}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">{m.engagement_all_platforms()}</Select.Item>
					{#each knownPlatforms as provider (provider)}
						<Select.Item value={provider}>{getPlatformName(provider)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<label class="flex min-h-11 items-center gap-2 text-sm">
				<Checkbox bind:checked={unreadOnly} />
				{m.engagement_unread_only()}
			</label>
			<label class="flex min-h-11 items-center gap-2 text-sm">
				<Checkbox bind:checked={archived} />
				{m.engagement_archived()}
			</label>
			<span class="ms-auto text-sm text-muted-foreground">{total}</span>
		</div>
		<p class="-mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
			{m.engagement_archive_help()}
		</p>

		{#if initialLoading}
			<PageLoading layout="list" label={m.common_loading()} items={5} />
		{:else if error}
			<InlineNotice tone="error" message={error} />
		{/if}
		{#if !initialLoading && items.length === 0 && !error}
			<EmptyState
				icon={MessagesSquareIcon}
				title={m.engagement_empty_title()}
				description={m.engagement_empty_description()}
				variant="muted"
			/>
		{:else if !initialLoading && items.length > 0}
			<div
				class="divide-y rounded-lg border bg-card transition-opacity"
				class:opacity-70={loading}
				aria-busy={loading}
			>
				{#each items as item (item.id)}
					{@const isRead = hasTimestamp(item.read_at)}
					<article class={['p-4 sm:p-5', !isRead && 'bg-primary/[0.025]']}>
						<div class="flex min-w-0 items-start gap-3">
							<div
								class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"
								aria-hidden="true"
							>
								<PlatformIcon platform={item.platform} class="size-4" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
									<h2 class="truncate text-sm font-semibold">{authorLabel(item)}</h2>
									{#if item.author_handle}
										<span class="truncate text-xs text-muted-foreground">{item.author_handle}</span>
									{/if}
									<span class="text-xs text-muted-foreground">
										{dateLabel(item.remote_created_at || item.created_at)}
									</span>
								</div>
								<p class="mt-2 max-w-3xl text-sm leading-6 whitespace-pre-wrap">{item.body}</p>

								<div class="mt-3 flex flex-wrap gap-1">
									{#if item.provider_post_url}
										<Button
											href={item.provider_post_url}
											target="_blank"
											rel="noreferrer"
											variant="ghost"
											size="sm"
										>
											<ExternalLinkIcon class="size-4" />
											{m.engagement_open_provider({ platform: getPlatformName(item.platform) })}
										</Button>
									{/if}
									{#if item.can_reply}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => {
												replyItemId = replyItemId === item.id ? '' : item.id;
												replyBody = '';
											}}
										>
											<ReplyIcon class="size-4" />{m.engagement_reply()}
										</Button>
									{/if}
									{#if !isRead}
										<Button
											variant="ghost"
											size="sm"
											disabled={actionInFlight === item.id}
											onclick={() => void setState(item, { read: true })}
										>
											{m.engagement_mark_read()}
										</Button>
									{/if}
									{#if item.can_hide && !item.hidden}
										<Button
											variant="ghost"
											size="sm"
											disabled={actionInFlight === item.id}
											onclick={() => requestProviderAction(item, 'hide')}
										>
											<EyeOffIcon class="size-4" />{m.engagement_hide()}
										</Button>
									{/if}
									<Button
										variant="ghost"
										size="sm"
										disabled={actionInFlight === item.id}
										onclick={() => void setState(item, { archived: !archived })}
									>
										{#if archived}
											<InboxIcon class="size-4" />
										{:else}
											<ArchiveIcon class="size-4" />
										{/if}
										{archived ? m.engagement_restore() : m.engagement_archive()}
									</Button>
									{#if item.can_delete}
										<Button
											variant="ghost"
											size="sm"
											class="text-destructive"
											onclick={() => requestProviderAction(item, 'delete')}
										>
											<TrashIcon class="size-4" />{m.engagement_delete({
												platform: getPlatformName(item.platform)
											})}
										</Button>
									{/if}
								</div>

								{#if replyItemId === item.id}
									<form
										class="mt-3 grid gap-2"
										onsubmit={(event) => {
											event.preventDefault();
											void queueAction(item, 'reply');
										}}
									>
										<Textarea
											bind:value={replyBody}
											placeholder={m.engagement_reply_placeholder()}
											rows={3}
											required
										/>
										<div class="flex justify-end">
											<Button
												type="submit"
												size="sm"
												disabled={!replyBody.trim() || actionInFlight === item.id}
											>
												{m.engagement_send_reply()}
											</Button>
										</div>
									</form>
								{/if}
							</div>
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={confirmDialogOpen}
	title={confirmAction === 'delete'
		? m.engagement_delete({ platform: confirmPlatformName })
		: m.engagement_hide()}
	description={confirmAction === 'delete'
		? m.engagement_delete_confirm_description({ platform: confirmPlatformName })
		: m.engagement_hide_confirm_description()}
	confirmLabel={confirmAction === 'delete'
		? m.engagement_delete({ platform: confirmPlatformName })
		: m.engagement_hide()}
	onConfirm={confirmProviderAction}
/>
