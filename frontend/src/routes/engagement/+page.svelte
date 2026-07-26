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
	import PageContainer from '$lib/components/page-container.svelte';
	import CommunicationsNavigation from '$lib/components/communications-navigation.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import MessagesSquareIcon from 'lucide-svelte/icons/messages-square';
	import RefreshIcon from 'lucide-svelte/icons/refresh-cw';
	import ArchiveIcon from 'lucide-svelte/icons/archive';
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
	let replyItemId = $state('');
	let replyBody = $state('');
	let actionInFlight = $state('');
	let confirmItem = $state.raw<EngagementItem | null>(null);
	let confirmAction = $state<'hide' | 'delete'>('delete');
	let confirmDialogOpen = $state(false);
	let toast = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const platforms = $derived([...new Set(items.map((item) => item.platform))].sort());
	const loadKey = $derived(
		`${workspaceId}:${platformFilter}:${unreadOnly ? 'unread' : 'all'}:${archived ? 'archived' : 'active'}`
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
			items = [];
			total = 0;
		} else {
			items = data?.items ?? [];
			total = data?.total ?? 0;
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

	async function setState(item: EngagementItem, state: { read?: boolean; archived?: boolean }) {
		if (!workspaceId) return;
		actionInFlight = item.id;
		const { error: apiError } = await client.POST('/engagement/state', {
			body: { workspace_id: workspaceId, ids: [item.id], ...state }
		});
		actionInFlight = '';
		if (apiError) {
			showToast(m.engagement_action_failed(), 'error');
			return;
		}
		loadedKey = '';
		await loadEngagement();
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
		showToast(m.engagement_action_queued(), 'success');
		void setState(item, { read: true });
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
	{loading}
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
			<label class="grid gap-1 text-sm">
				<span class="sr-only">{m.engagement_all_platforms()}</span>
				<select
					class="h-11 rounded-md border bg-background px-3 text-sm sm:h-9"
					bind:value={platformFilter}
				>
					<option value="">{m.engagement_all_platforms()}</option>
					{#each platforms as provider (provider)}
						<option value={provider}>{provider}</option>
					{/each}
				</select>
			</label>
			<label class="flex min-h-11 items-center gap-2 text-sm">
				<input class="size-4 accent-primary" type="checkbox" bind:checked={unreadOnly} />
				{m.engagement_unread_only()}
			</label>
			<label class="flex min-h-11 items-center gap-2 text-sm">
				<input class="size-4 accent-primary" type="checkbox" bind:checked={archived} />
				{m.engagement_archived()}
			</label>
			<span class="ms-auto text-sm text-muted-foreground">{total}</span>
		</div>

		{#if error}
			<InlineNotice tone="error" message={error} />
		{:else if items.length === 0}
			<EmptyState
				icon={MessagesSquareIcon}
				title={m.engagement_empty_title()}
				description={m.engagement_empty_description()}
				variant="muted"
			/>
		{:else}
			<div class="divide-y rounded-lg border bg-card">
				{#each items as item (item.id)}
					<article class={['p-4 sm:p-5', !item.read_at && 'bg-primary/[0.025]']}>
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
									{#if !item.read_at}
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
										onclick={() => void setState(item, { archived: !item.archived_at })}
									>
										<ArchiveIcon class="size-4" />
										{item.archived_at ? m.engagement_restore() : m.engagement_archive()}
									</Button>
									{#if item.can_delete}
										<Button
											variant="ghost"
											size="sm"
											class="text-destructive"
											onclick={() => requestProviderAction(item, 'delete')}
										>
											<TrashIcon class="size-4" />{m.engagement_delete()}
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
	title={confirmAction === 'delete' ? m.engagement_delete() : m.engagement_hide()}
	description={confirmAction === 'delete'
		? m.engagement_delete_confirm_description()
		: m.engagement_hide_confirm_description()}
	confirmLabel={confirmAction === 'delete' ? m.engagement_delete() : m.engagement_hide()}
	onConfirm={confirmProviderAction}
/>
