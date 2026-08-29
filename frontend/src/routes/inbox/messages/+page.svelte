<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Attachment as SvelteAttachment } from 'svelte/attachments';
	import { resolve } from '$app/paths';
	import { client, type SocialAccount } from '$lib/api/client';
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
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import {
		allFeatureEffectiveDisabled,
		collectiveDisabledReason,
		loadFeatureStates
	} from '$lib/feature-disabled';
	import type { components as FeatureComponents } from '$lib/api/types';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import SendIcon from '@lucide/svelte/icons/send';

	type Conversation = components['schemas']['Conversation'];
	type DirectMessage = components['schemas']['DirectMessage'];
	type SyncState = components['schemas']['MessageSyncState'];
	type FeatureState = FeatureComponents['schemas']['FeatureStateResponse'];
	type Attachment = { type: string; url: string; name?: string; thumbnail?: string };
	type AttachmentJSONValue =
		| string
		| number
		| boolean
		| null
		| AttachmentJSONValue[]
		| { [key: string]: AttachmentJSONValue };

	function attachmentFields(
		value: AttachmentJSONValue
	): { [key: string]: AttachmentJSONValue } | null {
		if (value === null || Array.isArray(value) || Object(value) !== value) return null;
		// SAFETY: The recursive JSON union and checks above establish a non-array object.
		return value as { [key: string]: AttachmentJSONValue };
	}

	let loading = $state(true);
	let conversations = $state.raw<Conversation[]>([]);
	let accounts = $state.raw<SocialAccount[]>([]);
	let knownPlatforms = $state.raw<string[]>([]);
	let messages = $state.raw<DirectMessage[]>([]);
	let syncStates = $state.raw<SyncState[]>([]);
	let selectedId = $state('');
	let error = $state('');
	let messageError = $state('');
	let messageErrorReference = $state('');
	let loadedWorkspace = $state('');
	let loadedKey = $state('');
	let dataWorkspaceId = $state('');
	let loadingMessages = $state(false);
	let loadingOlderMessages = $state(false);
	let olderMessageError = $state('');
	let messageNextCursor = $state('');
	let messageRequest = 0;
	let messageViewport = $state<HTMLElement>();
	let refreshing = $state(false);
	let sending = $state(false);
	let replyBody = $state('');
	let archived = $state(false);
	let platformFilter = $state('');
	let accountFilter = $state('');
	let nextCursor = $state('');
	let loadingMore = $state(false);
	let pageError = $state('');
	let toast = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let nowMs = $state(Date.now());
	let messagingFeatures = $state.raw<FeatureState[]>([]);

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const selected = $derived(conversations.find((conversation) => conversation.id === selectedId));
	const replyWindowClosed = $derived(
		Boolean(
			selected?.messaging_window_expires_at &&
			new Date(selected.messaging_window_expires_at).getTime() <= nowMs
		)
	);
	const actionableSyncStates = $derived(
		syncStates.filter(
			(state) => state.status === 'permission_required' || state.status === 'failed'
		)
	);
	const initialLoading = $derived(
		Boolean(workspaceId) && loading && dataWorkspaceId !== workspaceId
	);
	const messagingAllDisabled = $derived(
		accounts.length > 0 && allFeatureEffectiveDisabled(messagingFeatures, 'messaging')
	);
	const messagingReason = $derived(collectiveDisabledReason(messagingFeatures, 'messaging'));
	const messagingEmptyIsFeatureDisabled = $derived(
		messagingAllDisabled && conversations.length === 0 && !loading && !error
	);
	const showMessagingDisabledNotice = $derived(messagingAllDisabled && conversations.length > 0);
	const loadKey = $derived(
		`${workspaceId}:${platformFilter}:${accountFilter}:${archived ? 'archived' : 'active'}`
	);

	onMount(() => {
		void workspaceCtx.initialize();
		const interval = window.setInterval(() => (nowMs = Date.now()), 30_000);
		return () => window.clearInterval(interval);
	});

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspace) {
			loadedWorkspace = workspaceId;
			loadedKey = '';
			conversations = [];
			accounts = [];
			knownPlatforms = [];
			syncStates = [];
			nextCursor = '';
			pageError = '';
			selectedId = '';
			messages = [];
			messageNextCursor = '';
			olderMessageError = '';
			messageRequest += 1;
			platformFilter = '';
			accountFilter = '';
		}
	});

	$effect(() => {
		if (workspaceId && loadKey !== loadedKey) {
			loadedKey = loadKey;
			void loadConversations();
		}
	});

	async function loadMessagingFeatures(workspace: string, accs: SocialAccount[]) {
		messagingFeatures = await loadFeatureStates(workspace, accs);
	}

	async function loadConversations(cursor = '', append = false) {
		if (!workspaceId) return;
		if (append) {
			loadingMore = true;
			pageError = '';
		} else {
			loading = true;
			loadingMore = false;
			error = '';
			pageError = '';
			nextCursor = '';
		}
		const requestedWorkspace = workspaceId;
		const requestedKey = loadKey;
		const [conversationResponse, accountResponse] = await Promise.all([
			client.GET('/messages', {
				params: {
					query: {
						workspace_id: requestedWorkspace,
						platform: platformFilter || undefined,
						account_id: accountFilter || undefined,
						archived,
						limit: 100,
						cursor: cursor || undefined
					}
				}
			}),
			client.GET('/accounts', { params: { query: { workspace_id: requestedWorkspace } } })
		]);
		if (requestedWorkspace !== workspaceId || requestedKey !== loadKey) return;
		const { data, error: apiError } = conversationResponse;
		if (apiError) {
			if (append) pageError = apiError.detail || m.messages_page_failed();
			else error = apiError.detail || m.messages_load_failed();
		} else {
			const incoming = data?.items ?? [];
			const selectedConversation = conversations.find((item) => item.id === selectedId);
			conversations = sortConversations(
				append
					? appendConversations(conversations, incoming)
					: selectedConversation && !incoming.some((item) => item.id === selectedConversation.id)
						? [selectedConversation, ...incoming]
						: incoming
			);
			nextCursor = data?.next_cursor ?? '';
			syncStates = data?.sync_states ?? [];
			if (!accountResponse.error) {
				accounts = accountResponse.data ?? [];
				void loadMessagingFeatures(requestedWorkspace, accounts);
			}
			knownPlatforms = [
				...new Set([
					...conversations.map((conversation) => conversation.platform),
					...accounts.map((account) => account.platform)
				])
			].sort();
			dataWorkspaceId = requestedWorkspace;
		}
		if (append) loadingMore = false;
		else loading = false;
	}

	function appendConversations(current: Conversation[], incoming: Conversation[]) {
		const byID = new Map(current.map((conversation) => [conversation.id, conversation]));
		for (const conversation of incoming) {
			const existing = byID.get(conversation.id);
			if (
				!existing ||
				new Date(conversation.updated_at).getTime() > new Date(existing.updated_at).getTime()
			) {
				byID.set(conversation.id, conversation);
			}
		}
		return [...byID.values()];
	}

	function sortConversations(items: Conversation[]) {
		return [...items].sort((left, right) => {
			const leftTime = new Date(left.last_message_at || left.created_at).getTime();
			const rightTime = new Date(right.last_message_at || right.created_at).getTime();
			return rightTime - leftTime || right.id.localeCompare(left.id);
		});
	}

	async function selectConversation(conversation: Conversation) {
		selectedId = conversation.id;
		replyBody = '';
		await Promise.all([loadMessages(conversation.id), markConversationRead(conversation)]);
	}

	async function loadMessages(conversationId: string, cursor = '', prepend = false) {
		if (!workspaceId) return;
		const requestedWorkspace = workspaceId;
		const requestID = ++messageRequest;
		const anchor = prepend ? messageVisibleAnchor() : null;
		if (prepend) {
			loadingOlderMessages = true;
			olderMessageError = '';
		} else {
			loadingMessages = true;
			loadingOlderMessages = false;
			messageError = '';
			messageErrorReference = '';
			olderMessageError = '';
			messageNextCursor = '';
		}
		const {
			data,
			error: apiError,
			response
		} = await client.GET('/messages/{conversation_id}', {
			params: {
				path: { conversation_id: conversationId },
				query: { workspace_id: requestedWorkspace, limit: 200, cursor: cursor || undefined }
			}
		});
		if (
			requestID !== messageRequest ||
			selectedId !== conversationId ||
			workspaceId !== requestedWorkspace
		)
			return;
		if (apiError) {
			if (prepend) {
				olderMessageError = apiError.detail || m.messages_older_page_failed();
			} else {
				messageError =
					apiError.status === 404
						? m.messages_conversation_unavailable()
						: apiError.detail || m.messages_load_failed();
				if (apiError.status !== undefined && apiError.status >= 500) {
					messageErrorReference = response.headers.get('x-request-id') ?? '';
				}
				messages = [];
			}
		} else {
			const incoming = data?.items ?? [];
			messages = prepend ? mergeMessages(incoming, messages) : incoming;
			messageNextCursor = data?.next_cursor ?? '';
			await tick();
			if (prepend && anchor) restoreMessageVisibleAnchor(anchor);
			else if (!prepend) messageViewport?.scrollTo({ top: messageViewport.scrollHeight });
		}
		if (prepend) loadingOlderMessages = false;
		else loadingMessages = false;
	}

	function loadOlderMessages() {
		if (!selectedId || !messageNextCursor || loadingOlderMessages || olderMessageError) return;
		void loadMessages(selectedId, messageNextCursor, true);
	}

	function retryOlderMessages() {
		olderMessageError = '';
		loadOlderMessages();
	}

	function mergeMessages(older: DirectMessage[], current: DirectMessage[]) {
		const byID = new Map(older.map((message) => [message.id, message]));
		for (const message of current) byID.set(message.id, message);
		return [...byID.values()].sort((left, right) => {
			const leftTime = new Date(left.remote_created_at || left.created_at).getTime();
			const rightTime = new Date(right.remote_created_at || right.created_at).getTime();
			return (
				leftTime - rightTime ||
				left.created_at.localeCompare(right.created_at) ||
				left.id.localeCompare(right.id)
			);
		});
	}

	function messageVisibleAnchor(): { id: string; top: number } | null {
		if (!messageViewport) return null;
		const viewportBounds = messageViewport.getBoundingClientRect();
		for (const element of messageViewport.querySelectorAll<HTMLElement>('[data-message-id]')) {
			const bounds = element.getBoundingClientRect();
			if (bounds.bottom > viewportBounds.top && bounds.top < viewportBounds.bottom) {
				return { id: element.dataset.messageId ?? '', top: bounds.top };
			}
		}
		return null;
	}

	function restoreMessageVisibleAnchor(anchor: { id: string; top: number }) {
		if (!messageViewport || !anchor.id) return;
		const element = messageViewport.querySelector<HTMLElement>(
			`[data-message-id="${CSS.escape(anchor.id)}"]`
		);
		if (element) messageViewport.scrollTop += element.getBoundingClientRect().top - anchor.top;
	}

	const observeOlderMessages: SvelteAttachment<HTMLElement> = (element) => {
		if (!('IntersectionObserver' in window)) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadOlderMessages();
			},
			{ root: messageViewport, rootMargin: '120px 0px 0px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	};

	async function markConversationRead(conversation: Conversation) {
		if (!workspaceId || conversation.unread_count === 0) return;
		const requestedWorkspace = workspaceId;
		const { error: apiError } = await client.POST('/messages/{conversation_id}/state', {
			params: { path: { conversation_id: conversation.id } },
			body: { workspace_id: requestedWorkspace, read: true }
		});
		if (requestedWorkspace !== workspaceId) return;
		if (apiError) {
			showToast(m.messages_mark_read_failed(), 'error');
			return;
		}
		conversations = conversations.map((item) =>
			item.id === conversation.id ? { ...item, unread_count: 0 } : item
		);
	}

	async function setArchived(conversation: Conversation) {
		if (!workspaceId) return;
		const requestedWorkspace = workspaceId;
		const { error: apiError } = await client.POST('/messages/{conversation_id}/state', {
			params: { path: { conversation_id: conversation.id } },
			body: { workspace_id: workspaceId, archived: !conversation.archived_at }
		});
		if (requestedWorkspace !== workspaceId) return;
		if (apiError) {
			showToast(m.messages_send_failed(), 'error');
			return;
		}
		selectedId = '';
		messages = [];
		await loadConversations();
	}

	async function sendMessage() {
		if (!workspaceId || !selected || !replyBody.trim() || replyWindowClosed || messagingAllDisabled)
			return;
		sending = true;
		const body = replyBody.trim();
		const { data, error: apiError } = await client.POST('/messages/{conversation_id}/send', {
			params: { path: { conversation_id: selected.id } },
			body: { workspace_id: workspaceId, message: body }
		});
		sending = false;
		if (apiError) {
			showToast(apiError.detail || m.messages_send_failed(), 'error');
			return;
		}
		if (data) messages = mergeMessages([], [...messages, data]);
		replyBody = '';
		showToast(m.messages_queued(), 'success');
	}

	async function refresh() {
		if (!workspaceId || messagingAllDisabled) return;
		refreshing = true;
		const { data, error: apiError } = await client.POST('/messages/refresh', {
			body: { workspace_id: workspaceId }
		});
		refreshing = false;
		const failed = apiError || data?.status === 'failed';
		const unavailable = data?.status === 'unavailable';
		showToast(
			unavailable
				? m.messaging_refresh_unavailable()
				: failed
					? m.messaging_refresh_failed()
					: m.messaging_refresh_queued(),
			failed || unavailable ? 'error' : 'success'
		);
	}

	function showToast(message: string, tone: 'success' | 'error') {
		toast = message;
		toastTone = tone;
	}

	function counterpartLabel(conversation: Conversation) {
		return (
			conversation.counterpart_name ||
			conversation.counterpart_handle ||
			conversation.remote_conversation_id
		);
	}

	function initials(value: string) {
		return value
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0] ?? '')
			.join('')
			.toUpperCase();
	}

	function dateLabel(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}

	function attachments(message: DirectMessage): Attachment[] {
		try {
			const parsed: AttachmentJSONValue = JSON.parse(message.attachments_json);
			if (!Array.isArray(parsed)) return [];
			const result: Attachment[] = [];
			for (const value of parsed) {
				const fields = attachmentFields(value);
				if (!fields) continue;
				const url = String(fields.url) === fields.url ? String(fields.url) : '';
				const type = String(fields.type) === fields.type ? String(fields.type) : '';
				if (!url || !type || !isSafeRemoteURL(url)) continue;
				const attachment: Attachment = { type, url };
				if (String(fields.name) === fields.name) attachment.name = String(fields.name);
				if (String(fields.thumbnail) === fields.thumbnail) {
					attachment.thumbnail = String(fields.thumbnail);
				}
				result.push(attachment);
			}
			return result;
		} catch {
			return [];
		}
	}

	function isSafeRemoteURL(value: string) {
		try {
			const url = new URL(value);
			return url.protocol === 'https:' || url.protocol === 'http:';
		} catch {
			return false;
		}
	}
