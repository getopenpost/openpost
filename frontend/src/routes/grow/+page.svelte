<!--
THESIS: Grow turns mutual-graph evidence into plain, actionable follow candidates without hype.
OWN-WORLD: Warm canvas, hairline cards, compact Geist type, scarce Workshop Orange only on primary Follow.
STORY: Pick a compatible account in For, see evidence-based cards with mutual avatars and reason chips, follow, open, or dismiss with immediate clarity.
FIRST VIEWPORT: Page header with Grow plus Refresh, compact For selector plus last-updated meta, then 1-column phone / 2-col desktop / 3-col wide card grid.
FORM: Flat bordered cards in Workshop list grammar, centered page-container rhythm.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->
<script lang="ts">
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import {
		accountFeaturesQueryOptions,
		growthQueryKeys,
		growthQueryOptions,
		workspaceAccountsQueryOptions,
		type GrowthResult
	} from '@openpost/query-catalog';
	import { createQuery } from '@tanstack/svelte-query';
	import { onDestroy, onMount } from 'svelte';
	import { client } from '$lib/api/client';
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
	import { growthQueryAPI } from '$lib/query/growth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import GrowthProfileCard from '$lib/components/growth-profile-card.svelte';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';
	import {
		compatibleAccounts,
		selectInitialAccount,
		shouldPollSync,
		isSyncBusy,
		syncErrorKind,
		growthRankBucket,
		growthMutualBucket,
		applyGrowthControls,
		terminalRemovalDelay
	} from '$lib/growth-helpers';
	import type {
		GrowthSort,
		GrowthView,
		RecommendationView,
		SyncStateView
	} from '$lib/growth-helpers';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { isFeatureEffective } from '$lib/feature-disabled';

	let selectedAccountID = $state<string | null>(null);
	let items = $state.raw<RecommendationView[]>([]);
	let syncState = $state.raw<SyncStateView | null>(null);
	let currentGenerationID = $state<string>('');
	let inlineMessage = $state('');
	let inlineTone = $state<'error' | 'warning' | 'info'>('info');
	let inlineActionLabel = $state('');
	let inlineActionHandler: (() => void) | null = $state(null);
	let toastMessage = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');
	let growthView = $state<GrowthView>('all');
	let growthSort = $state<GrowthSort>('best_match');
	let minimumMutuals = $state(0);
	let pendingSessionIds = $state.raw<Set<string>>(new Set());
	let destroyed = false;
	const shownGenerations = new Set<string>();
	const openedWorkspaces = new Set<string>();
	let selectionWorkspaceID = $state('');
	let appliedGrowthData: GrowthResult | undefined;
	let appliedGrowthScope = '';
	const growthPollingInterval = 5000;

	const localeTag = $derived(getLocaleTag());
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const queryAccountID = $derived(
		selectionWorkspaceID === workspaceID ? (selectedAccountID ?? '') : ''
	);
	const accountsQuery = createQuery(() => workspaceAccountsQueryOptions(queryAPI, workspaceID));
	const accounts = $derived(accountsQuery.data ?? []);
	const featuresQuery = createQuery(() =>
		accountFeaturesQueryOptions(
			featureQueryAPI,
			workspaceID,
			accounts.map((account) => account.id)
		)
	);
	const accountFeatures = $derived(featuresQuery.data ?? []);

	const accountsLoading = $derived(accountsQuery.isPending && !accountsQuery.data);
	const featuresLoading = $derived(
		accounts.length > 0 && featuresQuery.isPending && !featuresQuery.data
	);
	const loading = $derived(Boolean(queryAccountID) && growthQuery.isPending && !growthQuery.data);
	const readError = $derived.by(() => {
		if (accountsQuery.isError && !accountsQuery.data) {
			return queryErrorMessage(accountsQuery.error);
		}
		if (featuresQuery.isError && !featuresQuery.data) {
			return queryErrorMessage(featuresQuery.error);
		}
		if (growthQuery.isError && !growthQuery.data && queryAccountID) {
			return queryErrorMessage(growthQuery.error);
		}
		return '';
	});
	const backgroundReadError = $derived.by(() => {
		if (accountsQuery.isError && accountsQuery.data) return queryErrorMessage(accountsQuery.error);
		if (featuresQuery.isError && featuresQuery.data) return queryErrorMessage(featuresQuery.error);
		if (growthQuery.isError && growthQuery.data) return queryErrorMessage(growthQuery.error);
		return '';
	});
	const initialLoading = $derived(
		Boolean(workspaceID) &&
			(accountsLoading || featuresLoading || (Boolean(selectedAccountID) && loading)) &&
			!readError
	);
	const selectedAccount = $derived(
		selectedAccountID ? accounts.find((a) => a.id === selectedAccountID) : undefined
	);
	const refreshQueued = $derived(
		syncState?.status === 'queued' || syncState?.status === 'refreshing'
	);
	const busy = $derived(refreshQueued || isSyncBusy(syncState));
	const hasPendingFollow = $derived(items.some((i) => i.follow_state === 'pending'));
	const lastSuccessAt = $derived(syncState?.last_success_at ?? null);
	const compatible = $derived(compatibleAccounts(accounts));
	const eligible = $derived(
		compatible.filter((acc) => isFeatureEffective(accountFeatures, acc.id, 'grow'))
	);
	const staleGrowFeature = $derived.by(() => {
		if (!selectedAccountID) return null;
		const acc = accounts.find((a) => a.id === selectedAccountID);
		if (!acc) return null;
		if (eligible.some((e) => e.id === selectedAccountID)) return null;
		if (!compatible.some((c) => c.id === selectedAccountID)) return null;
		return (
			accountFeatures.find(
				(f) => f.social_account_id === selectedAccountID && f.feature === 'grow'
			) ?? null
		);
	});
	const isStaleDisabled = $derived(staleGrowFeature !== null);
	const growDisabled = $derived(isStaleDisabled);
	const growthQuery = createQuery(() => ({
		...growthQueryOptions(growthQueryAPI, workspaceID, queryAccountID),
		refetchInterval:
			!isStaleDisabled && shouldPollSync(syncState, hasPendingFollow)
				? growthPollingInterval
				: false
	}));
	const showAccountSelector = $derived(eligible.length > 0);
	const noCompatible = $derived(
		!accountsLoading && !featuresLoading && !readError && compatible.length === 0
	);
	const noEligible = $derived(
		!accountsLoading &&
			!featuresLoading &&
			!readError &&
			compatible.length > 0 &&
			eligible.length === 0 &&
			!isStaleDisabled
	);
	const neverGenerated = $derived(
		!loading &&
			!readError &&
			!noCompatible &&
			!noEligible &&
			!isStaleDisabled &&
			eligible.length > 0 &&
			!syncState
	);
	const showGrid = $derived(
		!loading &&
			!noCompatible &&
			!noEligible &&
			(!neverGenerated || isStaleDisabled) &&
			(items.length > 0 || isStaleDisabled)
	);
	const isEmptyAfterSuccess = $derived(
		!isStaleDisabled && showGrid && items.length === 0 && syncState?.status === 'ok'
	);
	const lastUpdatedText = $derived(
		lastSuccessAt ? m.grow_last_updated({ date: formatDate(lastSuccessAt) }) : ''
	);
	const canRefresh = $derived(
		!isStaleDisabled && !growDisabled && Boolean(selectedAccountID) && !noCompatible && !noEligible
	);
	const canFollow = $derived(!isStaleDisabled && !growDisabled);
	const visibleItems = $derived(
		applyGrowthControls(items, {
			view: growthView,
			sort: growthSort,
			minimumMutuals
		})
	);
	const controlsActive = $derived(
		growthView !== 'all' || growthSort !== 'best_match' || minimumMutuals !== 0
	);
	const filterEmpty = $derived(showGrid && items.length > 0 && visibleItems.length === 0);
	const resultCountText = $derived(
		visibleItems.length === 1
			? m.grow_result_count_one()
			: m.grow_result_count_many({ count: visibleItems.length })
	);

	function resetGrowthForSwitch() {
		items = [];
		syncState = null;
		currentGenerationID = '';
		inlineMessage = '';
		pendingSessionIds = new Set();
		appliedGrowthData = undefined;
		appliedGrowthScope = '';
	}

	function resetControls() {
		growthView = 'all';
		growthSort = 'best_match';
		minimumMutuals = 0;
	}

	onMount(() => {
		if (!workspaceCtx.currentWorkspace) void workspaceCtx.initialize();
	});

	onDestroy(() => {
		destroyed = true;
	});

	$effect(() => {
		const wid = workspaceID;
		if (wid === selectionWorkspaceID) return;
		selectionWorkspaceID = wid;
		resetGrowthForSwitch();
		selectedAccountID = null;
	});

	$effect(() => {
		if (!accountsQuery.data || (accounts.length > 0 && !featuresQuery.data)) return;
		if (featuresQuery.isError && !featuresQuery.data) return;
		const nextEligible = compatibleAccounts(accounts).filter((account) =>
			isFeatureEffective(accountFeatures, account.id, 'grow')
		);
		let nextID: string | null = null;
		if (nextEligible.length > 0) {
			nextID = selectInitialAccount(nextEligible, selectedAccountID);
		} else {
			const nextCompatible = compatibleAccounts(accounts);
			if (selectedAccountID && nextCompatible.some((account) => account.id === selectedAccountID)) {
				nextID = selectedAccountID;
			} else if (nextCompatible.length === 1) {
				nextID = nextCompatible[0].id;
			}
		}
		if (nextID === selectedAccountID) return;
		resetGrowthForSwitch();
		selectedAccountID = nextID;
	});

	$effect(() => {
		const data = growthQuery.data;
		const wid = workspaceID;
		const acc = queryAccountID;
		const scope = `${wid}:${acc ?? ''}`;
		if (
			!data ||
			!wid ||
			!acc ||
			!growthResultMatchesScope(data, wid, acc) ||
			(data === appliedGrowthData && scope === appliedGrowthScope)
		) {
			return;
		}
		appliedGrowthData = data;
		appliedGrowthScope = scope;
		void applyGrowthResult(data, wid, acc);
	});

	$effect(() => {
		if (accountsLoading || featuresLoading || !workspaceID) return;
		if (openedWorkspaces.has(workspaceID)) return;
		openedWorkspaces.add(workspaceID);
		captureTelemetryEvent('growth opened', { platform_count: eligible.length });
	});

	async function applyGrowthResult(data: GrowthResult, ws: string, acc: string) {
		const newItems = data.items ?? [];
		const newSync = data.sync_state ?? null;
		const followUpdates = data.follow_updates ?? [];
		syncState = newSync;
		currentGenerationID = newSync?.current_generation_id ?? '';

		const prevPendingIds = new Set(pendingSessionIds);
		let mergedItems: RecommendationView[] = [...newItems];
		let followToast: { handle: string } | null = null;

		for (const it of mergedItems) {
			if (it.follow_state === 'failed' && prevPendingIds.has(it.id)) {
				followToast = { handle: `@${it.handle}` };
			}
		}

		const updatesById = new Map(followUpdates.map((u) => [u.id, u]));
		const toShowTerminal: RecommendationView[] = [];
		for (const pid of prevPendingIds) {
			const upd = updatesById.get(pid);
			if (upd && (upd.follow_state === 'following' || upd.follow_state === 'requested')) {
				const prior = items.find((r) => r.id === pid);
				if (prior) {
					toShowTerminal.push({
						...prior,
						follow_state: upd.follow_state,
						updated_at: upd.updated_at
					});
				}
			}
		}

		if (toShowTerminal.length) {
			const terminalIDs = new Set(toShowTerminal.map((item) => item.id));
			mergedItems = [...mergedItems.filter((item) => !terminalIDs.has(item.id)), ...toShowTerminal];
			items = mergedItems;
			const delay = terminalRemovalDelay();
			if (delay > 0) {
				await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
			}
			if (destroyed || selectedAccountID !== acc || workspaceID !== ws) return;
			items = items.filter((item) => !terminalIDs.has(item.id));
			pendingSessionIds = new Set([...pendingSessionIds].filter((id) => !terminalIDs.has(id)));
		} else {
			items = mergedItems;
			const stillPending = new Set<string>();
			for (const id of pendingSessionIds) {
				const found = mergedItems.find((it) => it.id === id);
				if (found?.follow_state === 'pending') stillPending.add(id);
			}
			pendingSessionIds = stillPending;
		}

		if (followToast) {
			toastMessage = m.grow_follow_failed({ handle: followToast.handle });
			toastTone = 'error';
			setTimeout(() => (toastMessage = ''), 3000);
		}

		if (newSync) {
			const kind = syncErrorKind(newSync);
			if (newSync.status === 'ok') {
				inlineMessage = '';
				inlineActionLabel = '';
				inlineActionHandler = null;
			} else if (kind === 'rate_limited') {
				const platformKey = selectedAccount ? selectedAccount.platform.toLowerCase() : '';
				let msg = m.grow_rate_limited_generic();
				if (platformKey.includes('bluesky')) msg = m.grow_rate_limited_bluesky();
				else if (platformKey.includes('mastodon')) msg = m.grow_rate_limited_mastodon();
				inlineMessage = msg;
				inlineTone = 'warning';
				inlineActionLabel = '';
				inlineActionHandler = null;
			} else if (kind === 'auth') {
				inlineMessage = m.grow_auth_required_description();
				inlineTone = 'warning';
				inlineActionLabel = m.grow_reconnect();
				inlineActionHandler = () => {
					window.location.assign('/settings?tab=accounts');
				};
			} else if (kind === 'failed') {
				inlineMessage = m.grow_temporary_unavailable();
				inlineTone = 'error';
				inlineActionLabel = m.grow_refresh();
				inlineActionHandler = () => {
					if (workspaceID && selectedAccountID) void handleRefresh();
				};
			}
		}

		if (mergedItems.length > 0 && currentGenerationID) {
			const key = `${ws}:${acc}:${currentGenerationID}`;
			if (!shownGenerations.has(key)) {
				shownGenerations.add(key);
				for (let idx = 0; idx < mergedItems.length; idx++) {
					const rec = mergedItems[idx];
					if (toShowTerminal.some((t) => t.id === rec.id)) continue;
					captureTelemetryEvent('growth recommendation shown', {
						platform: rec.platform,
						rank_bucket: growthRankBucket(idx + 1),
						mutual_count_bucket: growthMutualBucket(rec.mutual_count),
						follows_viewer: rec.follows_viewer
					});
				}
			}
		}
	}

	function growthResultMatchesScope(data: GrowthResult, ws: string, acc: string) {
		if (
			data.sync_state &&
			(data.sync_state.workspace_id !== ws || data.sync_state.social_account_id !== acc)
		) {
			return false;
		}
		return (data.items ?? []).every(
			(item) => item.workspace_id === ws && item.social_account_id === acc
		);
	}

	async function handleRefresh() {
		if (!workspaceID || !selectedAccountID || busy || isStaleDisabled) return;
		const view = captureGrowthMutationView();
		const requestedPlatform = selectedAccount?.platform ?? '';
		const requestedGenerationID = currentGenerationID;
		try {
			const res = await client.POST('/growth/refresh', {
				body: { workspace_id: view.workspaceID, account_id: view.accountID }
			});
			if (!settleQueryMutationSession(view.session, res.response)) return;
			if (res.error) throw res.error;
			const now = new Date().toISOString();
			await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: view.queryKey, exact: true }],
				reconcile: () => {
					queryClient.setQueryData<GrowthResult>(view.queryKey, (current) => {
						if (!current) return current;
						const queuedState: SyncStateView = current.sync_state
							? { ...current.sync_state, status: 'queued', updated_at: now }
							: {
									id: '',
									workspace_id: view.workspaceID,
									social_account_id: view.accountID,
									platform: requestedPlatform,
									status: 'queued',
									current_generation_id: requestedGenerationID,
									created_at: now,
									updated_at: now
								};
						return {
							items: current.items ?? [],
							follow_updates: current.follow_updates ?? [],
							sync_state: queuedState
						};
					});
				},
				invalidate: [{ queryKey: view.queryKey, exact: true }]
			});
		} catch {
			if (!growthMutationViewIsCurrent(view)) return;
			toastMessage = m.grow_refresh_failed();
			toastTone = 'error';
			scheduleGrowthToastClear(view);
		}
	}

	async function handleFollow(id: string) {
		if (!workspaceID || !selectedAccountID || isStaleDisabled) return;
		const view = captureGrowthMutationView();
		const previousItem = items.find((item) => item.id === id);
		items = items.map((item) => (item.id === id ? { ...item, follow_state: 'pending' } : item));
		pendingSessionIds = new Set(pendingSessionIds).add(id);
		try {
			const optimistic = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: view.queryKey, exact: true }],
				reconcile: () =>
					updateGrowthItems(view.queryKey, (current) =>
						current.map((item) => (item.id === id ? { ...item, follow_state: 'pending' } : item))
					)
			});
			if (!optimistic) return;
			const res = await client.POST('/growth/{recommendation_id}/follow', {
				params: { path: { recommendation_id: id } },
				body: { workspace_id: view.workspaceID }
			});
			if (!settleQueryMutationSession(view.session, res.response)) return;
			if (res.error) throw res.error;
			await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [{ queryKey: view.queryKey, exact: true, refetchType: 'none' }]
			});
		} catch {
			if (!queryMutationSessionIsCurrent(view.session)) return;
			const rolledBack = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: view.queryKey, exact: true }],
				reconcile: () =>
					updateGrowthItems(view.queryKey, (current) =>
						previousItem
							? current.map((item) => (item.id === previousItem.id ? previousItem : item))
							: current
					)
			});
			if (!rolledBack || !growthMutationViewIsCurrent(view)) return;
			if (previousItem) {
				items = items.map((item) => (item.id === previousItem.id ? previousItem : item));
			}
			const pruned = new Set(pendingSessionIds);
			pruned.delete(id);
			pendingSessionIds = pruned;
			const handle = previousItem ? `@${previousItem.handle}` : '';
			toastMessage = m.grow_follow_failed({ handle });
			toastTone = 'error';
			scheduleGrowthToastClear(view);
		}
	}

	async function handleDismiss(id: string) {
		if (!workspaceID || !selectedAccountID) return;
		const view = captureGrowthMutationView();
		const previousIndex = items.findIndex((item) => item.id === id);
		const previousItem = items[previousIndex];
		const wasPending = pendingSessionIds.has(id);
		items = items.filter((item) => item.id !== id);
		if (wasPending) {
			const next = new Set(pendingSessionIds);
			next.delete(id);
			pendingSessionIds = next;
		}
		try {
			const optimistic = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: view.queryKey, exact: true }],
				reconcile: () =>
					updateGrowthItems(view.queryKey, (current) => current.filter((item) => item.id !== id))
			});
			if (!optimistic) return;
			const res = await client.POST('/growth/{recommendation_id}/dismiss', {
				params: { path: { recommendation_id: id } },
				body: { workspace_id: view.workspaceID }
			});
			if (!settleQueryMutationSession(view.session, res.response)) return;
			if (res.error) throw res.error;
			await reconcileQueryMutation(queryClient, view.session, {
				invalidate: [{ queryKey: view.queryKey, exact: true, refetchType: 'none' }]
			});
		} catch {
			if (!queryMutationSessionIsCurrent(view.session)) return;
			const rolledBack = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: view.queryKey, exact: true }],
				reconcile: () =>
					updateGrowthItems(view.queryKey, (current) =>
						restoreRecommendation(current, previousItem, previousIndex)
					)
			});
			if (!rolledBack || !growthMutationViewIsCurrent(view)) return;
			items = restoreRecommendation(items, previousItem, previousIndex);
			if (wasPending) pendingSessionIds = new Set(pendingSessionIds).add(id);
			toastMessage = m.grow_dismiss_failed();
			toastTone = 'error';
			scheduleGrowthToastClear(view);
		}
	}

	interface GrowthMutationView {
		readonly session: QueryMutationSession;
		readonly workspaceID: string;
		readonly accountID: string;
		readonly queryKey: ReturnType<typeof growthQueryKeys.account>;
	}

	function captureGrowthMutationView(): GrowthMutationView {
		const accountID = selectedAccountID ?? '';
		return {
			session: captureQueryMutationSession(),
			workspaceID,
			accountID,
			queryKey: growthQueryKeys.account(workspaceID, accountID)
		};
	}

	function growthMutationViewIsCurrent(view: GrowthMutationView) {
		return (
			view.workspaceID === workspaceID &&
			view.accountID === selectedAccountID &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function scheduleGrowthToastClear(view: GrowthMutationView) {
		setTimeout(() => {
			if (growthMutationViewIsCurrent(view)) toastMessage = '';
		}, 3000);
	}

	function updateGrowthItems(
		queryKey: ReturnType<typeof growthQueryKeys.account>,
		update: (items: RecommendationView[]) => RecommendationView[]
	) {
		queryClient.setQueryData<GrowthResult>(queryKey, (current) =>
			current ? { ...current, items: update(current.items ?? []) } : current
		);
	}

	function restoreRecommendation(
		current: RecommendationView[],
		item: RecommendationView | undefined,
		index: number
	) {
		if (!item || current.some((candidate) => candidate.id === item.id)) return current;
		const insertionIndex = Math.min(Math.max(index, 0), current.length);
		return [...current.slice(0, insertionIndex), item, ...current.slice(insertionIndex)];
	}

	function retryReads() {
		if (accountsQuery.isError) void accountsQuery.refetch();
		if (featuresQuery.isError) void featuresQuery.refetch();
		if (growthQuery.isError) void growthQuery.refetch();
	}

	function queryErrorMessage(cause: unknown) {
		return cause instanceof Error && cause.message ? cause.message : m.grow_load_failed();
	}

	function handleOpenProfile(rec: RecommendationView) {
		const idx = visibleItems.findIndex((r) => r.id === rec.id);
		captureTelemetryEvent('growth profile opened', {
			platform: rec.platform,
			rank_bucket: growthRankBucket(idx >= 0 ? idx + 1 : 1),
			mutual_count_bucket: growthMutualBucket(rec.mutual_count),
			follows_viewer: rec.follows_viewer
		});
		if (rec.profile_url) {
			window.open(rec.profile_url, '_blank', 'noopener,noreferrer');
		}
	}

	function formatDate(dateStr: string): string {
		try {
			const d = new Date(dateStr);
			if (Number.isNaN(d.getTime())) return dateStr;
			return new Intl.DateTimeFormat(localeTag, {
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(d);
		} catch {
			return dateStr;
		}
	}

	function accountName(account: SocialAccount): string {
		return (
			formatSocialAccountName(account.account_username, account.platform) ||
			account.slug ||
			account.account_id ||
			account.platform
		);
	}

	function accountSelectLabel(account: SocialAccount | undefined): string {
		if (!account) return m.grow_for_label();
		return `${m.grow_for_label()}: ${accountName(account)}, ${getPlatformName(account.platform)}`;
	}

	function staleDetailMessage(feat: FeatureState | null): string {
		if (!feat) return m.grow_feature_disabled_description();
		if (feat.availability === 'missing_scope') {
			const scopes = (feat.missing_scopes ?? feat.required_scopes ?? []).join(', ');
			if (!scopes) return m.feature_disabled_reason_missing_scope({ scopes: '' });
			return m.grow_feature_missing_scope_description({ scopes });
		}
		if (feat.availability === 'plan_restricted')
			return m.grow_feature_plan_restricted_description();
		if (!feat.stored_exists) return m.feature_disabled_reason_undecided();
		return m.grow_feature_disabled_description();
	}
</script>

<PageContainer
	title={m.grow_title()}
	description={m.grow_description()}
	themeIconRole="growth"
	loading={initialLoading}
	loadingLayout="grid"
	loadingItems={6}
>
	{#snippet actions()}
		{#if selectedAccountID && !noCompatible && !noEligible && !isStaleDisabled}
			<Button
				variant="outline"
				size="sm"
				onclick={handleRefresh}
				disabled={busy || !canRefresh}
				aria-label={busy ? m.grow_refreshing() : m.grow_refresh()}
				data-testid="grow-refresh-button"
			>
				{#if busy}
					<ProtectedIcon icon="loading" class="size-4 animate-spin" />
					{m.grow_refreshing()}
				{:else}
					<ThemeIcon role="refresh" class="size-4" />
					{m.grow_refresh()}
				{/if}
			</Button>
		{/if}
	{/snippet}

	<div class="flex min-w-0 flex-col gap-4">
		{#if readError}
			<InlineNotice tone="error" message={readError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryReads}
						>{m.grow_load_failed_retry()}</Button
					>
				{/snippet}
			</InlineNotice>
		{:else if backgroundReadError}
			<InlineNotice tone="error" message={backgroundReadError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryReads}
						>{m.grow_load_failed_retry()}</Button
					>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if showAccountSelector}
			<div class="flex flex-wrap items-center gap-3">
				<label for="grow-account-select" class="text-sm font-medium">{m.grow_for_label()}</label>
				<div class="max-w-xs min-w-40">
					<Select.Root
						type="single"
						value={selectedAccountID ?? ''}
						onValueChange={(v) => {
							resetGrowthForSwitch();
							selectedAccountID = v;
						}}
					>
						<Select.Trigger
							id="grow-account-select"
							class="h-9 w-full"
							aria-label={accountSelectLabel(selectedAccount)}
							data-testid="grow-account-select"
						>
							{#if selectedAccount}
								<SocialAccountIdentity
									name={accountName(selectedAccount)}
									platform={selectedAccount.platform}
									avatarUrl={selectedAccount.account_avatar_url}
									size="sm"
								/>
							{:else}
								<span class="text-muted-foreground">{m.grow_account_placeholder()}</span>
							{/if}
						</Select.Trigger>
						<Select.Content class="w-72 max-w-[calc(100vw-1rem)]">
							{#each eligible as acc (acc.id)}
								<Select.Item value={acc.id} class="min-h-12 py-2">
									<SocialAccountIdentity
										name={accountName(acc)}
										platform={acc.platform}
										avatarUrl={acc.account_avatar_url}
									/>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if lastUpdatedText && !isStaleDisabled}
					<span class="text-xs text-muted-foreground">{lastUpdatedText}</span>
				{/if}
				{#if busy && !isStaleDisabled}
					<span
						class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
						aria-live="polite"
					>
						<ProtectedIcon icon="loading" class="size-3.5 animate-spin" />
						{m.grow_refreshing()}
					</span>
				{/if}
			</div>
		{/if}

		{#if isStaleDisabled}
			<div data-testid="grow-disabled-notice">
				<InlineNotice tone="warning" message={m.grow_feature_disabled_title()}>
					<p class="mt-1 text-xs leading-5">
						{staleDetailMessage(staleGrowFeature)}
					</p>
					<p class="mt-1 text-xs leading-5">
						{m.grow_feature_disabled_notice()}
					</p>
					{#snippet actions()}
						{#if staleGrowFeature?.availability === 'plan_restricted'}
							<Button
								href="/settings?tab=accounts"
								variant="outline"
								size="sm"
								data-testid="grow-disabled-billing-link"
							>
								{m.feature_disabled_open_billing()}
							</Button>
						{:else if staleGrowFeature?.availability === 'missing_scope'}
							<Button
								href="/settings?tab=accounts"
								variant="outline"
								size="sm"
								data-testid="grow-disabled-recovery-link"
							>
								{m.feature_disabled_reconnect()}
							</Button>
						{:else}
							<Button
								href="/settings?tab=accounts"
								variant="outline"
								size="sm"
								data-testid="grow-disabled-recovery-link"
							>
								{m.feature_disabled_open_details()}
							</Button>
						{/if}
					{/snippet}
				</InlineNotice>
			</div>
		{/if}

		{#if inlineMessage && !isStaleDisabled}
			<div data-testid="grow-inline-message">
				<InlineNotice tone={inlineTone} message={inlineMessage}>
					{#snippet actions()}
						{#if inlineActionLabel && inlineActionHandler}
							<Button variant="outline" size="sm" onclick={inlineActionHandler}
								>{inlineActionLabel}</Button
							>
						{/if}
					{/snippet}
				</InlineNotice>
			</div>
		{/if}

		{#if showGrid && items.length > 0}
			<section
				class="rounded-lg border bg-muted/20 p-3"
				aria-label={m.grow_controls_label()}
				data-testid="grow-controls"
			>
				<div class="flex items-center justify-between gap-3">
					<p class="text-sm font-medium tabular-nums" data-testid="grow-result-count">
						{resultCountText}
					</p>
					{#if controlsActive}
						<Button variant="ghost" size="sm" onclick={resetControls}>
							{m.grow_reset_filters()}
						</Button>
					{/if}
				</div>
				<div class="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3">
					<div class="min-w-0 space-y-1.5">
						<label for="grow-view-select" class="text-xs font-medium text-muted-foreground">
							{m.grow_view_label()}
						</label>
						<Select.Root
							type="single"
							value={growthView}
							onValueChange={(value) => {
								if (value === 'all' || value === 'follows_you') growthView = value;
							}}
						>
							<Select.Trigger
								id="grow-view-select"
								class="h-9 w-full"
								aria-label={m.grow_view_label()}
								data-testid="grow-view-select"
							>
								<span class="truncate">
									{growthView === 'follows_you' ? m.grow_view_follows_you() : m.grow_view_all()}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="all">{m.grow_view_all()}</Select.Item>
								<Select.Item value="follows_you">{m.grow_view_follows_you()}</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>

					<div class="min-w-0 space-y-1.5 sm:order-3">
						<label for="grow-mutuals-select" class="text-xs font-medium text-muted-foreground">
							{m.grow_mutuals_label()}
						</label>
						<Select.Root
							type="single"
							value={String(minimumMutuals)}
							onValueChange={(value) => {
								const next = Number(value);
								if ([0, 1, 3, 5].includes(next)) minimumMutuals = next;
							}}
						>
							<Select.Trigger
								id="grow-mutuals-select"
								class="h-9 w-full"
								aria-label={m.grow_mutuals_label()}
								data-testid="grow-mutuals-select"
							>
								<span class="truncate">
									{minimumMutuals === 0
										? m.grow_mutuals_any()
										: m.grow_mutuals_minimum({ count: minimumMutuals })}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="0">{m.grow_mutuals_any()}</Select.Item>
								<Select.Item value="1">{m.grow_mutuals_minimum({ count: 1 })}</Select.Item>
								<Select.Item value="3">{m.grow_mutuals_minimum({ count: 3 })}</Select.Item>
								<Select.Item value="5">{m.grow_mutuals_minimum({ count: 5 })}</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>

					<div class="min-w-0 space-y-1.5 min-[360px]:col-span-2 sm:order-2 sm:col-span-1">
						<label for="grow-sort-select" class="text-xs font-medium text-muted-foreground">
							{m.grow_sort_label()}
						</label>
						<Select.Root
							type="single"
							value={growthSort}
							onValueChange={(value) => {
								if (value === 'best_match' || value === 'follow_back' || value === 'mutuals') {
									growthSort = value;
								}
							}}
						>
							<Select.Trigger
								id="grow-sort-select"
								class="h-9 w-full"
								aria-label={m.grow_sort_label()}
								data-testid="grow-sort-select"
							>
								<span class="truncate">
									{growthSort === 'follow_back'
										? m.grow_sort_follow_back()
										: growthSort === 'mutuals'
											? m.grow_sort_mutuals()
											: m.grow_sort_best_match()}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="best_match">{m.grow_sort_best_match()}</Select.Item>
								<Select.Item value="follow_back">{m.grow_sort_follow_back()}</Select.Item>
								<Select.Item value="mutuals">{m.grow_sort_mutuals()}</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				{#if growthSort === 'follow_back'}
					<p class="mt-2 text-xs leading-5 text-muted-foreground">
						{m.grow_follow_back_explanation()}
					</p>
				{/if}
			</section>
		{/if}

		{#if noCompatible}
			<EmptyState
				themeIconRole="users"
				title={m.grow_no_compatible_title()}
				description={m.grow_no_compatible_description()}
				actionLabel={m.grow_connect_account()}
				actionHref="/settings?tab=accounts"
			/>
		{:else if noEligible}
			<EmptyState
				themeIconRole="users"
				title={m.grow_feature_all_disabled_title()}
				description={m.grow_feature_all_disabled_description()}
				actionLabel={m.feature_disabled_open_details()}
				actionHref="/settings?tab=accounts"
			/>
		{:else if isStaleDisabled}
			{#if filterEmpty}
				<EmptyState
					themeIconRole="users"
					title={m.grow_no_filter_results_title()}
					description={m.grow_no_filter_results_description()}
					actionLabel={m.grow_reset_filters()}
					onAction={resetControls}
				/>
			{:else if visibleItems.length > 0}
				<div
					class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
					data-testid="growth-grid"
				>
					{#each visibleItems as rec, index (rec.id)}
						<GrowthProfileCard
							recommendation={rec}
							position={index + 1}
							onFollow={() => {}}
							onDismiss={handleDismiss}
							onOpenProfile={handleOpenProfile}
							disableFollow={true}
						/>
					{/each}
				</div>
				<p class="text-xs text-muted-foreground" data-testid="grow-stored-notice">
					{m.grow_feature_disabled_notice()}
				</p>
			{:else if neverGenerated}
				<EmptyState
					themeIconRole="growth"
					title={m.grow_feature_disabled_title()}
					description={staleDetailMessage(staleGrowFeature)}
					actionLabel={m.feature_disabled_open_details()}
					actionHref="/settings?tab=accounts"
				/>
			{/if}
		{:else if neverGenerated}
			<EmptyState
				themeIconRole="growth"
				title={m.grow_never_generated_title()}
				description={m.grow_never_generated_description()}
				actionLabel={m.grow_find_people()}
				onAction={canRefresh ? handleRefresh : undefined}
			/>
		{:else if isEmptyAfterSuccess}
			<EmptyState
				themeIconRole="users"
				title={m.grow_empty_title()}
				description={m.grow_empty_description()}
				actionLabel={m.grow_refresh()}
				onAction={canRefresh ? handleRefresh : undefined}
			/>
		{:else if filterEmpty}
			<EmptyState
				themeIconRole="users"
				title={m.grow_no_filter_results_title()}
				description={m.grow_no_filter_results_description()}
				actionLabel={m.grow_reset_filters()}
				onAction={resetControls}
			/>
		{:else if showGrid}
			{#if busy && items.length > 0}
				<div class="text-xs text-muted-foreground" aria-live="polite">
					{m.grow_refreshing()}
				</div>
			{/if}
			<div
				class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
				data-testid="growth-grid"
			>
				{#each visibleItems as rec, index (rec.id)}
					<GrowthProfileCard
						recommendation={rec}
						position={index + 1}
						onFollow={canFollow ? handleFollow : () => {}}
						onDismiss={handleDismiss}
						onOpenProfile={handleOpenProfile}
						disableFollow={!canFollow}
					/>
				{/each}
			</div>
		{/if}
	</div>

	{#if toastMessage}
		<AppToast
			message={toastMessage}
			tone={toastTone}
			onDismiss={() => (toastMessage = '')}
			dismissLabel={m.common_dismiss()}
		/>
	{/if}
</PageContainer>
