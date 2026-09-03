<!--
	Direction — Communications / Engagement
	Intent: A scan-first operations queue for people managing replies across several accounts.
	World: Existing OpenPost application shell, typography, controls, and neutral surfaces.
	Density: Compact list rows with one expanded response area; filters stay above the queue.
	Composition: Provider identity and author lead; content and actions follow in reading order.
	Responsive: One column at every width, with controls wrapping into touch-safe rows on phones.
-->
<script lang="ts">
	import {
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
		accountFeaturesQueryOptions,
		engagementQueryOptions,
		inboxPublicationsQueryOptions,
		inboxQueryKeys,
		workspaceAccountsQueryOptions,
		type EngagementPage
	} from '@openpost/query-catalog';
	import { createInfiniteQuery, createQuery, type InfiniteData } from '@tanstack/svelte-query';
	import { onDestroy, onMount, tick } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import { featureQueryAPI } from '$lib/query/features';
	import { inboxQueryAPI } from '$lib/query/inbox';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';
	import PageContainer from '$lib/components/page-container.svelte';
	import CommunicationsNavigation from '$lib/components/communications-navigation.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import DestinationOptionCombobox from '$lib/components/destination-option-combobox.svelte';
	import { allFeatureEffectiveDisabled, collectiveDisabledReason } from '$lib/feature-disabled';

	type EngagementItem = components['schemas']['EngagementItem'];
	type Publication = components['schemas']['PublicationResponse'];
	type EngagementQueryKey = ReturnType<typeof inboxQueryKeys.engagement>;
	type EngagementMutationScope = {
		session: QueryMutationSession;
		workspaceID: string;
		itemID: string;
		queryKey: EngagementQueryKey;
		unreadOnly: boolean;
		viewKey: string;
	};

	let refreshing = $state(false);
	let refreshSequence = 0;
	let unreadOnly = $state(false);
	let archived = $state(false);
	let platformFilter = $state('');
	let selectedPublication = $state.raw<Publication | null>(null);
	let publicationSearch = $state('');
	let publicationQuerySearch = $state('');
	let publicationSearchTimer: ReturnType<typeof setTimeout> | undefined;
	let publicationWorkspaceId = $state('');
	let accountFilter = $state('');
	let publicationFilter = $state('');
	let replyItemId = $state('');
	let replyBody = $state('');
	let actionInFlight = $state('');
	let actionRequestSequence = 0;
	let appliedActionViewKey = '';
	let confirmItem = $state.raw<EngagementItem | null>(null);
	let confirmScope = $state.raw<EngagementMutationScope | null>(null);
	let confirmAction = $state<'hide' | 'delete'>('delete');
	let confirmDialogOpen = $state(false);
	let toast = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const queryAccountFilter = $derived(publicationWorkspaceId === workspaceId ? accountFilter : '');
	const queryPublicationFilter = $derived(
		publicationWorkspaceId === workspaceId ? publicationFilter : ''
	);
	const queryPublicationSearch = $derived(
		publicationWorkspaceId === workspaceId ? publicationQuerySearch : ''
	);
	const engagementFilters = $derived({
		platform: platformFilter,
		accountId: queryAccountFilter,
		publicationId: queryPublicationFilter,
		unreadOnly,
		archived,
		limit: 100
	});
	const engagementQuery = createInfiniteQuery(() =>
		engagementQueryOptions(inboxQueryAPI, workspaceId, engagementFilters)
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
	const engagementFeatures = $derived(featuresQuery.data ?? []);
	const publicationQuery = createInfiniteQuery(() =>
		inboxPublicationsQueryOptions(inboxQueryAPI, workspaceId, {
			search: queryPublicationSearch,
			limit: 50
		})
	);
	const items = $derived(
		appendUniqueByID(
			[],
			(engagementQuery.data?.pages ?? []).flatMap((page) => page.items ?? [])
		)
	);
	const total = $derived(engagementQuery.data?.pages[0]?.total ?? 0);
	const syncStates = $derived(engagementQuery.data?.pages[0]?.sync_states ?? []);
	const nextCursor = $derived(engagementQuery.data?.pages.at(-1)?.next_cursor ?? '');
	const loadingMore = $derived(engagementQuery.isFetchingNextPage);
	const loading = $derived(
		(engagementQuery.isFetching && !engagementQuery.isFetchingNextPage) || accountsQuery.isFetching
	);
	const error = $derived(
		engagementQuery.isError && !engagementQuery.data
			? queryErrorMessage(engagementQuery.error, m.engagement_load_failed())
			: ''
	);
	const backgroundError = $derived.by(() => {
		if (engagementQuery.isError && engagementQuery.data && !engagementQuery.isFetchNextPageError) {
			return queryErrorMessage(engagementQuery.error, m.engagement_load_failed());
		}
		if (accountsQuery.isError) {
			return queryErrorMessage(accountsQuery.error, m.engagement_load_failed());
		}
		if (featuresQuery.isError) {
			return queryErrorMessage(featuresQuery.error, m.engagement_load_failed());
		}
		return '';
	});
	const pageError = $derived(
		engagementQuery.isFetchNextPageError
			? queryErrorMessage(engagementQuery.error, m.engagement_page_failed())
			: ''
	);
	const publications = $derived(
		appendUniqueByID(
			[],
			(publicationQuery.data?.pages ?? []).flatMap((page) => page.items)
		)
	);
	const publicationCursor = $derived(publicationQuery.data?.pages.at(-1)?.nextCursor ?? '');
	const publicationLoading = $derived(
		publicationQuery.isPending || publicationQuery.isFetchingNextPage
	);
	const publicationError = $derived(
		publicationQuery.isError
			? queryErrorMessage(publicationQuery.error, m.engagement_publications_failed())
			: ''
	);
	const initialLoading = $derived(
		Boolean(workspaceId) &&
			((engagementQuery.isPending && !engagementQuery.data) ||
				(accountsQuery.isPending && !accountsQuery.data) ||
				(accounts.length > 0 && featuresQuery.isPending && !featuresQuery.data)) &&
			!error
	);
	const engagementAllDisabled = $derived(
		accounts.length > 0 && allFeatureEffectiveDisabled(engagementFeatures, 'engagement')
	);
	const engagementReason = $derived(collectiveDisabledReason(engagementFeatures, 'engagement'));
	const engagementEmptyIsFeatureDisabled = $derived(
		engagementAllDisabled && items.length === 0 && !initialLoading && !error
	);
	const showEngagementDisabledNotice = $derived(engagementAllDisabled && items.length > 0);
	const knownPlatforms = $derived(
		[
			...new Set([
				...items.map((item) => item.platform),
				...accounts.map((account) => account.platform)
			])
		].sort()
	);
	const confirmPlatformName = $derived(
		confirmItem ? getPlatformName(confirmItem.platform) : m.engagement_heading()
	);
	const filteredSyncStates = $derived(
		syncStates.filter(
			(state) =>
				!['ok', 'pending', 'unsupported'].includes(state.status) &&
				(!platformFilter || state.platform === platformFilter) &&
				(!accountFilter || state.social_account_id === accountFilter)
		)
	);
	const recoveryGroups = $derived.by(() => {
		const groups = new SvelteMap<
			string,
			{
				key: string;
				kind: 'reconnect' | 'retry' | 'unavailable' | 'investigate';
				account?: SocialAccount;
				platform: string;
				states: EngagementSyncState[];
			}
		>();
		for (const state of filteredSyncStates) {
			const kind = recoveryKind(state);
			const key = `${state.social_account_id}:${kind}:${state.error_code || state.status}`;
			const group = groups.get(key) ?? {
				key,
				kind,
				account: syncStateAccount(state),
				platform: state.platform,
				states: []
			};
			group.states.push(state);
			groups.set(key, group);
		}
		const priority = { reconnect: 0, investigate: 1, retry: 2, unavailable: 3 } as const;
		return [...groups.values()].toSorted(
			(left, right) => priority[left.kind] - priority[right.kind]
		);
	});
	const groupedItems = $derived.by(() => {
		const groups = new SvelteMap<
			string,
			{ key: string; items: EngagementItem[]; newest: number }
		>();
		for (const item of items) {
			const group = groups.get(item.rendition_id) ?? {
				key: item.rendition_id,
				items: [],
				newest: 0
			};
			group.items.push(item);
			group.newest = Math.max(
				group.newest,
				new Date(item.remote_created_at || item.created_at).getTime() || 0
			);
			groups.set(item.rendition_id, group);
		}
		return [...groups.values()]
			.map((group) => ({ ...group, items: orderThread(group.items) }))
			.toSorted((left, right) => right.newest - left.newest);
	});
	const publicationOptions = $derived.by(() => {
		const options = publications.map((publication) => ({
			value: publication.id,
			label: publicationLabel(publication)
		}));
		if (
			selectedPublication &&
			!options.some((option) => option.value === selectedPublication?.id)
		) {
			options.unshift({
				value: selectedPublication.id,
				label: publicationLabel(selectedPublication)
			});
		}
		return [{ value: '', label: m.engagement_all_posts() }, ...options];
	});

	onMount(() => void workspaceCtx.initialize());
	onDestroy(() => {
		if (publicationSearchTimer) clearTimeout(publicationSearchTimer);
	});

	$effect(() => {
		if (workspaceId && workspaceId !== publicationWorkspaceId) {
			refreshSequence++;
			refreshing = false;
			actionInFlight = '';
			replyItemId = '';
			replyBody = '';
			confirmItem = null;
			confirmScope = null;
			confirmDialogOpen = false;
			publicationWorkspaceId = workspaceId;
			selectedPublication = null;
			publicationFilter = '';
			accountFilter = '';
			publicationSearch = '';
			publicationQuerySearch = '';
		}
	});

	$effect(() => {
		const nextViewKey = engagementViewKey();
		if (nextViewKey === appliedActionViewKey) return;
		appliedActionViewKey = nextViewKey;
		actionRequestSequence += 1;
		actionInFlight = '';
	});

	function searchPublications(search: string) {
		publicationSearch = search;
		if (publicationSearchTimer) clearTimeout(publicationSearchTimer);
		publicationSearchTimer = setTimeout(() => (publicationQuerySearch = search), 250);
	}

	function selectPublication(value: string) {
		publicationFilter = value;
		selectedPublication = publications.find((publication) => publication.id === value) ?? null;
	}

	function appendUniqueByID<T extends { id: string }>(current: T[], incoming: T[]): T[] {
		return [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()];
	}

	function engagementVisibleAnchor(): { id: string; top: number } | null {
		for (const element of document.querySelectorAll<HTMLElement>('[data-engagement-id]')) {
			const bounds = element.getBoundingClientRect();
			if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
				return { id: element.dataset.engagementId ?? '', top: bounds.top };
			}
		}
		return null;
	}

	function restoreEngagementVisibleAnchor(anchor: { id: string; top: number }) {
		if (!anchor.id) return;
		const element = document.querySelector<HTMLElement>(
			`[data-engagement-id="${CSS.escape(anchor.id)}"]`
		);
		if (element) window.scrollBy({ top: element.getBoundingClientRect().top - anchor.top });
	}

	async function loadMoreEngagement() {
		const visibleAnchor = engagementVisibleAnchor();
		const result = await engagementQuery.fetchNextPage();
		if (result.isError || !visibleAnchor) return;
		await tick();
		restoreEngagementVisibleAnchor(visibleAnchor);
	}

	async function refresh() {
		if (!workspaceId || engagementAllDisabled) return;
		const view = captureEngagementMutationView('', unreadOnly);
		const sequence = ++refreshSequence;
		refreshing = true;
		const {
			data,
			error: apiError,
			response
		} = await client.POST('/engagement/refresh', {
			body: { workspace_id: view.workspaceID }
		});
		const sessionIsCurrent = settleQueryMutationSession(view.session, response);
		if (sequence === refreshSequence) refreshing = false;
		if (!sessionIsCurrent) return;
		const failed = apiError || data?.status === 'failed';
		const unavailable = data?.status === 'unavailable';
		if (engagementMutationViewIsCurrent(view)) {
			showToast(
				unavailable
					? m.engagement_refresh_unavailable()
					: failed
						? m.engagement_refresh_failed()
						: m.engagement_refresh_queued(),
				failed || unavailable ? 'error' : 'success'
			);
		}
		if (!failed && !unavailable) {
			await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [
					{
						queryKey: inboxQueryKeys.engagementRoot(view.workspaceID),
						refetchType: 'none'
					}
				]
			});
		}
	}

	async function setState(
		item: EngagementItem,
		state: { read?: boolean; archived?: boolean },
		announce = true,
		scope?: EngagementMutationScope
	) {
		const view = scope ?? captureEngagementMutationView(item.id, unreadOnly);
		if (!view.workspaceID || (!scope && engagementAllDisabled)) return false;
		const managesBusyState = scope === undefined;
		const requestSequence = managesBusyState ? ++actionRequestSequence : 0;
		if (managesBusyState && engagementMutationViewIsCurrent(view)) actionInFlight = item.id;
		try {
			const { error: apiError, response } = await client.POST('/engagement/state', {
				body: { workspace_id: view.workspaceID, ids: [item.id], ...state }
			});
			if (!settleQueryMutationSession(view.session, response)) return false;
			const scopeIsCurrent = engagementMutationViewIsCurrent(view);
			if (apiError) {
				if (announce && scopeIsCurrent) showToast(m.engagement_action_failed(), 'error');
				return false;
			}
			const reconciled = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: inboxQueryKeys.engagementRoot(view.workspaceID) }],
				reconcile: () => {
					if (state.archived !== undefined || (state.read && view.unreadOnly)) {
						updateEngagementData(view.queryKey, (page) => ({
							...page,
							items: (page.items ?? []).filter((candidate) => candidate.id !== item.id),
							total: Math.max(0, page.total - 1)
						}));
					} else if (state.read !== undefined) {
						updateEngagementData(view.queryKey, (page) => ({
							...page,
							items: (page.items ?? []).map((candidate) =>
								candidate.id === item.id
									? {
											...candidate,
											read_at: state.read ? new Date().toISOString() : undefined
										}
									: candidate
							)
						}));
					}
				},
				invalidate: [
					{
						queryKey: inboxQueryKeys.engagementRoot(view.workspaceID),
						refetchType: 'none'
					}
				]
			});
			if (!reconciled) return false;
			if (announce && engagementMutationViewIsCurrent(view)) {
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
		} finally {
			if (managesBusyState && requestSequence === actionRequestSequence) actionInFlight = '';
		}
	}

	async function queueAction(
		item: EngagementItem,
		action: 'reply' | 'hide' | 'delete' | 'like' | 'unlike',
		announce = true
	) {
		if (!workspaceId || engagementAllDisabled) return false;
		const scope = captureEngagementMutationView(item.id, unreadOnly);
		const requestSequence = ++actionRequestSequence;
		actionInFlight = item.id;
		try {
			const { error: apiError, response } = await client.POST('/engagement/{item_id}/actions', {
				params: { path: { item_id: item.id } },
				body: {
					workspace_id: scope.workspaceID,
					action,
					message: action === 'reply' ? replyBody.trim() : undefined
				}
			});
			if (!settleQueryMutationSession(scope.session, response)) return false;
			if (apiError) {
				if (announce && engagementMutationViewIsCurrent(scope)) {
					showToast(apiError.detail || m.engagement_action_failed(), 'error');
				}
				return false;
			}
			if (action === 'reply' && engagementMutationViewIsCurrent(scope) && replyItemId === item.id) {
				replyItemId = '';
				replyBody = '';
			}
			if (action === 'like' || action === 'unlike') {
				const liked = action === 'like';
				const reconciled = await reconcileQueryMutation(queryClient, scope.session, {
					cancel: [{ queryKey: inboxQueryKeys.engagementRoot(scope.workspaceID) }],
					reconcile: () =>
						updateEngagementData(scope.queryKey, (page) => ({
							...page,
							items: (page.items ?? []).map((candidate) =>
								candidate.id === item.id
									? { ...candidate, liked, can_like: !liked, can_unlike: liked }
									: candidate
							)
						}))
				});
				if (!reconciled) return false;
			}
			const stateUpdated = await setState(item, { read: true }, false, scope);
			if (!stateUpdated) return false;
			if (announce && engagementMutationViewIsCurrent(scope)) {
				showToast(m.engagement_action_queued(), 'success');
			}
			return engagementMutationViewIsCurrent(scope);
		} catch {
			if (announce && engagementMutationViewIsCurrent(scope)) {
				showToast(m.engagement_action_failed(), 'error');
			}
			return false;
		} finally {
			if (requestSequence === actionRequestSequence) actionInFlight = '';
		}
	}

	function engagementViewKey() {
		return JSON.stringify([
			workspaceId,
			platformFilter,
			accountFilter,
			publicationFilter,
			unreadOnly,
			archived
		]);
	}

	function captureEngagementMutationView(
		itemID: string,
		requestedUnreadOnly: boolean
	): EngagementMutationScope {
		return {
			session: captureQueryMutationSession(),
			workspaceID: workspaceId,
			itemID,
			queryKey: inboxQueryKeys.engagement(workspaceId, engagementFilters),
			unreadOnly: requestedUnreadOnly,
			viewKey: engagementViewKey()
		};
	}

	function engagementMutationViewIsCurrent(view: EngagementMutationScope) {
		return (
			view.workspaceID === workspaceId &&
			view.viewKey === engagementViewKey() &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function updateEngagementData(
		queryKey: ReturnType<typeof inboxQueryKeys.engagement>,
		updatePage: (page: EngagementPage) => EngagementPage
	) {
		queryClient.setQueryData<InfiniteData<EngagementPage, string>>(queryKey, (data) =>
			data ? { ...data, pages: data.pages.map(updatePage) } : data
		);
	}

	function queryErrorMessage(cause: unknown, fallback: string) {
		return cause instanceof Error && cause.message ? cause.message : fallback;
	}

	function retryReads() {
		if (engagementQuery.isError) void engagementQuery.refetch();
		if (accountsQuery.isError) void accountsQuery.refetch();
		if (featuresQuery.isError) void featuresQuery.refetch();
	}

	function showToast(message: string, tone: 'neutral' | 'success' | 'error') {
		toast = message;
		toastTone = tone;
	}

	function requestProviderAction(item: EngagementItem, action: 'hide' | 'delete') {
		confirmItem = item;
		confirmScope = captureEngagementMutationView(item.id, unreadOnly);
		confirmAction = action;
		confirmDialogOpen = true;
	}

	async function confirmProviderAction(): Promise<DestructiveActionOutcome> {
		const item = confirmItem;
		const scope = confirmScope;
		const action = confirmAction;
		if (!item || !scope || scope.itemID !== item.id || !engagementMutationViewIsCurrent(scope)) {
			return { ok: false };
		}
		const completed = await queueAction(item, action, false);
		if (
			confirmItem?.id !== item.id ||
			confirmScope !== scope ||
			!engagementMutationViewIsCurrent(scope)
		) {
			return { ok: false };
		}
		if (completed) {
			confirmItem = null;
			confirmScope = null;
		}
		return {
			ok: completed,
			message: completed ? undefined : m.engagement_action_failed(),
			successMessage: completed ? m.engagement_action_queued() : undefined
		};
	}

	function authorLabel(item: EngagementItem) {
		return item.author_name || item.author_handle || m.common_untitled_user();
	}

	function accountName(account: SocialAccount): string {
		return (
			formatSocialAccountName(account.account_username, account.platform) ||
			account.slug ||
			account.account_id ||
			account.platform
		);
	}

	function accountFilterLabel(account: SocialAccount | undefined): string {
		if (!account) return m.engagement_all_accounts();
		return `${m.engagement_all_accounts()}: ${accountName(account)}, ${getPlatformName(account.platform)}`;
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

	function publicationLabel(publication: Publication) {
		return (
			publication.title ||
			publication.source_text?.slice(0, 80) ||
			m.engagement_untitled_publication()
		);
	}

	function syncStateAccount(state: EngagementSyncState) {
		return accounts.find((account) => account.id === state.social_account_id);
	}

	function syncStateMessage(state: EngagementSyncState) {
		if (state.status === 'rate_limited') {
			return m.engagement_rate_limited({ date: dateLabel(state.next_sync_at) });
		}
		if (state.status === 'failed') return m.engagement_collection_failed();
		return state.error_message || m.engagement_sync_delayed();
	}

	function recoveryKind(state: EngagementSyncState) {
		const code = state.error_code.toLocaleLowerCase();
		if (
			state.status === 'permission_required' ||
			code.includes('permission') ||
			code.includes('auth')
		) {
			return 'reconnect' as const;
		}
		if (state.status === 'not_found') return 'unavailable' as const;
		if (
			state.status === 'rate_limited' ||
			state.status === 'temporarily_unavailable' ||
			Boolean(state.next_sync_at)
		) {
			return 'retry' as const;
		}
		return 'investigate' as const;
	}

	function recoveryRecommendation(
		kind: 'reconnect' | 'retry' | 'unavailable' | 'investigate',
		count: number
	) {
		if (kind === 'reconnect') return m.engagement_recovery_reconnect({ count });
		if (kind === 'retry') return m.engagement_recovery_retry({ count });
		if (kind === 'unavailable') return m.engagement_recovery_unavailable({ count });
		return m.engagement_recovery_investigate({ count });
	}

	function orderThread(source: EngagementItem[]) {
		const byParent = new SvelteMap<string, EngagementItem[]>();
		const ids = new SvelteSet(source.map((item) => item.remote_id));
		for (const item of source) {
			const parent = ids.has(item.parent_remote_id) ? item.parent_remote_id : '';
			byParent.set(parent, [...(byParent.get(parent) ?? []), item]);
		}
		const ordered: EngagementItem[] = [];
		const seen = new SvelteSet<string>();
		const append = (parent: string) => {
			for (const item of (byParent.get(parent) ?? []).toSorted(
				(left, right) =>
					new Date(left.remote_created_at || left.created_at).getTime() -
					new Date(right.remote_created_at || right.created_at).getTime()
			)) {
				if (seen.has(item.id)) continue;
				seen.add(item.id);
				ordered.push(item);
				append(item.remote_id);
			}
		};
		append('');
		for (const item of source) {
			if (!seen.has(item.id)) ordered.push(item);
		}
		return ordered;
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
	themeIconRole="communications"
	loading={initialLoading}
	loadingLayout="list"
	loadingItems={6}
>
	{#snippet actions()}
		{#if recoveryGroups.length > 0}
			<Popover.Root>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="outline">
							<ProtectedIcon icon="error" class="size-4 text-amber-600 dark:text-amber-400" />
							{m.engagement_collection_issues({ count: recoveryGroups.length })}
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="end" class="w-96 max-w-[calc(100vw-1rem)] overflow-hidden p-0">
					<div class="border-b px-4 py-3">
						<p class="text-sm font-semibold">{m.engagement_collection_issues_title()}</p>
						<p class="mt-1 text-xs leading-5 text-muted-foreground">
							{m.engagement_collection_issues_description()}
						</p>
					</div>
					<div class="max-h-80 divide-y overflow-y-auto">
						{#each recoveryGroups as group (group.key)}
							{@const state = group.states[0]}
							<div class="px-4 py-3">
								<SocialAccountIdentity
									name={group.account
										? accountName(group.account)
										: getPlatformName(group.platform)}
									platform={group.platform}
									avatarUrl={group.account?.account_avatar_url}
								/>
								<div class="mt-2 pl-11">
									<p class="text-xs font-medium text-foreground">
										{recoveryRecommendation(group.kind, group.states.length)}
									</p>
									<p class="mt-1 text-xs leading-5 text-muted-foreground">
										{syncStateMessage(state)}
									</p>
									{#if group.kind === 'reconnect'}
										<Button
											href="/settings?tab=accounts"
											variant="link"
											size="sm"
											class="mt-1 h-auto min-h-8 px-0"
										>
											{m.analytics_reconnect()}
										</Button>
									{:else if group.kind === 'retry' || group.kind === 'investigate'}
										<Button
											variant="link"
											size="sm"
											class="mt-1 h-auto min-h-8 px-0"
											onclick={refresh}
											disabled={refreshing}
										>
											{m.engagement_refresh()}
										</Button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Root>
		{/if}
		<Button
			variant="outline"
			onclick={refresh}
			disabled={refreshing || !workspaceId || engagementAllDisabled}
			data-testid="engagement-refresh"
		>
			<ThemeIcon role="refresh" class={refreshing ? 'size-4 animate-spin' : 'size-4'} />
			{m.engagement_refresh()}
		</Button>
	{/snippet}

	<div class="space-y-5">
		<CommunicationsNavigation active="engagement" />

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
				<Select.Trigger
					class="h-11 w-60 sm:h-9"
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
			<DestinationOptionCombobox
				id="engagement-publication-filter"
				value={publicationFilter}
				label={m.engagement_all_posts()}
				placeholder={m.engagement_all_posts()}
				searchPlaceholder={m.engagement_search_posts()}
				emptyLabel={m.engagement_no_posts_found()}
				loadingLabel={m.common_loading()}
				options={publicationOptions}
				loading={publicationLoading}
				hasMore={Boolean(publicationCursor)}
				loadMoreLabel={m.engagement_load_older_posts()}
				error={publicationError}
				retryLabel={m.common_retry()}
				class="max-w-80 min-w-52 sm:h-9"
				onValueChange={selectPublication}
				onSearch={searchPublications}
				onLoadMore={() => void publicationQuery.fetchNextPage()}
				onRetry={() => void publicationQuery.refetch()}
			/>
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
		{#if backgroundError}
			<InlineNotice tone="error" message={backgroundError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryReads}>{m.common_retry()}</Button>
				{/snippet}
			</InlineNotice>
		{/if}

		{#if showEngagementDisabledNotice}
			<div data-testid="engagement-disabled-notice">
				<InlineNotice tone="warning" message={m.engagement_feature_disabled_notice()}>
					{#snippet actions()}
						<Button
							href="/settings?tab=accounts"
							variant="outline"
							size="sm"
							data-testid="engagement-disabled-recovery">{m.feature_disabled_open_details()}</Button
						>
					{/snippet}
					{#if engagementReason}
						<p class="mt-1 text-xs leading-5" data-testid="engagement-disabled-reason">
							{engagementReason}
						</p>
					{/if}
				</InlineNotice>
			</div>
		{/if}
		{#if error && !engagementAllDisabled}
			<InlineNotice tone="error" message={error}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void engagementQuery.refetch()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else if engagementEmptyIsFeatureDisabled}
			<EmptyState
				themeIconRole="communications"
				title={m.engagement_feature_disabled_title()}
				description={m.engagement_feature_disabled_description()}
				actionLabel={m.feature_disabled_open_details()}
				actionHref="/settings?tab=accounts"
				variant="muted"
			/>
			{#if engagementReason}
				<p
					class="mt-3 text-xs leading-5 text-muted-foreground"
					data-testid="engagement-disabled-reason"
				>
					{engagementReason}
				</p>
			{/if}
		{:else if engagementQuery.data && items.length === 0 && !error}
			<EmptyState
				themeIconRole="communications"
				title={m.engagement_empty_title()}
				description={m.engagement_empty_description()}
				variant="muted"
			/>
		{:else if items.length > 0}
			<div
				class="space-y-4 transition-opacity"
				class:opacity-70={loading}
				aria-busy={loading || loadingMore}
			>
				{#each groupedItems as group (group.key)}
					{@const firstItem = group.items[0]}
					{@const account = accounts.find(
						(candidate) => candidate.id === firstItem.social_account_id
					)}
					<section class="overflow-hidden rounded-lg border bg-card">
						<header class="flex flex-wrap items-center gap-3 border-b bg-muted/25 px-4 py-3">
							<SocialAccountIdentity
								name={account
									? accountName(account)
									: formatSocialAccountName(firstItem.account_username || '', firstItem.platform) ||
										getPlatformName(firstItem.platform)}
								platform={firstItem.platform}
								avatarUrl={account?.account_avatar_url}
								detail={m.engagement_reply_count({ count: group.items.length })}
								class="max-w-full sm:max-w-52"
							/>
							<div class="min-w-0 flex-1">
								<h2 class="truncate text-sm font-semibold">
									{firstItem.publication_title ||
										firstItem.publication_excerpt ||
										m.engagement_untitled_publication()}
								</h2>
							</div>
							{#if firstItem.provider_post_url}
								<Button
									href={firstItem.provider_post_url}
									target="_blank"
									rel="noreferrer"
									variant="outline"
									size="sm"
								>
									<ThemeIcon role="external-link" class="size-4" />
									{m.engagement_open_provider({ platform: getPlatformName(firstItem.platform) })}
								</Button>
							{/if}
						</header>
						<div class="divide-y">
							{#each group.items as item (item.id)}
								{@const isRead = hasTimestamp(item.read_at)}
								{@const isDeleted = hasTimestamp(item.deleted_at)}
								{@const isChild = group.items.some(
									(candidate) => candidate.remote_id === item.parent_remote_id
								)}
								{@const attachments = item.attachments ?? []}
								<article
									data-engagement-id={item.id}
									class={[
										'p-4 sm:p-5',
										!isRead && 'bg-primary/[0.025]',
										isChild && 'ms-5 border-s sm:ms-10'
									]}
								>
									<div class="flex min-w-0 items-start gap-3">
										<div
											class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
											aria-hidden="true"
										>
											{authorLabel(item).slice(0, 1).toUpperCase()}
										</div>
										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
												<h3 class="truncate text-sm font-semibold">{authorLabel(item)}</h3>
												{#if item.author_handle}
													<span class="truncate text-xs text-muted-foreground">
														{item.author_handle}
													</span>
												{/if}
												<span class="text-xs text-muted-foreground">
													{dateLabel(item.remote_created_at || item.created_at)}
												</span>
												{#if hasTimestamp(item.edited_at) && !isDeleted}
													<span class="text-xs text-muted-foreground">{m.engagement_edited()}</span>
												{/if}
											</div>
											{#if isDeleted}
												<p class="mt-2 text-sm text-muted-foreground italic">
													{m.engagement_deleted_item()}
												</p>
											{:else}
												<p class="mt-2 max-w-3xl text-sm leading-6 whitespace-pre-wrap">
													{item.body}
												</p>
												{#if attachments.length}
													<div class="mt-3 flex flex-wrap gap-2">
														{#each attachments as attachment, index (`${attachment.url}:${index}`)}
															<Button
																href={attachment.url || attachment.thumbnail}
																target="_blank"
																rel="noreferrer"
																variant="outline"
																size="sm"
															>
																<ThemeIcon role="external-link" class="size-4" />
																{attachment.name || m.engagement_open_attachment()}
															</Button>
														{/each}
													</div>
												{/if}
											{/if}

											<div class="mt-3 flex flex-wrap gap-1">
												{#if item.can_reply && !isDeleted}
													<Button
														variant="ghost"
														size="sm"
														onclick={() => {
															replyItemId = replyItemId === item.id ? '' : item.id;
															replyBody = '';
														}}
													>
														<ThemeIcon role="reply" class="size-4" />{m.engagement_reply()}
													</Button>
												{/if}
												{#if (item.can_like && !item.liked) || (item.can_unlike && item.liked)}
													<Button
														variant="ghost"
														size="sm"
														disabled={actionInFlight === item.id}
														onclick={() => void queueAction(item, item.liked ? 'unlike' : 'like')}
													>
														<ThemeIcon
															role="favorite"
															class={item.liked ? 'size-4 fill-current' : 'size-4'}
														/>
														{item.liked ? m.engagement_unlike() : m.engagement_like()}
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
												{#if item.can_hide && !item.hidden && !isDeleted}
													<Button
														variant="ghost"
														size="sm"
														disabled={actionInFlight === item.id}
														onclick={() => requestProviderAction(item, 'hide')}
													>
														<ThemeIcon role="eye-off" class="size-4" />{m.engagement_hide()}
													</Button>
												{/if}
												<Button
													variant="ghost"
													size="sm"
													disabled={actionInFlight === item.id}
													onclick={() => void setState(item, { archived: !archived })}
												>
													{#if archived}
														<ThemeIcon role="inbox" class="size-4" />
													{:else}
														<ThemeIcon role="archive" class="size-4" />
													{/if}
													{archived ? m.engagement_restore() : m.engagement_archive()}
												</Button>
												{#if item.can_delete && !isDeleted}
													<Button
														variant="ghost"
														size="sm"
														class="text-destructive"
														onclick={() => requestProviderAction(item, 'delete')}
													>
														<ThemeIcon role="delete" class="size-4" />{m.engagement_delete({
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
					</section>
				{/each}
			</div>
			{#if pageError}
				<InlineNotice tone="error" message={pageError}>
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={() => void loadMoreEngagement()}>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			{:else if nextCursor}
				<div class="flex justify-center pt-2">
					<Button
						variant="outline"
						disabled={loadingMore}
						onclick={() => void loadMoreEngagement()}
					>
						{loadingMore ? m.common_loading() : m.engagement_load_older()}
					</Button>
				</div>
			{/if}
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