</script>

<svelte:head>
	<title>{m.messages_heading()} · OpenPost</title>
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
	title={m.messages_heading()}
	description={m.messages_description()}
	icon={InboxIcon}
	loading={false}
	loadingLayout="list"
	loadingItems={6}
>
	{#snippet actions()}
		<Button
			variant="outline"
			onclick={refresh}
			disabled={refreshing || !workspaceId || messagingAllDisabled}
			data-testid="messages-refresh"
		>
			<RefreshIcon class={refreshing ? 'size-4 animate-spin' : 'size-4'} />
			{m.messaging_refresh()}
		</Button>
	{/snippet}

	<div class="space-y-5">
		<CommunicationsNavigation active="messages" />

		{#if showMessagingDisabledNotice}
			<div data-testid="messages-disabled-notice">
				<InlineNotice tone="warning" message={m.messages_feature_disabled_notice()}>
					{#snippet actions()}
						<Button
							href="/settings?tab=accounts"
							variant="outline"
							size="sm"
							data-testid="messages-disabled-recovery">{m.feature_disabled_open_details()}</Button
						>
					{/snippet}
					{#if messagingReason}
						<p class="mt-1 text-xs leading-5" data-testid="messages-disabled-reason">
							{messagingReason}
						</p>
					{/if}
				</InlineNotice>
			</div>
		{/if}
		{#each actionableSyncStates as state (state.id)}
			<InlineNotice
				tone={state.status === 'failed' ? 'error' : 'warning'}
				message={`${getPlatformName(state.platform)}: ${state.error_message || m.messages_sync_attention()}`}
			/>
		{/each}

		<div class="flex flex-wrap items-center gap-3">
			<Select.Root
				type="single"
				value={platformFilter || 'all'}
				onValueChange={(value) => {
					platformFilter = value === 'all' ? '' : value;
					const selectedAccount = accounts.find((account) => account.id === accountFilter);
					if (selectedAccount && platformFilter && selectedAccount.platform !== platformFilter) {
						accountFilter = '';
					}
				}}
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
			<Select.Root
				type="single"
				value={accountFilter || 'all'}
				onValueChange={(value) => (accountFilter = value === 'all' ? '' : value)}
			>
				<Select.Trigger class="h-11 w-48 sm:h-9" aria-label={m.engagement_all_accounts()}>
					{#if accountFilter}
						{@const selectedAccount = accounts.find((account) => account.id === accountFilter)}
						{selectedAccount?.account_username ||
							(selectedAccount
								? getPlatformName(selectedAccount.platform)
								: m.engagement_all_accounts())}
					{:else}
						{m.engagement_all_accounts()}
					{/if}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">{m.engagement_all_accounts()}</Select.Item>
					{#each accounts.filter((account) => !platformFilter || account.platform === platformFilter) as account (account.id)}
						<Select.Item value={account.id}>
							{account.account_username || getPlatformName(account.platform)}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<label class="flex min-h-11 items-center gap-2 text-sm">
				<Checkbox
					checked={archived}
					onCheckedChange={(checked) => {
						archived = checked;
					}}
				/>
				{m.engagement_archived()}
			</label>
		</div>

		{#if initialLoading}
			<PageLoading layout="list" label={m.common_loading()} items={6} />
		{:else if error && !messagingAllDisabled}
			<InlineNotice tone="error" message={error}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void loadConversations()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else if messagingEmptyIsFeatureDisabled}
			<EmptyState
				icon={InboxIcon}
				title={m.messages_feature_disabled_title()}
				description={m.messages_feature_disabled_description()}
				actionLabel={m.feature_disabled_open_details()}
				actionHref="/settings?tab=accounts"
				variant="muted"
			/>
			{#if messagingReason}
				<p
					class="mt-3 text-xs leading-5 text-muted-foreground"
					data-testid="messages-disabled-reason"
				>
					{messagingReason}
				</p>
			{/if}
		{:else if conversations.length === 0}
			<EmptyState
				icon={InboxIcon}
				title={m.messages_empty_title()}
				description={m.messages_empty_description()}
				variant="muted"
			/>
		{:else}
			<div
				class="min-h-[34rem] overflow-hidden rounded-lg border bg-card transition-opacity lg:grid lg:grid-cols-[20rem_minmax(0,1fr)]"
				class:opacity-70={loading}
				aria-busy={loading || loadingMore}
			>
				<section
					class={['border-r', selectedId ? 'hidden lg:block' : 'block']}
					aria-label={m.messages_heading()}
				>
					<div class="max-h-[42rem] divide-y overflow-y-auto">
						{#each conversations as conversation (conversation.id)}
							<button
								type="button"
								data-unread={conversation.unread_count > 0}
								class={[
									'flex min-h-20 w-full gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
									selectedId === conversation.id && 'bg-muted/60'
								]}
								onclick={() => void selectConversation(conversation)}
							>
								<div class="relative shrink-0">
									{#if conversation.counterpart_avatar_url}
										<img
											class="size-10 rounded-full object-cover"
											src={conversation.counterpart_avatar_url}
											alt=""
										/>
									{:else}
										<div
											class="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-semibold"
											aria-hidden="true"
										>
											{initials(counterpartLabel(conversation))}
										</div>
									{/if}
									<span
										class="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-card bg-muted"
									>
										<PlatformIcon platform={conversation.platform} class="size-3" />
									</span>
								</div>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2">
										<span class="truncate text-sm font-medium"
											>{counterpartLabel(conversation)}</span
										>
										{#if conversation.unread_count > 0}
											<span
												class="ms-auto size-2 shrink-0 rounded-full bg-primary"
												aria-hidden="true"
											></span>
										{/if}
									</span>
									<span class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
										{conversation.last_message_preview}
									</span>
								</span>
							</button>
						{/each}
					</div>
				</section>

				<section
					class={selectedId
						? 'flex max-h-[42rem] min-h-[34rem] flex-col'
						: 'hidden lg:flex lg:items-center lg:justify-center'}
				>
					{#if selected}
						<header class="flex min-h-16 items-center gap-3 border-b px-3 sm:px-4">
							<Button
								variant="ghost"
								size="icon"
								class="lg:hidden"
								aria-label={m.messages_back()}
								onclick={() => (selectedId = '')}
							>
								<ArrowLeftIcon class="size-4" />
							</Button>
							<div class="min-w-0 flex-1">
								<h2 class="truncate text-sm font-semibold">{counterpartLabel(selected)}</h2>
								<p class="truncate text-xs text-muted-foreground">{selected.counterpart_handle}</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								aria-label={selected.archived_at ? m.messages_restore() : m.messages_archive()}
								onclick={() => void setArchived(selected)}
							>
								<ArchiveIcon class="size-4" />
							</Button>
						</header>

						<div
							class="flex flex-1 flex-col gap-3 overflow-y-auto bg-muted/15 p-3 sm:p-5"
							aria-busy={loadingMessages || loadingOlderMessages}
							bind:this={messageViewport}
							data-testid="message-history"
						>
							{#if messageError}
								<InlineNotice tone="error" message={messageError}>
									{#if messageErrorReference}
										<p class="mt-1 font-mono text-xs">
											{m.messages_error_reference({ id: messageErrorReference })}
										</p>
									{/if}
									{#snippet actions()}
										<Button
											variant="outline"
											size="sm"
											onclick={() => void loadMessages(selected.id)}
										>
											<RefreshIcon class="mr-1.5 size-3.5" />
											{m.common_retry()}
										</Button>
									{/snippet}
								</InlineNotice>
							{:else if loadingMessages}
								<p class="text-sm text-muted-foreground">{m.common_loading()}</p>
							{:else}
								{#if messageNextCursor || olderMessageError}
									<div class="flex flex-col items-center gap-2" {@attach observeOlderMessages}>
										{#if olderMessageError}
											<InlineNotice tone="error" message={olderMessageError}>
												{#snippet actions()}
													<Button variant="outline" size="sm" onclick={retryOlderMessages}>
														{m.common_retry()}
													</Button>
												{/snippet}
											</InlineNotice>
										{:else}
											<Button
												variant="outline"
												size="sm"
												disabled={loadingOlderMessages}
												onclick={loadOlderMessages}
											>
												{loadingOlderMessages
													? m.common_loading()
													: m.messages_load_older_messages()}
											</Button>
										{/if}
									</div>
								{/if}
								{#each messages as message (message.id)}
									<div
										data-message-id={message.id}
										class={[
											'flex',
											message.direction === 'outbound' ? 'justify-end' : 'justify-start'
										]}
									>
										<div
											class={[
												'max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-xs sm:max-w-[72%]',
												message.direction === 'outbound'
													? 'rounded-br-sm bg-primary text-primary-foreground'
													: 'rounded-bl-sm border bg-background'
											]}
										>
											{#if message.body}<p class="leading-5 whitespace-pre-wrap">
													{message.body}
												</p>{/if}
											{#each attachments(message) as attachment (attachment.url)}
												<a
													class="mt-2 block break-all underline"
													href={attachment.url}
													target="_blank"
													rel="noreferrer"
												>
													{attachment.name || attachment.type}
												</a>
											{/each}
											<p
												class={[
													'mt-1 text-[10px]',
													message.direction === 'outbound'
														? 'text-primary-foreground/75'
														: 'text-muted-foreground'
												]}
											>
												{dateLabel(message.remote_created_at || message.created_at)}
												{#if message.send_status === 'queued'}
													· {m.messages_queued_status()}{/if}
												{#if message.send_status === 'failed'}
													· {m.messages_failed_status()}{/if}
											</p>
										</div>
									</div>
								{/each}
							{/if}
						</div>

						{#if !loadingMessages && !messageError}
							<div class="border-t p-3 sm:p-4" data-testid="conversation-reply-composer">
								{#if replyWindowClosed}
									<InlineNotice tone="warning" message={m.messages_window_closed()} />
								{:else}
									{#if selected.messaging_window_expires_at}
										<p class="mb-2 text-xs text-muted-foreground">
											{m.messages_window_until({
												date: dateLabel(selected.messaging_window_expires_at)
											})}
										</p>
									{/if}
									<form
										class="flex items-end gap-2"
										onsubmit={(event) => {
											event.preventDefault();
											void sendMessage();
										}}
									>
										<Textarea
											class="min-h-11 resize-none"
											bind:value={replyBody}
											placeholder={m.messages_reply_placeholder()}
											rows={2}
											required
											disabled={messagingAllDisabled}
										/>
										<Button
											type="submit"
											size="icon"
											class="mb-0.5 shrink-0"
											disabled={sending || !replyBody.trim() || messagingAllDisabled}
											aria-label={m.messages_send()}
										>
											<SendIcon class="size-4" />
										</Button>
									</form>
								{/if}
							</div>
						{/if}
					{:else}
						<EmptyState
							icon={InboxIcon}
							title={m.messages_select_title()}
							description={m.messages_select_description()}
							variant="muted"
						/>
					{/if}
				</section>
			</div>
			{#if pageError}
				<InlineNotice tone="error" message={pageError}>
					{#snippet actions()}
						<Button
							variant="outline"
							size="sm"
							onclick={() => void loadConversations(nextCursor, true)}
						>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			{:else if nextCursor}
				<div class="flex justify-center pt-2">
					<Button
						variant="outline"
						disabled={loadingMore}
						onclick={() => void loadConversations(nextCursor, true)}
					>
						{loadingMore ? m.common_loading() : m.messages_load_older_conversations()}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</PageContainer>
