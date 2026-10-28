<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import {
		accountFeaturesQueryOptions,
		conversationsQueryOptions,
		inboxQueryKeys,
		messagesQueryOptions,
		workspaceAccountsQueryOptions,
		type ConversationPage,
		type MessagePage
	} from '@openpost/query-catalog';
	import { createInfiniteQuery, createQuery, type InfiniteData } from '@tanstack/svelte-query';
	import { onMount, tick } from 'svelte';
	import type { Attachment as SvelteAttachment } from 'svelte/attachments';
	import { resolve } from '$app/paths';
	import { accountFilterLabel, accountName } from '$lib/account-filter-label';
	import { inboxSendOperation } from '$lib/inbox-send-operation';
	import { auth } from '$lib/stores/auth';
	import { Input } from '$lib/components/ui/input';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { featureQueryAPI } from '$lib/query/features';
	import { InboxMessageQueryError, inboxQueryAPI } from '$lib/query/inbox';
	import { mergeInboxMessages } from '$lib/query/inbox-message-cache';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { getPlatformName } from '$lib/utils';
	import InboxUpdates from '$lib/components/inbox-updates.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import CommunicationsNavigation from '$lib/components/communications-navigation.svelte';
	import SocialAccountAvatar from '$lib/components/social-account-avatar.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { allFeatureEffectiveDisabled, collectiveDisabledReason } from '$lib/feature-disabled';

	type Conversation = components['schemas']['Conversation'];
	type DirectMessage = components['schemas']['DirectMessage'];
	type SocialAccount = components['schemas']['AccountResponse'];
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

	let selectedId = $state('');
	let selectedFallback = $state.raw<Conversation | undefined>();
	let loadedWorkspace = $state('');
	let appliedMessageScope = '';
	let appliedMessageData: InfiniteData<MessagePage> | undefined;
	let messageViewport = $state<HTMLElement>();
	let atLatestMessage = $state(true);
	let hasNewMessages = $state(false);
	let appliedLatestMessageId = '';
	let updateAnchor: { id: string; top: number } | null = null;
	let refreshing = $state(false);
	let sending = $state(false);
	let refreshSequence = 0;
	let sendSequence = 0;
	let replyBody = $state('');
	let archived = $state(false);
	let search = $state('');
	let unreadOnly = $state(false);
	let sendUncertain = $state(false);
	let retryingMessageId = $state('');
	let collectingHistory = $state(false);
	let platformFilter = $state('');
	let accountFilter = $state('');
	let toast = $state('');
	let toastTone = $state<'success' | 'error'>('success');
	let nowMs = $state(Date.now());

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const querySelectedID = $derived(loadedWorkspace === workspaceId ? selectedId : '');
	const conversationFilters = $derived({
		search: loadedWorkspace === workspaceId ? search : '',
		unreadOnly: loadedWorkspace === workspaceId && unreadOnly,
		platform: loadedWorkspace === workspaceId ? platformFilter : '',
		accountId: loadedWorkspace === workspaceId ? accountFilter : '',
		archived: loadedWorkspace === workspaceId ? archived : false,
		limit: 100
	});
	const conversationsQuery = createInfiniteQuery(() =>
		conversationsQueryOptions(inboxQueryAPI, workspaceId, conversationFilters)
	);
	const accountsQuery = createQuery(() => workspaceAccountsQueryOptions(queryAPI, workspaceId));
	const accounts = $derived(accountsQuery.data ?? []);
	const featuresQuery = createQuery(() =>
		accountFeaturesQueryOptions(
			featureQueryAPI,
			workspaceId,
			accounts.map((account) => account.id)
		)
	);
	const messagingFeatures = $derived(featuresQuery.data ?? []);
	const messageQuery = createInfiniteQuery(() =>
		messagesQueryOptions(inboxQueryAPI, workspaceId, querySelectedID, { limit: 200 })
	);
	const conversations = $derived(
		sortConversations(
			(conversationsQuery.data?.pages ?? []).reduce<Conversation[]>(
				(current, page) => appendConversations(current, page.items ?? []),
				[]
			)
		)
	);
	const messages = $derived(combineMessagePages(messageQuery.data?.pages ?? []));
	const syncStates = $derived(conversationsQuery.data?.pages[0]?.sync_states ?? []);
	const knownPlatforms = $derived(
		[
			...new Set([
				...conversations.map((conversation) => conversation.platform),
				...accounts.map((account) => account.platform)
			])
		].sort()
	);
	const nextCursor = $derived(conversationsQuery.data?.pages.at(-1)?.next_cursor ?? '');
	const loadingMore = $derived(conversationsQuery.isFetchingNextPage);
	const loading = $derived(
		(conversationsQuery.isFetching && !conversationsQuery.isFetchingNextPage) ||
			accountsQuery.isFetching
	);
	const error = $derived(
		conversationsQuery.isError && !conversationsQuery.data
			? queryErrorMessage(conversationsQuery.error, m.messages_load_failed())
			: ''
	);
	const backgroundError = $derived.by(() => {
		if (
			conversationsQuery.isError &&
			conversationsQuery.data &&
			!conversationsQuery.isFetchNextPageError
		) {
			return queryErrorMessage(conversationsQuery.error, m.messages_load_failed());
		}
		if (accountsQuery.isError)
			return queryErrorMessage(accountsQuery.error, m.messages_load_failed());
		if (featuresQuery.isError)
			return queryErrorMessage(featuresQuery.error, m.messages_load_failed());
		return '';
	});
	const pageError = $derived(
		conversationsQuery.isFetchNextPageError
			? queryErrorMessage(conversationsQuery.error, m.messages_page_failed())
			: ''
	);
	const loadingMessages = $derived(
		Boolean(querySelectedID) && messageQuery.isPending && !messageQuery.data
	);
	const loadingOlderMessages = $derived(messageQuery.isFetchingNextPage);
	const messageError = $derived(
		messageQuery.isError && !messageQuery.data ? messageQueryError(messageQuery.error) : ''
	);
	const messageBackgroundError = $derived(
		messageQuery.isError && messageQuery.data && !messageQuery.isFetchNextPageError
			? messageQueryError(messageQuery.error)
			: ''
	);
	const messageErrorReference = $derived(
		messageQuery.error instanceof InboxMessageQueryError ? messageQuery.error.requestId : ''
	);
	const olderMessageError = $derived(
		messageQuery.isFetchNextPageError
			? queryErrorMessage(messageQuery.error, m.messages_older_page_failed())
			: ''
	);
	const messageNextCursor = $derived(messageQuery.data?.pages.at(-1)?.next_cursor ?? '');
	const selected = $derived(
		messageQuery.data?.pages[0]?.conversation ??
			conversations.find((conversation) => conversation.id === querySelectedID) ??
			(selectedFallback?.id === querySelectedID ? selectedFallback : undefined)
	);
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
		Boolean(workspaceId) &&
			((conversationsQuery.isPending && !conversationsQuery.data) ||
				(accountsQuery.isPending && !accountsQuery.data) ||
				(accounts.length > 0 && featuresQuery.isPending && !featuresQuery.data)) &&
			!error
	);
	const messagingAllDisabled = $derived(
		accounts.length > 0 && allFeatureEffectiveDisabled(messagingFeatures, 'messaging')
	);
	const hasConversationFilters = $derived(
		Boolean(platformFilter || accountFilter || archived || search || unreadOnly)
	);
	const messagingReason = $derived(collectiveDisabledReason(messagingFeatures, 'messaging'));
	const messagingEmptyIsFeatureDisabled = $derived(
		messagingAllDisabled && conversations.length === 0 && !loading && !error
	);
	const showMessagingDisabledNotice = $derived(messagingAllDisabled && conversations.length > 0);

	onMount(() => {
		void workspaceCtx.initialize();
		const interval = window.setInterval(() => (nowMs = Date.now()), 30_000);
		return () => window.clearInterval(interval);
	});

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspace) {
			refreshSequence++;
			sendSequence++;
			refreshing = false;
			sending = false;
			loadedWorkspace = workspaceId;
			selectedId = '';
			selectedFallback = undefined;
			appliedMessageData = undefined;
			appliedMessageScope = '';
			archived = false;
			platformFilter = '';
			accountFilter = '';
			search = '';
			unreadOnly = false;
			replyBody = '';
			sendUncertain = false;
		}
	});

	$effect.pre(() => {
		void messageQuery.data;
		updateAnchor = messageVisibleAnchor();
	});

	$effect(() => {
		const data = messageQuery.data;
		const scope = `${workspaceId}:${selectedId}`;
		if (!data || !selectedId || (data === appliedMessageData && scope === appliedMessageScope))
			return;
		const opening = scope !== appliedMessageScope;
		const latestId = messages.at(-1)?.id ?? '';
		const latestChanged = latestId !== appliedLatestMessageId;
		appliedMessageData = data;
		appliedMessageScope = scope;
		appliedLatestMessageId = latestId;
		if (opening || (latestChanged && atLatestMessage)) {
			void scrollToLatestMessage(scope);
		} else {
			if (latestChanged) hasNewMessages = true;
			const anchor = updateAnchor;
			if (anchor)
				void tick().then(() => {
					if (`${workspaceId}:${selectedId}` === scope) restoreMessageVisibleAnchor(anchor);
				});
		}
	});

	function trackMessageScroll() {
		if (!messageViewport) return;
		atLatestMessage =
			messageViewport.scrollHeight - messageViewport.scrollTop - messageViewport.clientHeight < 48;
		if (atLatestMessage) hasNewMessages = false;
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
		selectedFallback = conversation;
		replyBody = '';
		sendUncertain = false;
		await markConversationRead(conversation);
	}

	function clearSelectedConversation() {
		selectedId = '';
		selectedFallback = undefined;
	}

	function clearConversationFilters() {
		platformFilter = '';
		accountFilter = '';
		archived = false;
		search = '';
		unreadOnly = false;
		clearSelectedConversation();
	}

	async function loadOlderMessages() {
		if (!selectedId || !messageNextCursor || loadingOlderMessages) return;
		const anchor = messageVisibleAnchor();
		const result = await messageQuery.fetchNextPage();
		if (result.isError || !anchor) return;
		await tick();
		restoreMessageVisibleAnchor(anchor);
	}

	async function scrollToLatestMessage(scope: string) {
		await tick();
		if (`${workspaceId}:${selectedId}` !== scope) return;
		messageViewport?.scrollTo({ top: messageViewport.scrollHeight });
		atLatestMessage = true;
		hasNewMessages = false;
	}

	function combineMessagePages(pages: MessagePage[]) {
		return pages.reduce<DirectMessage[]>(
			(current, page, index) =>
				index === 0 ? (page.items ?? []) : mergeInboxMessages(page.items ?? [], current),
			[]
		);
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
		const view = captureConversationMutationView(conversation.id);
		const { error: apiError, response } = await client.POST('/messages/{conversation_id}/state', {
			params: { path: { conversation_id: conversation.id } },
			body: { workspace_id: view.workspaceID, read: true }
		});
		if (!settleQueryMutationSession(view.session, response)) return;
		if (apiError) {
			if (conversationMutationTargetIsCurrent(view)) {
				showToast(m.messages_mark_read_failed(), 'error');
			}
			return;
		}
		const reconciled = await reconcileQueryMutation(queryClient, view.session, {
			cancel: [{ queryKey: inboxQueryKeys.conversationsRoot(view.workspaceID) }],
			reconcile: () =>
				updateConversations(view.queryKey, (items) =>
					items.map((item) =>
						item.id === view.conversationID ? { ...item, unread_count: 0 } : item
					)
				),
			invalidate: [
				{
					queryKey: inboxQueryKeys.conversationsRoot(view.workspaceID),
					refetchType: 'none'
				}
			]
		});
		if (!reconciled || !conversationMutationViewIsCurrent(view)) return;
		if (selectedFallback?.id === view.conversationID) {
			selectedFallback = { ...selectedFallback, unread_count: 0 };
		}
	}

	async function setArchived(conversation: Conversation) {
		if (!workspaceId) return;
		const view = captureConversationMutationView(conversation.id);
		const { error: apiError, response } = await client.POST('/messages/{conversation_id}/state', {
			params: { path: { conversation_id: conversation.id } },
			body: { workspace_id: view.workspaceID, archived: !conversation.archived_at }
		});
		if (!settleQueryMutationSession(view.session, response)) return;
		if (apiError) {
			if (conversationMutationTargetIsCurrent(view)) showToast(m.messages_send_failed(), 'error');
			return;
		}
		const reconciled = await reconcileQueryMutation(queryClient, view.session, {
			cancel: [{ queryKey: inboxQueryKeys.conversationsRoot(view.workspaceID) }],
			reconcile: () =>
				updateConversations(view.queryKey, (items) =>
					items.filter((item) => item.id !== view.conversationID)
				),
			invalidate: [
				{
					queryKey: inboxQueryKeys.conversationsRoot(view.workspaceID),
					refetchType: 'none'
				}
			]
		});
		if (!reconciled || !conversationMutationViewIsCurrent(view)) return;
		if (selectedId === view.conversationID) {
			selectedId = '';
			selectedFallback = undefined;
		}
	}

	async function sendMessage() {
		if (
			sending ||
			!workspaceId ||
			!selected ||
			!replyBody.trim() ||
			replyWindowClosed ||
			messagingAllDisabled
		)
			return;
		const identity = auth.captureIdentity();
		if (!identity) return;
		const view = captureConversationMutationView(selected.id);
		const sequence = ++sendSequence;
		sending = true;
		sendUncertain = false;
		const submittedDraft = replyBody;
		const body = submittedDraft.trim();
		try {
			const operation = await inboxSendOperation(
				identity.userID,
				view.workspaceID,
				view.conversationID,
				body
			);
			if (!conversationMutationTargetIsCurrent(view)) return;
			const pendingOlderPage = messageQuery.isFetchingNextPage
				? messageQuery.fetchNextPage({ cancelRefetch: false })
				: null;
			const {
				data,
				error: problem,
				response
			} = await client.POST('/messages/{conversation_id}/send', {
				params: { path: { conversation_id: view.conversationID } },
				body: { workspace_id: view.workspaceID, message: body, client_operation_id: operation.id }
			});
			if (!settleQueryMutationSession(view.session, response)) return;
			if (problem || !data) {
				if (conversationMutationTargetIsCurrent(view)) {
					sendUncertain = response.status >= 500 || response.status === 408;
					showToast(
						sendUncertain
							? m.messages_send_uncertain()
							: problem?.detail || m.messages_send_failed(),
						'error'
					);
				}
				return;
			}
			operation.complete();
			const queryKey = inboxQueryKeys.messages(view.workspaceID, view.conversationID, {
				limit: 200
			});
			if (!(await reconcileSentMessage(view, queryKey, data, pendingOlderPage))) return;
			await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [
					{ queryKey: inboxQueryKeys.conversationsRoot(view.workspaceID), refetchType: 'none' }
				]
			});
			if (conversationMutationTargetIsCurrent(view)) {
				if (replyBody === submittedDraft) replyBody = '';
				showToast(
					data.send_status === 'sent' ? m.messages_sent_status() : m.messages_queued(),
					'success'
				);
			}
		} catch {
			if (conversationMutationTargetIsCurrent(view)) {
				sendUncertain = true;
				showToast(m.messages_send_uncertain(), 'error');
			}
		} finally {
			if (sequence === sendSequence) sending = false;
		}
	}

	async function retryMessage(message: DirectMessage) {
		if (retryingMessageId || !selected) return;
		const view = captureConversationMutationView(selected.id);
		retryingMessageId = message.id;
		try {
			const {
				data,
				error: problem,
				response
			} = await client.POST('/messages/{conversation_id}/retry', {
				params: { path: { conversation_id: view.conversationID } },
				body: { workspace_id: view.workspaceID, message_id: message.id }
			});
			if (!settleQueryMutationSession(view.session, response)) return;
			if (problem || !data) {
				if (conversationMutationTargetIsCurrent(view))
					showToast(
						response.status === 409 ? m.messages_retry_unsafe() : m.messages_send_failed(),
						'error'
					);
				return;
			}
			await reconcileSentMessage(
				view,
				inboxQueryKeys.messages(view.workspaceID, view.conversationID, { limit: 200 }),
				data,
				null
			);
		} catch {
			if (conversationMutationTargetIsCurrent(view)) showToast(m.messages_send_failed(), 'error');
		} finally {
			retryingMessageId = '';
		}
	}

	async function collectHistory() {
		if (collectingHistory || !selected) return;
		const view = captureConversationMutationView(selected.id);
		collectingHistory = true;
		try {
			const { error: problem, response } = await client.POST(
				'/messages/{conversation_id}/history',
				{
					params: { path: { conversation_id: view.conversationID } },
					body: { workspace_id: view.workspaceID }
				}
			);
			if (
				!settleQueryMutationSession(view.session, response) ||
				!conversationMutationTargetIsCurrent(view)
			)
				return;
			if (problem) showToast(m.messages_older_page_failed(), 'error');
			else {
				showToast(m.messages_history_queued(), 'success');
			}
		} catch {
			if (conversationMutationTargetIsCurrent(view))
				showToast(m.messages_older_page_failed(), 'error');
		} finally {
			collectingHistory = false;
		}
	}

	async function refresh() {
		if (!workspaceId || messagingAllDisabled) return;
		const view = captureConversationMutationView(selectedId);
		const sequence = ++refreshSequence;
		refreshing = true;
		const {
			data,
			error: apiError,
			response
		} = await client.POST('/messages/refresh', {
			body: { workspace_id: view.workspaceID }
		});
		const sessionIsCurrent = settleQueryMutationSession(view.session, response);
		if (sequence === refreshSequence) refreshing = false;
		if (!sessionIsCurrent) return;
		const failed = apiError || data?.status === 'failed';
		const unavailable = data?.status === 'unavailable';
		if (conversationMutationViewIsCurrent(view)) {
			showToast(
				unavailable
					? m.messaging_refresh_unavailable()
					: failed
						? m.messaging_refresh_failed()
						: m.messaging_refresh_queued(),
				failed || unavailable ? 'error' : 'success'
			);
		}
		if (!failed && !unavailable) {
			await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [
					{
						queryKey: inboxQueryKeys.conversationsRoot(view.workspaceID),
						refetchType: 'none'
					},
					...(view.conversationID
						? [
								{
									queryKey: inboxQueryKeys.messagesRoot(view.workspaceID, view.conversationID),
									refetchType: 'none' as const
								}
							]
						: [])
				]
			});
		}
	}

	type ConversationQueryKey = ReturnType<typeof inboxQueryKeys.conversations>;

	interface ConversationMutationView {
		readonly session: QueryMutationSession;
		readonly workspaceID: string;
		readonly conversationID: string;
		readonly queryKey: ConversationQueryKey;
		readonly viewKey: string;
	}

	function conversationViewKey() {
		return JSON.stringify([
			workspaceId,
			platformFilter,
			accountFilter,
			archived,
			search,
			unreadOnly
		]);
	}

	function captureConversationMutationView(conversationID: string): ConversationMutationView {
		return {
			session: captureQueryMutationSession(),
			workspaceID: workspaceId,
			conversationID,
			queryKey: inboxQueryKeys.conversations(workspaceId, conversationFilters),
			viewKey: conversationViewKey()
		};
	}

	function conversationMutationViewIsCurrent(view: ConversationMutationView) {
		return (
			view.workspaceID === workspaceId &&
			view.viewKey === conversationViewKey() &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function conversationMutationTargetIsCurrent(view: ConversationMutationView) {
		return conversationMutationViewIsCurrent(view) && selectedId === view.conversationID;
	}

	async function reconcileSentMessage(
		view: ConversationMutationView,
		queryKey: ReturnType<typeof inboxQueryKeys.messages>,
		message: DirectMessage,
		pendingOlderPage: Promise<unknown> | null
	) {
		const reconcile = () => {
			queryClient.setQueryData<InfiniteData<MessagePage, string>>(queryKey, (current) => {
				if (!current?.pages[0]) return current;
				const pages = [...current.pages];
				pages[0] = {
					...pages[0],
					items: mergeInboxMessages([], [...(pages[0].items ?? []), message])
				};
				return { ...current, pages };
			});
		};
		const apply = () =>
			reconcileQueryMutation(queryClient, view.session, {
				cancel: pendingOlderPage ? undefined : [{ queryKey, exact: true }],
				reconcile,
				invalidate: [{ queryKey, exact: true, refetchType: 'none' }]
			});
		const reconciled = await apply();
		if (pendingOlderPage) {
			void pendingOlderPage
				.then(async () => {
					await reconcileQueryMutation(queryClient, view.session, {
						reconcile,
						invalidate: [{ queryKey, exact: true, refetchType: 'none' }]
					});
				})
				.catch(() => undefined);
		}
		return reconciled;
	}

	function updateConversations(
		queryKey: ReturnType<typeof inboxQueryKeys.conversations>,
		updateItems: (items: Conversation[]) => Conversation[]
	) {
		queryClient.setQueryData<InfiniteData<ConversationPage, string>>(queryKey, (data) =>
			data
				? {
						...data,
						pages: data.pages.map((page) => ({
							...page,
							items: updateItems(page.items ?? [])
						}))
					}
				: data
		);
	}

	function queryErrorMessage(cause: unknown, fallback: string) {
		return cause instanceof Error && cause.message ? cause.message : fallback;
	}

	function retryReads() {
		if (conversationsQuery.isError) void conversationsQuery.refetch();
		if (accountsQuery.isError) void accountsQuery.refetch();
		if (featuresQuery.isError) void featuresQuery.refetch();
	}

	function messageQueryError(cause: unknown) {
		if (cause instanceof InboxMessageQueryError && cause.status === 404) {
			return m.messages_conversation_unavailable();
		}
		return queryErrorMessage(cause, m.messages_load_failed());
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
	<title>{m.messages_heading()} · {appBranding.profile.display_name}</title>
</svelte:head>

{#if toast}
	<AppToast
		message={toast}
		tone={toastTone}
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (toast = '')}
	/>
{/if}

{#snippet conversationFilterControls()}
	<div class="flex flex-wrap items-center gap-3">
		<Input
			value={search}
			oninput={(event) => {
				search = event.currentTarget.value;
				clearSelectedConversation();
			}}
			placeholder={m.messages_search()}
			aria-label={m.messages_search()}
			class="w-64 max-w-full"
		/>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><Checkbox
				checked={unreadOnly}
				onCheckedChange={(checked) => {
					unreadOnly = checked;
					clearSelectedConversation();
				}}
			/>{m.engagement_unread_only()}</label
		>
		<Select.Root
			type="single"
			value={platformFilter || 'all'}
			onValueChange={(value) => {
				platformFilter = value === 'all' ? '' : value;
				clearSelectedConversation();
				const selectedAccount = accounts.find((account) => account.id === accountFilter);
				if (selectedAccount && platformFilter && selectedAccount.platform !== platformFilter) {
					accountFilter = '';
				}
			}}
		>
			<Select.Trigger class="h-11 w-44 max-w-full sm:h-9" aria-label={m.engagement_all_platforms()}>
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
			onValueChange={(value) => {
				accountFilter = value === 'all' ? '' : value;
				clearSelectedConversation();
			}}
		>
			<Select.Trigger
				class="h-11 w-60 max-w-full sm:h-9"
				aria-label={accountFilterLabel(accounts.find((account) => account.id === accountFilter))}
			>
				{#if accountFilter}
					{@const selectedAccount = accounts.find((account) => account.id === accountFilter)}
					{#if selectedAccount}
						<SocialAccountIdentity
							name={accountName(selectedAccount)}
							platform={selectedAccount.platform}
							avatarUrl={selectedAccount.account_avatar_url}
							size="sm"
						/>
					{:else}
						{m.engagement_all_accounts()}
					{/if}
				{:else}
					{m.engagement_all_accounts()}
				{/if}
			</Select.Trigger>
			<Select.Content class="w-72 max-w-[calc(100vw-1rem)]">
				<Select.Item value="all" class="min-h-11">{m.engagement_all_accounts()}</Select.Item>
				{#each accounts.filter((account) => !platformFilter || account.platform === platformFilter) as account (account.id)}
					<Select.Item value={account.id} class="min-h-12 py-2">
						<SocialAccountIdentity
							name={accountName(account)}
							platform={account.platform}
							avatarUrl={account.account_avatar_url}
						/>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<label class="flex min-h-11 items-center gap-2 text-sm">
			<Checkbox
				checked={archived}
				onCheckedChange={(checked) => {
					archived = checked;
					clearSelectedConversation();
				}}
			/>
			{m.engagement_archived()}
		</label>
	</div>
{/snippet}

<PageContainer
	title={m.messages_heading()}
	description={m.messages_description()}
	themeIconRole="inbox"
	loading={initialLoading}
	loadingLayout="list"
	loadingItems={6}
	contentLayout="fill"
>
	{#snippet actions()}
		<Button
			variant="outline"
			onclick={refresh}
			disabled={refreshing || !workspaceId || messagingAllDisabled}
			data-testid="messages-refresh"
		>
			<ThemeIcon
				role="refresh"
				class={refreshing ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
			/>
			{m.messaging_refresh()}
		</Button>
	{/snippet}

	{#snippet navigation()}
		<div class="space-y-5">
			<CommunicationsNavigation active="messages" />
			<div class="hidden sm:block">{@render conversationFilterControls()}</div>
			<div class="sm:hidden">
				<Popover.Root>
					<Popover.Trigger>
						{#snippet child({ props })}<Button {...props} variant="outline"
								><ThemeIcon
									role="filter"
									class="size-4"
								/>{m.media_filters()}{#if hasConversationFilters}<span aria-hidden="true">•</span
									>{/if}</Button
							>{/snippet}
					</Popover.Trigger>
					<Popover.Content align="start" class="w-80 max-w-[calc(100vw-2rem)]"
						>{@render conversationFilterControls()}</Popover.Content
					>
				</Popover.Root>
			</div>
		</div>
	{/snippet}

	<div class="flex min-h-0 flex-1 flex-col gap-5">
		<InboxUpdates
			{workspaceId}
			view={querySelectedID ? 'conversation' : 'chats'}
			conversationId={querySelectedID}
			viewKey={conversationViewKey()}
		/>
		{#if backgroundError}
			<InlineNotice tone="error" message={backgroundError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryReads}>{m.common_retry()}</Button>
				{/snippet}
			</InlineNotice>
		{/if}

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

		{#if error && !messagingAllDisabled}
			<InlineNotice tone="error" message={error}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void conversationsQuery.refetch()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else if messagingEmptyIsFeatureDisabled}
			<EmptyState
				themeIconRole="inbox"
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
		{:else if conversationsQuery.data && conversations.length === 0 && hasConversationFilters}
			<EmptyState
				themeIconRole="inbox"
				title={archived ? m.messages_archived_empty_title() : m.messages_filtered_empty_title()}
				description={archived
					? m.messages_archived_empty_description()
					: m.messages_filtered_empty_description()}
				actionLabel={m.messages_clear_filters()}
				onAction={clearConversationFilters}
				variant="muted"
			/>
		{:else if conversationsQuery.data && conversations.length === 0}
			<EmptyState
				themeIconRole="inbox"
				title={m.messages_empty_title()}
				description={m.messages_empty_description()}
				actionLabel={m.feature_disabled_open_details()}
				actionHref="/settings?tab=accounts"
				variant="muted"
			/>
		{:else}
			<div
				class="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card transition-opacity lg:grid lg:grid-cols-[20rem_minmax(0,1fr)]"
				class:opacity-70={loading}
				aria-busy={loading || loadingMore}
			>
				<section
					class={['border-r', selectedId ? 'hidden lg:block' : 'block']}
					aria-label={m.messages_heading()}
				>
					<div class="h-full divide-y overflow-y-auto">
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
									<!-- The counterpart is a person, not a connected account. The platform
										badge marks the destination of the conversation. -->
									<SocialAccountAvatar
										name={counterpartLabel(conversation)}
										platform={conversation.platform}
										avatarUrl={conversation.counterpart_avatar_url}
										size="lg"
									/>
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
						? 'flex h-full min-h-0 flex-col'
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
								<ThemeIcon role="arrow-left" class="size-4" />
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
								<ThemeIcon role="archive" class="size-4" />
							</Button>
						</header>

						<div
							class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/15 p-3 sm:p-5"
							aria-busy={loadingMessages || loadingOlderMessages}
							bind:this={messageViewport}
							onscroll={trackMessageScroll}
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
										<Button variant="outline" size="sm" onclick={() => void messageQuery.refetch()}>
											<ThemeIcon role="refresh" class="mr-1.5 size-3.5" />
											{m.common_retry()}
										</Button>
									{/snippet}
								</InlineNotice>
							{:else if loadingMessages}
								<p class="text-sm text-muted-foreground">{m.common_loading()}</p>
							{:else}
								{#if messageBackgroundError}
									<InlineNotice tone="error" message={messageBackgroundError}>
										{#snippet actions()}
											<Button
												variant="outline"
												size="sm"
												onclick={() => void messageQuery.refetch()}>{m.common_retry()}</Button
											>
										{/snippet}
									</InlineNotice>
								{/if}
								{#if messageNextCursor || olderMessageError}
									<div class="flex flex-col items-center gap-2" {@attach observeOlderMessages}>
										{#if olderMessageError}
											<InlineNotice tone="error" message={olderMessageError}>
												{#snippet actions()}
													<Button variant="outline" size="sm" onclick={loadOlderMessages}>
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
								{#if !messageNextCursor && messageQuery.data?.pages[0]?.history_available}
									<div class="flex justify-center">
										<Button
											variant="outline"
											size="sm"
											onclick={collectHistory}
											disabled={collectingHistory}
											>{collectingHistory
												? m.common_loading()
												: m.messages_load_older_messages()}</Button
										>
									</div>
								{/if}
								{#each messages as message (message.id)}
									{@const messageAttachments = attachments(message)}
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
											{#if message.deleted_at && !message.deleted_at.startsWith('0001-')}<p
													class="text-sm italic"
												>
													{m.engagement_deleted_item()}
												</p>{:else if message.body}<p class="leading-5 whitespace-pre-wrap">
													{message.body}
												</p>{:else if messageAttachments.length === 0}<p class="text-sm italic">
													{m.messages_no_content()}
												</p>{/if}
											{#each messageAttachments as attachment (attachment.url)}
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
													'mt-1 text-xs',
													message.direction === 'outbound'
														? 'text-primary-foreground'
														: 'text-muted-foreground'
												]}
											>
												{dateLabel(message.remote_created_at || message.created_at)}
												{#if message.send_status === 'queued'}
													· {m.publication_delivery_queued()}{/if}
												{#if message.send_status === 'failed'}
													· {m.messages_failed_status()}{/if}
												{#if message.send_status === 'sent'}· {m.messages_sent_status()}{/if}
												{#if message.send_status === 'sending'}· {m.messages_sending_status()}{/if}
											</p>
											{#if message.send_status === 'failed' && message.error_message}<p
													class="mt-2 text-sm"
												>
													{message.error_message}
												</p>{/if}
											{#if message.send_status === 'failed'}<Button
													variant="outline"
													size="sm"
													onclick={() => void retryMessage(message)}
													disabled={Boolean(retryingMessageId)}>{m.common_retry()}</Button
												>{/if}
										</div>
									</div>
								{/each}
							{/if}
						</div>

						{#if hasNewMessages}
							<div class="flex justify-center border-t px-3 py-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => void scrollToLatestMessage(`${workspaceId}:${selectedId}`)}
									>{m.messages_new_messages()}</Button
								>
							</div>
						{/if}
						{#if !loadingMessages && !messageError}
							<div class="border-t p-3 sm:p-4" data-testid="conversation-reply-composer">
								{#if sendUncertain}<InlineNotice
										tone="warning"
										message={m.messages_send_uncertain()}
									/>{/if}
								{#if sending}<p role="status" class="mb-2 text-xs text-muted-foreground">
										{m.messages_sending()}
									</p>{/if}
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
											aria-label={m.messages_reply_placeholder()}
											rows={2}
											required
											disabled={messagingAllDisabled}
										/>
										<Button
											type="submit"
											size="icon"
											class="mb-0.5 shrink-0"
											disabled={sending || !replyBody.trim() || messagingAllDisabled}
											aria-label={sendUncertain ? m.common_retry() : m.messages_send()}
										>
											<ThemeIcon role="send" class="size-4" />
										</Button>
									</form>
								{/if}
							</div>
						{/if}
					{:else}
						<EmptyState
							themeIconRole="inbox"
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
							onclick={() => void conversationsQuery.fetchNextPage()}
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
						onclick={() => void conversationsQuery.fetchNextPage()}
					>
						{loadingMore ? m.common_loading() : m.messages_load_older_conversations()}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</PageContainer>
