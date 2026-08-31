<!--
THESIS: Grow turns mutual-graph evidence into plain, actionable follow candidates without hype.
OWN-WORLD: Warm canvas, hairline cards, compact Geist type, scarce Workshop Orange only on primary Follow.
STORY: Pick a compatible account in For, see evidence-based cards with mutual avatars and reason chips, follow, open, or dismiss with immediate clarity.
FIRST VIEWPORT: Page header with Grow plus Refresh, compact For selector plus last-updated meta, then 1-column phone / 2-col desktop / 3-col wide card grid.
FORM: Flat bordered cards in Workshop list grammar, centered page-container rhythm.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
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
		StaleGuard,
		terminalRemovalDelay
	} from '$lib/growth-helpers';
	import type {
		GrowthSort,
		GrowthView,
		RecommendationView,
		SyncStateView
	} from '$lib/growth-helpers';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import UserRoundPlusIcon from '@lucide/svelte/icons/user-round-plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import UsersIcon from '@lucide/svelte/icons/users';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { isFeatureEffective, loadFeatureStates } from '$lib/feature-disabled';

	type SocialAccount = components['schemas']['AccountResponse'];
	type FeatureState = components['schemas']['FeatureStateResponse'];

	let accounts = $state.raw<SocialAccount[]>([]);
	let accountFeatures = $state.raw<FeatureState[]>([]);
	let featuresLoading = $state(false);
	let selectedAccountID = $state<string | null>(null);
	let items = $state.raw<RecommendationView[]>([]);
	let syncState = $state.raw<SyncStateView | null>(null);
	let currentGenerationID = $state<string>('');
	let loading = $state(true);
	let accountsLoading = $state(true);
	let inlineMessage = $state('');
	let inlineTone = $state<'error' | 'warning' | 'info'>('info');
	let inlineActionLabel = $state('');
	let inlineActionHandler: (() => void) | null = $state(null);
	let toastMessage = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');
	let refreshQueued = $state(false);
	let growthView = $state<GrowthView>('all');
	let growthSort = $state<GrowthSort>('best_match');
	let minimumMutuals = $state(0);
	const growthGuard = new StaleGuard();
	const accountsGuard = new StaleGuard();
	let pendingSessionIds = $state.raw<Set<string>>(new Set());
	let destroyed = false;
	const shownGenerations = new Set<string>();
	const openedWorkspaces = new Set<string>();
	let accountsWorkspaceID = '';

	const localeTag = $derived(getLocaleTag());
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const selectedAccount = $derived(
		selectedAccountID ? accounts.find((a) => a.id === selectedAccountID) : undefined
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
	const showAccountSelector = $derived(eligible.length > 0);
	const noCompatible = $derived(!accountsLoading && !featuresLoading && compatible.length === 0);
	const noEligible = $derived(
		!accountsLoading &&
			!featuresLoading &&
			compatible.length > 0 &&
			eligible.length === 0 &&
			!isStaleDisabled
	);
	const neverGenerated = $derived(
		!loading &&
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
		growthGuard.next();
		items = [];
		syncState = null;
		currentGenerationID = '';
		inlineMessage = '';
		pendingSessionIds = new Set();
		refreshQueued = false;
		loading = true;
	}

	function resetControls() {
		growthView = 'all';
		growthSort = 'best_match';
		minimumMutuals = 0;
	}

	onMount(async () => {
		try {
			if (!workspaceCtx.currentWorkspace) await workspaceCtx.initialize();
		} catch {
			accountsLoading = false;
			loading = false;
		}
	});

	onDestroy(() => {
		destroyed = true;
	});

	$effect(() => {
		const wid = workspaceID;
		if (!wid || wid === accountsWorkspaceID) return;
		accountsWorkspaceID = wid;
		accountsGuard.next();
		resetGrowthForSwitch();
		accounts = [];
		accountFeatures = [];
		selectedAccountID = null;
		accountsLoading = true;
		void loadAccounts(wid);
	});

	$effect(() => {
		const wid = workspaceID;
		const acc = selectedAccountID;
		if (!wid || !acc) return;
		const accObj = accounts.find((a) => a.id === acc);
		if (!accObj) return;
		if (isStaleDisabled) return;
		growthGuard.next();
		void loadGrowth(wid, acc);
	});

	// Polling via one-shot timer owned by effect with cleanup
	$effect(() => {
		const shouldPoll =
			!isStaleDisabled && (refreshQueued || shouldPollSync(syncState, hasPendingFollow));
		const wid = workspaceID;
		const acc = selectedAccountID;
		if (!shouldPoll || !wid || !acc) return;
		const timer = setTimeout(() => {
			void loadGrowth(wid, acc, true);
		}, 5000);
		return () => clearTimeout(timer);
	});

	// Telemetry: capture once per workspace after accounts settle
	$effect(() => {
		if (accountsLoading || featuresLoading || !workspaceID) return;
		if (openedWorkspaces.has(workspaceID)) return;
		openedWorkspaces.add(workspaceID);
		captureTelemetryEvent('growth opened', { platform_count: eligible.length });
	});

	async function loadAccountFeatures(workspace: string, accountList: SocialAccount[]) {
		featuresLoading = true;
		try {
			accountFeatures = await loadFeatureStates(workspace, accountList);
		} finally {
			featuresLoading = false;
		}
	}

	async function loadAccounts(requestedWorkspaceID: string) {
		const seq = accountsGuard.next();
		accountsLoading = true;
		featuresLoading = true;
		try {
			const response = await client.GET('/accounts', {
				params: { query: { workspace_id: requestedWorkspaceID } }
			});
			if (accountsGuard.isStale(seq)) return;
			if (response.error) throw new Error('load failed');
			const list = response.data ?? [];
			if (requestedWorkspaceID !== workspaceCtx.currentWorkspace?.id) return;
			accounts = list;
			await loadAccountFeatures(requestedWorkspaceID, list);
			if (accountsGuard.isStale(seq)) return;
			// After features loaded, choose initial eligible account using local lists to avoid derived timing
			const localCompatible = compatibleAccounts(list);
			const localEligible = localCompatible.filter((acc) =>
				accountFeatures.some(
					(f) => f.social_account_id === acc.id && f.feature === 'grow' && f.effective_enabled
				)
			);
			if (localEligible.length > 0) {
				const nextID = selectInitialAccount(localEligible, selectedAccountID);
				if (nextID !== selectedAccountID) {
					resetGrowthForSwitch();
					selectedAccountID = nextID;
					if (!nextID) {
						loading = false;
						accountsLoading = false;
						return;
					}
				}
			} else {
				// No eligible: keep stale selection if there was a compatible previously selected
				if (selectedAccountID) {
					const stillCompatible = localCompatible.some((c) => c.id === selectedAccountID);
					if (!stillCompatible) {
						selectedAccountID = null;
						loading = false;
					} else {
						// keep stale, allow stored recommendations to remain if any
						loading = items.length === 0 ? false : loading;
					}
				} else {
					// If no prior selection but we have a single stale compatible account, keep it for disabled state
					if (localCompatible.length === 1) {
						selectedAccountID = localCompatible[0].id;
						// trigger stale disabled view: keep loading false to show disabled notice
						if (items.length === 0) {
							// still need to load growth for stale account to show stored items
							growthGuard.next();
							void loadGrowth(requestedWorkspaceID, selectedAccountID);
						}
						loading = false;
					} else {
						loading = false;
					}
				}
				accountsLoading = false;
				return;
			}
		} catch {
			if (accountsGuard.isStale(seq)) return;
			if (accounts.length === 0) {
				inlineMessage = m.grow_load_failed();
				inlineTone = 'error';
				inlineActionLabel = m.grow_load_failed_retry();
				inlineActionHandler = () => {
					if (workspaceID) void loadAccounts(workspaceID);
				};
			}
		} finally {
			if (!accountsGuard.isStale(seq)) {
				accountsLoading = false;
				featuresLoading = false;
			}
			if (!selectedAccountID) loading = false;
		}
	}

	async function loadGrowth(ws: string, acc: string, isPoll = false) {
		const seq = growthGuard.next();
		const requestKey = `${ws}:${acc}`;
		if (!isPoll) {
			loading = items.length === 0;
			inlineMessage = '';
		}
		try {
			const response = await client.GET('/growth', {
				params: { query: { workspace_id: ws, account_id: acc } }
			});
			if (growthGuard.isStale(seq)) return;
			if (`${workspaceID}:${selectedAccountID ?? ''}` !== requestKey) return;
			if (response.error || !response.data) throw response.error;
			const data = response.data;
			const newItems = data.items ?? [];
			const newSync = data.sync_state ?? null;
			const followUpdates = data.follow_updates ?? [];
			syncState = newSync;
			refreshQueued = newSync?.status === 'queued' || newSync?.status === 'refreshing';
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
				mergedItems = [
					...mergedItems.filter((item) => !terminalIDs.has(item.id)),
					...toShowTerminal
				];
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

			loading = false;
		} catch {
			if (growthGuard.isStale(seq)) return;
			if (ws !== workspaceID || acc !== selectedAccountID) return;
			inlineMessage = m.grow_load_failed();
			inlineTone = 'error';
			inlineActionLabel = m.grow_load_failed_retry();
			inlineActionHandler = () => {
				if (workspaceID && selectedAccountID) void loadGrowth(workspaceID, selectedAccountID);
			};
			loading = false;
		}
	}

	async function handleRefresh() {
		if (!workspaceID || !selectedAccountID || busy || isStaleDisabled) return;
		growthGuard.next();
		refreshQueued = true;
		try {
			const res = await client.POST('/growth/refresh', {
				body: { workspace_id: workspaceID, account_id: selectedAccountID }
			});
			if (res.error) throw res.error;
			if (syncState) {
				syncState = { ...syncState, status: 'queued' };
			} else {
				const now = new Date().toISOString();
				const queuedState: SyncStateView = {
					id: '',
					workspace_id: workspaceID,
					social_account_id: selectedAccountID,
					platform: selectedAccount?.platform ?? '',
					status: 'queued',
					current_generation_id: currentGenerationID,
					created_at: now,
					updated_at: now
				};
				syncState = queuedState;
			}
		} catch {
			refreshQueued = false;
			toastMessage = m.grow_refresh_failed();
			toastTone = 'error';
			setTimeout(() => (toastMessage = ''), 3000);
		}
	}

	async function handleFollow(id: string) {
		if (!workspaceID || isStaleDisabled) return;
		const prev = items;
		items = items.map((it) => (it.id === id ? { ...it, follow_state: 'pending' } : it));
		const nextPending = new Set(pendingSessionIds);
		nextPending.add(id);
		pendingSessionIds = nextPending;
		try {
			const res = await client.POST('/growth/{recommendation_id}/follow', {
				params: { path: { recommendation_id: id } },
				body: { workspace_id: workspaceID }
			});
			if (res.error) throw res.error;
		} catch {
			items = prev;
			const pruned = new Set(pendingSessionIds);
			pruned.delete(id);
			pendingSessionIds = pruned;
			const rec = prev.find((r) => r.id === id);
			const handle = rec ? `@${rec.handle}` : '';
			toastMessage = m.grow_follow_failed({ handle });
			toastTone = 'error';
			setTimeout(() => (toastMessage = ''), 3000);
		}
	}

	async function handleDismiss(id: string) {
		if (!workspaceID) return;
		const prev = items;
		items = prev.filter((r) => r.id !== id);
		if (pendingSessionIds.has(id)) {
			const next = new Set(pendingSessionIds);
			next.delete(id);
			pendingSessionIds = next;
		}
		try {
			const res = await client.POST('/growth/{recommendation_id}/dismiss', {
				params: { path: { recommendation_id: id } },
				body: { workspace_id: workspaceID }
			});
			if (res.error) throw res.error;
		} catch {
			items = prev;
			toastMessage = m.grow_dismiss_failed();
			toastTone = 'error';
			setTimeout(() => (toastMessage = ''), 3000);
		}
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
	icon={UserRoundPlusIcon}
	loading={false}
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
					<LoaderIcon class="size-4 animate-spin" />
					{m.grow_refreshing()}
				{:else}
					<RefreshCwIcon class="size-4" />
					{m.grow_refresh()}
				{/if}
			</Button>
		{/if}
	{/snippet}

	<div class="flex min-w-0 flex-col gap-4">
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
						<LoaderIcon class="size-3.5 animate-spin" />
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

		{#if loading && items.length === 0}
			<PageLoading layout="grid" items={6} label={m.grow_loading()} />
		{:else if noCompatible}
			<EmptyState
				icon={UsersIcon}
				title={m.grow_no_compatible_title()}
				description={m.grow_no_compatible_description()}
				actionLabel={m.grow_connect_account()}
				actionHref="/settings?tab=accounts"
			/>
		{:else if noEligible}
			<EmptyState
				icon={UsersIcon}
				title={m.grow_feature_all_disabled_title()}
				description={m.grow_feature_all_disabled_description()}
				actionLabel={m.feature_disabled_open_details()}
				actionHref="/settings?tab=accounts"
			/>
		{:else if isStaleDisabled}
			{#if loading}
				<PageLoading layout="grid" items={6} label={m.grow_loading()} />
			{:else if filterEmpty}
				<EmptyState
					icon={UsersIcon}
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
					icon={UserRoundPlusIcon}
					title={m.grow_feature_disabled_title()}
					description={staleDetailMessage(staleGrowFeature)}
					actionLabel={m.feature_disabled_open_details()}
					actionHref="/settings?tab=accounts"
				/>
			{/if}
		{:else if neverGenerated}
			<EmptyState
				icon={UserRoundPlusIcon}
				title={m.grow_never_generated_title()}
				description={m.grow_never_generated_description()}
				actionLabel={m.grow_find_people()}
				onAction={canRefresh ? handleRefresh : undefined}
			/>
		{:else if isEmptyAfterSuccess}
			<EmptyState
				icon={UsersIcon}
				title={m.grow_empty_title()}
				description={m.grow_empty_description()}
				actionLabel={m.grow_refresh()}
				onAction={canRefresh ? handleRefresh : undefined}
			/>
		{:else if filterEmpty}
			<EmptyState
				icon={UsersIcon}
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
