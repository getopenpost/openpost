<!--
THESIS: Grow turns mutual-graph evidence into plain, actionable follow candidates without hype.
OWN-WORLD: Warm canvas, hairline cards, compact Geist type, scarce Workshop Orange only on primary Follow.
STORY: Pick a compatible account in For, see evidence-based cards with mutual avatars and reason chips, follow, open, or dismiss with immediate clarity.
FIRST VIEWPORT: Page header with Grow plus Refresh, compact For selector plus last-updated meta, then 1-column phone / 2-col desktop / 3-col wide card grid.
FORM: Flat bordered cards in Workshop list grammar, centered page-container rhythm.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import GrowthProfileCard from '$lib/components/growth-profile-card.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Avatar from '$lib/components/ui/avatar';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { getPlatformName } from '$lib/utils';
	import {
		compatibleAccounts,
		selectInitialAccount,
		shouldPollSync,
		isSyncBusy,
		syncErrorKind,
		growthRankBucket,
		growthMutualBucket
	} from '$lib/growth-helpers';
	import type { RecommendationView, SyncStateView } from '$lib/growth-helpers';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import UserRoundPlusIcon from '@lucide/svelte/icons/user-round-plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import UsersIcon from '@lucide/svelte/icons/users';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	type SocialAccount = components['schemas']['AccountResponse'];

	let accounts = $state.raw<SocialAccount[]>([]);
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
	let dataRequestSeq = 0;
	let accountRequestSeq = 0;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let generationShown = $state<string>('');
	let openedCaptured = $state(false);

	const localeTag = $derived(getLocaleTag());
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const selectedAccount = $derived(
		selectedAccountID ? accounts.find((a) => a.id === selectedAccountID) : undefined
	);
	const platformName = $derived(selectedAccount ? getPlatformName(selectedAccount.platform) : '');
	const busy = $derived(isSyncBusy(syncState));
	const hasPendingFollow = $derived(items.some((i) => i.follow_state === 'pending'));
	const lastSuccessAt = $derived(syncState?.last_success_at ?? null);
	const compatible = $derived(compatibleAccounts(accounts));
	const showAccountSelector = $derived(compatible.length > 0);
	const noCompatible = $derived(!accountsLoading && compatible.length === 0);
	const neverGenerated = $derived(!loading && !noCompatible && compatible.length > 0 && !syncState);
	const showGrid = $derived(!loading && !noCompatible && !neverGenerated);
	const isEmptyAfterSuccess = $derived(
		showGrid && items.length === 0 && syncState?.status === 'success'
	);
	const lastUpdatedText = $derived(
		lastSuccessAt ? m.grow_last_updated({ date: formatDate(lastSuccessAt) }) : ''
	);

	// effects: workspace change
	$effect(() => {
		const wid = workspaceID;
		if (wid) {
			void loadAccounts(wid);
		}
	});

	// Effect for account selection -> load growth
	$effect(() => {
		const wid = workspaceID;
		const acc = selectedAccountID;
		if (wid && acc) {
			void loadGrowth(wid, acc);
		}
	});

	// Polling effect
	$effect(() => {
		const shouldPoll = shouldPollSync(syncState, hasPendingFollow);
		if (shouldPoll && workspaceID && selectedAccountID) {
			startPolling();
		} else {
			stopPolling();
		}
	});

	// Telemetry: growth opened once per workspace page visit after compatible accounts load
	$effect(() => {
		if (!accountsLoading && compatible.length >= 0 && workspaceID && !openedCaptured) {
			openedCaptured = true;
			captureTelemetryEvent('growth opened', { platform_count: compatible.length });
		}
	});

	// Reset captured when workspace changes
	$effect(() => {
		void workspaceID;
		openedCaptured = false;
		generationShown = '';
	});

	// Capture recommendation shown once per generation
	$effect(() => {
		if (items.length > 0 && currentGenerationID && generationShown !== currentGenerationID) {
			generationShown = currentGenerationID;
			for (let idx = 0; idx < items.length; idx++) {
				const rec = items[idx];
				captureTelemetryEvent('growth recommendation shown', {
					platform: rec.platform,
					rank_bucket: growthRankBucket(idx + 1),
					mutual_count_bucket: growthMutualBucket(rec.mutual_count),
					follows_viewer: rec.follows_viewer
				});
			}
		}
	});

	onMount(async () => {
		try {
			if (!workspaceCtx.currentWorkspace) await workspaceCtx.initialize();
		} catch {
			// workspace init failure handled via accounts load
		}
		if (workspaceCtx.currentWorkspace?.id) {
			await loadAccounts(workspaceCtx.currentWorkspace.id);
		} else {
			accountsLoading = false;
			loading = false;
		}
	});

	onDestroy(() => {
		stopPolling();
	});

	function startPolling() {
		stopPolling();
		pollTimer = setInterval(() => {
			if (workspaceID && selectedAccountID) {
				void loadGrowth(workspaceID, selectedAccountID, true);
			}
		}, 5000);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function loadAccounts(requestedWorkspaceID: string) {
		const seq = ++accountRequestSeq;
		accountsLoading = true;
		try {
			const response = await client.GET('/accounts', {
				params: { query: { workspace_id: requestedWorkspaceID } }
			});
			if (seq !== accountRequestSeq) return;
			if (response.error) throw new Error('load failed');
			// SAFETY: AccountResponse is the typed OpenAPI response; list is already validated by the generated client.
			const list = (response.data ?? []) as SocialAccount[];
			accounts = list;
			const nextID = selectInitialAccount(list, selectedAccountID);
			if (nextID !== selectedAccountID) {
				selectedAccountID = nextID;
				// clear previous state on account switch
				if (nextID) {
					items = [];
					syncState = null;
					currentGenerationID = '';
					inlineMessage = '';
					loading = true;
				} else {
					loading = false;
					items = [];
					syncState = null;
				}
			}
		} catch {
			if (seq !== accountRequestSeq) return;
			// preserve existing accounts where possible, but show inline notice
			if (accounts.length === 0) {
				inlineMessage = m.grow_load_failed();
				inlineTone = 'error';
				inlineActionLabel = m.grow_load_failed_retry();
				inlineActionHandler = () => {
					if (workspaceID) void loadAccounts(workspaceID);
				};
			}
		} finally {
			if (seq === accountRequestSeq) accountsLoading = false;
			if (!selectedAccountID) loading = false;
		}
	}

	async function loadGrowth(ws: string, acc: string, isPoll = false) {
		const seq = ++dataRequestSeq;
		if (!isPoll) {
			loading = items.length === 0;
			inlineMessage = '';
		}
		try {
			const response = await client.GET('/growth', {
				params: { query: { workspace_id: ws, account_id: acc } }
			});
			if (seq !== dataRequestSeq) return;
			if (response.error) {
				throw response.error;
			}
			// SAFETY: Growth list response shape matches the OpenAPI ListResult for this workspace/account query.
			const data = response.data as {
				items: RecommendationView[] | null;
				sync_state: SyncStateView | null;
			};
			const newItems = data.items ?? [];
			const newSync = data.sync_state ?? null;
			// Preserve old items on error - here we have success so update
			// Handle follow state transitions: if item was pending and now following/requested -> show briefly then remove
			// We will detect following/requested and schedule removal
			const previousItems = items;
			syncState = newSync;
			currentGenerationID = newSync?.current_generation_id ?? '';
			// Handle follow transitions: keep pending items until polling confirms, then fade
			// For following/requested, briefly keep visible then remove smoothly
			// We implement removal after short delay to communicate state
			const hasFollowingTransitions = newItems.some(
				(it) => it.follow_state === 'following' || it.follow_state === 'requested'
			);
			if (hasFollowingTransitions) {
				// Keep items but mark those with following/requested for removal after toast? We'll keep but filtered after delay
				// To avoid layout chaos, remove after 1.2s with fade
				const idsToRemove = new Set(
					newItems
						.filter((it) => it.follow_state === 'following' || it.follow_state === 'requested')
						.map((it) => it.id)
				);
				// Update immediately to show Following/Requested state
				items = newItems;
				if (idsToRemove.size > 0) {
					setTimeout(() => {
						if (seq !== dataRequestSeq) return;
						items = items.filter((it) => !idsToRemove.has(it.id));
					}, 1200);
				}
			} else {
				// Check for failed follow states: restore toast already handled via error? But if follow_state failed we keep
				items = newItems;
			}

			// Handle sync error inline notices while preserving cards
			if (newSync) {
				const kind = syncErrorKind(newSync);
				if (kind === 'rate_limited') {
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
				} else {
					// clear inline if success and no busy
					if (newSync.status === 'success') {
						inlineMessage = '';
						inlineActionLabel = '';
						inlineActionHandler = null;
					}
				}
			}
			loading = false;
		} catch (err) {
			if (seq !== dataRequestSeq) return;
			// Preserve old cards where possible
			if (items.length > 0) {
				inlineMessage = m.grow_load_failed();
				inlineTone = 'error';
				inlineActionLabel = m.grow_load_failed_retry();
				inlineActionHandler = () => {
					if (workspaceID && selectedAccountID) void loadGrowth(workspaceID, selectedAccountID);
				};
			} else {
				inlineMessage = m.grow_load_failed();
				inlineTone = 'error';
				inlineActionLabel = m.grow_load_failed_retry();
				inlineActionHandler = () => {
					if (workspaceID && selectedAccountID) void loadGrowth(workspaceID, selectedAccountID);
				};
			}
			loading = false;
		}
	}

	async function handleRefresh() {
		if (!workspaceID || !selectedAccountID) return;
		if (busy) return;
		try {
			const res = await client.POST('/growth/refresh', {
				body: { workspace_id: workspaceID, account_id: selectedAccountID }
			});
			if (res.error) throw res.error;
			// Mark busy optimistically
			if (syncState) {
				syncState = { ...syncState, status: 'queued' };
			} else {
				// SAFETY: Synthetic queued sync state mirrors the API SyncStateView for optimistic busy UI.
				syncState = {
					id: '',
					workspace_id: workspaceID,
					social_account_id: selectedAccountID,
					platform: selectedAccount?.platform ?? '',
					status: 'queued',
					current_generation_id: currentGenerationID,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				} as SyncStateView;
			}
			startPolling();
			// polling will update
		} catch {
			toastMessage = m.grow_refresh_failed();
			toastTone = 'error';
			setTimeout(() => (toastMessage = ''), 3000);
		}
	}

	async function handleFollow(id: string) {
		if (!workspaceID) return;
		// optimistic pending
		const prev = items;
		items = items.map((it) => (it.id === id ? { ...it, follow_state: 'pending' } : it));
		try {
			const res = await client.POST('/growth/{recommendation_id}/follow', {
				params: { path: { recommendation_id: id } },
				body: { workspace_id: workspaceID }
			});
			if (res.error) throw res.error;
			// keep pending, polling will resolve
		} catch {
			items = prev;
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
		const removed = prev.find((r) => r.id === id);
		items = prev.filter((r) => r.id !== id);
		try {
			const res = await client.POST('/growth/{recommendation_id}/dismiss', {
				params: { path: { recommendation_id: id } },
				body: { workspace_id: workspaceID }
			});
			if (res.error) throw res.error;
			// success stays removed
		} catch {
			items = prev;
			toastMessage = m.grow_dismiss_failed();
			toastTone = 'error';
			setTimeout(() => (toastMessage = ''), 3000);
		}
	}

	function handleOpenProfile(rec: RecommendationView) {
		const idx = items.findIndex((r) => r.id === rec.id);
		captureTelemetryEvent('growth profile opened', {
			platform: rec.platform,
			rank_bucket: growthRankBucket(idx >= 0 ? idx + 1 : 1),
			mutual_count_bucket: growthMutualBucket(rec.mutual_count),
			follows_viewer: rec.follows_viewer
		});
		if (rec.profile_url) {
			window.open(rec.profile_url, '_blank', 'noreferrer');
		}
	}

	function formatDate(dateStr: string): string {
		try {
			const d = new Date(dateStr);
			if (Number.isNaN(d.getTime())) return dateStr;
			return new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium', timeStyle: 'short' }).format(
				d
			);
		} catch {
			return dateStr;
		}
	}

	function selectDisplayLabel(acc: SocialAccount): string {
		const handle = acc.account_username ? `@${acc.account_username}` : acc.account_id;
		const plat = getPlatformName(acc.platform);
		return `${handle} (${plat})`;
	}
</script>

<PageContainer
	title={m.grow_title()}
	description={m.grow_description()}
	icon={UserRoundPlusIcon}
	loading={loading && !showGrid && !noCompatible && !neverGenerated}
	loadingLayout="grid"
	loadingItems={6}
>
	{#snippet actions()}
		{#if selectedAccountID && !noCompatible}
			<Button
				variant="outline"
				size="sm"
				onclick={handleRefresh}
				disabled={busy}
				aria-label={busy ? m.grow_refreshing() : m.grow_refresh()}
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
						onValueChange={(v) => (selectedAccountID = v)}
					>
						<Select.Trigger
							id="grow-account-select"
							class="h-9 w-full"
							aria-label={m.grow_for_label()}
						>
							{#if selectedAccount}
								<span class="flex items-center gap-2 truncate">
									<Avatar.Root class="size-6 shrink-0 rounded-full">
										{#if selectedAccount.account_avatar_url}
											<Avatar.Image src={selectedAccount.account_avatar_url} alt="" />
										{/if}
										<Avatar.Fallback class="rounded-full bg-muted text-[10px]">
											{(selectedAccount.account_username || '?').slice(0, 1).toUpperCase()}
										</Avatar.Fallback>
									</Avatar.Root>
									<span class="truncate">{selectDisplayLabel(selectedAccount)}</span>
									<PlatformIcon platform={selectedAccount.platform} class="size-3.5 shrink-0" />
								</span>
							{:else}
								<span class="text-muted-foreground">{m.grow_account_placeholder()}</span>
							{/if}
						</Select.Trigger>
						<Select.Content>
							{#each compatible as acc (acc.id)}
								<Select.Item value={acc.id}>
									<span class="flex items-center gap-2">
										<Avatar.Root class="size-5 shrink-0 rounded-full">
											{#if acc.account_avatar_url}
												<Avatar.Image src={acc.account_avatar_url} alt="" />
											{/if}
											<Avatar.Fallback class="rounded-full bg-muted text-[10px]">
												{(acc.account_username || '?').slice(0, 1).toUpperCase()}
											</Avatar.Fallback>
										</Avatar.Root>
										<span>{selectDisplayLabel(acc)}</span>
										<PlatformIcon platform={acc.platform} class="size-3.5" />
									</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if lastUpdatedText}
					<span class="text-xs text-muted-foreground">{lastUpdatedText}</span>
				{/if}
				{#if busy}
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

		{#if inlineMessage}
			<InlineNotice tone={inlineTone} message={inlineMessage}>
				{#snippet actions()}
					{#if inlineActionLabel && inlineActionHandler}
						<Button variant="outline" size="sm" onclick={inlineActionHandler}
							>{inlineActionLabel}</Button
						>
					{/if}
				{/snippet}
			</InlineNotice>
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
		{:else if neverGenerated}
			<EmptyState
				icon={UserRoundPlusIcon}
				title={m.grow_never_generated_title()}
				description={m.grow_never_generated_description()}
				actionLabel={m.grow_find_people()}
				onAction={handleRefresh}
			/>
		{:else if isEmptyAfterSuccess}
			<EmptyState
				icon={UsersIcon}
				title={m.grow_empty_title()}
				description={m.grow_empty_description()}
				actionLabel={m.grow_refresh()}
				onAction={handleRefresh}
			/>
		{:else if showGrid}
			{#if busy && items.length > 0}
				<div class="text-xs text-muted-foreground" aria-live="polite">{m.grow_refreshing()}</div>
			{/if}
			<div
				class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
				data-testid="growth-grid"
			>
				{#each items as rec, index (rec.id)}
					<GrowthProfileCard
						recommendation={rec}
						position={index + 1}
						onFollow={handleFollow}
						onDismiss={handleDismiss}
						onOpenProfile={handleOpenProfile}
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
