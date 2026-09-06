<script lang="ts">
	import {
		notificationPreferencesQueryOptions,
		notificationQueryKeys
	} from '@openpost/query-catalog';
	import { createQuery } from '@tanstack/svelte-query';
	import { onMount, untrack } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { notificationQueryAPI } from '$lib/query/notifications';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { ThemeIcon } from '$lib/themes/icons';

	type NotificationMute = components['schemas']['Mute'];
	interface MuteMutationView {
		readonly session: QueryMutationSession;
		readonly workspaceID: string;
		readonly revision: number;
		readonly requestSequence: number;
	}

	let {
		workspaceID = '',
		workspaceName = '',
		notify = showToast,
		queryStatus = 'local'
	}: {
		workspaceID?: string;
		workspaceName?: string;
		notify?: typeof showToast;
		queryStatus?: 'local' | 'parent';
	} = $props();
	let mutes = $state.raw<NotificationMute[]>([]);
	let muteScope = $state<'account' | 'workspace'>('account');
	let muteEndsAt = $state(defaultMuteEnd());
	let createRequests = $state(0);
	let endingMuteIDs = $state.raw<Set<string>>(new Set());
	let mutationRevision = 0;
	let mutationRequestSequence = 0;
	let mutationWorkspaceID = '';
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	const muting = $derived(createRequests > 0);
	const preferencesQuery = createQuery(
		() => ({
			...notificationPreferencesQueryOptions(notificationQueryAPI),
			enabled: queryStatus === 'local'
		}),
		() => queryClient
	);
	const loading = $derived(preferencesQuery.isPending && !preferencesQuery.data);
	const initialError = $derived(
		preferencesQuery.isError && !preferencesQuery.data
			? queryErrorMessage(preferencesQuery.error)
			: ''
	);
	const staleError = $derived(
		preferencesQuery.isError && preferencesQuery.data
			? queryErrorMessage(preferencesQuery.error)
			: ''
	);
	let appliedPreferences: components['schemas']['PreferenceSettings'] | undefined;

	onMount(() => {
		return () => clearExpiryTimer();
	});

	$effect(() => {
		const data = preferencesQuery.data;
		if (!data || data === appliedPreferences) return;
		untrack(() => {
			appliedPreferences = data;
			applyMutes(data.mutes);
		});
	});

	$effect(() => {
		const nextWorkspaceID = workspaceID;
		if (nextWorkspaceID === mutationWorkspaceID) return;
		untrack(() => {
			mutationWorkspaceID = nextWorkspaceID;
			mutationRevision += 1;
			createRequests = 0;
			endingMuteIDs = new Set();
		});
	});

	function clearExpiryTimer() {
		if (expiryTimer !== undefined) clearTimeout(expiryTimer);
		expiryTimer = undefined;
	}

	function scheduleExpiryRefresh() {
		clearExpiryTimer();
		const nextExpiry = mutes.reduce((nearest, mute) => {
			const expiry = new Date(mute.ends_at).getTime();
			return expiry > Date.now() && expiry < nearest ? expiry : nearest;
		}, Number.POSITIVE_INFINITY);
		if (!Number.isFinite(nextExpiry)) return;
		const delay = Math.min(Math.max(nextExpiry - Date.now() + 25, 0), 2_147_000_000);
		expiryTimer = setTimeout(() => {
			applyMutes(mutes);
			void preferencesQuery.refetch();
		}, delay);
	}

	function applyMutes(nextMutes: NotificationMute[] | null | undefined) {
		const now = Date.now();
		mutes = (nextMutes ?? []).filter((mute) => new Date(mute.ends_at).getTime() > now);
		scheduleExpiryRefresh();
	}

	function defaultMuteEnd() {
		const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
		return new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
			.toISOString()
			.slice(0, 16);
	}

	function muteEndLabel(endsAt: string) {
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short'
		}).format(new Date(endsAt));
	}

	async function createMute() {
		const view = captureMuteMutationView();
		const end = new Date(muteEndsAt);
		if (!muteEndsAt || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
			notify(m.notifications_mute_invalid(), 'error');
			return;
		}
		if (muteScope === 'workspace' && !workspaceID) {
			notify(m.notifications_mute_workspace_unavailable(), 'error');
			return;
		}
		createRequests += 1;
		const {
			data,
			error: apiError,
			response
		} = await client.POST('/notifications/mutes', {
			body: {
				scope: muteScope,
				workspace_id: muteScope === 'workspace' ? workspaceID : undefined,
				ends_at: end.toISOString()
			}
		});
		const sessionIsCurrent = settleQueryMutationSession(view.session, response);
		if (view.revision === mutationRevision) {
			createRequests = Math.max(0, createRequests - 1);
		}
		if (!sessionIsCurrent) return;
		if (apiError || !data) {
			if (muteMutationViewIsCurrent(view)) {
				notify(
					apiError?.status === 400 ? m.notifications_mute_invalid() : m.notifications_mute_failed(),
					'error'
				);
			}
			return;
		}
		const reconciled = await reconcileQueryMutation(queryClient, view.session, {
			cancel: [{ queryKey: notificationQueryKeys.preferences(), exact: true }],
			reconcile: () => {
				if (view.requestSequence !== mutationRequestSequence) return;
				queryClient.setQueryData(notificationQueryKeys.preferences(), data);
			},
			invalidate: [{ queryKey: notificationQueryKeys.preferences(), exact: true }]
		});
		if (!reconciled || !muteMutationViewIsCurrent(view)) return;
		notify(m.notifications_mute_created(), 'success');
	}

	async function endMute(id: string) {
		const view = captureMuteMutationView();
		endingMuteIDs = new Set(endingMuteIDs).add(id);
		const {
			data,
			error: apiError,
			response
		} = await client.DELETE('/notifications/mutes/{id}', {
			params: { path: { id } }
		});
		const sessionIsCurrent = settleQueryMutationSession(view.session, response);
		if (view.revision === mutationRevision) {
			const remaining = new Set(endingMuteIDs);
			remaining.delete(id);
			endingMuteIDs = remaining;
		}
		if (!sessionIsCurrent) return;
		if (apiError || !data) {
			if (muteMutationViewIsCurrent(view)) {
				notify(m.notifications_mute_end_failed(), 'error');
			}
			return;
		}
		const reconciled = await reconcileQueryMutation(queryClient, view.session, {
			cancel: [{ queryKey: notificationQueryKeys.preferences(), exact: true }],
			reconcile: () => {
				if (view.requestSequence !== mutationRequestSequence) return;
				queryClient.setQueryData(notificationQueryKeys.preferences(), data);
			},
			invalidate: [{ queryKey: notificationQueryKeys.preferences(), exact: true }]
		});
		if (!reconciled || !muteMutationViewIsCurrent(view)) return;
		notify(m.notifications_mute_ended(), 'success');
	}

	function captureMuteMutationView(): MuteMutationView {
		return {
			session: captureQueryMutationSession(),
			workspaceID,
			revision: mutationRevision,
			requestSequence: ++mutationRequestSequence
		};
	}

	function muteMutationViewIsCurrent(view: MuteMutationView) {
		return (
			view.revision === mutationRevision &&
			view.workspaceID === workspaceID &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function queryErrorMessage(cause: unknown) {
		return cause instanceof Error && cause.message
			? cause.message
			: m.notifications_preferences_load_failed();
	}
</script>

<section
	class="space-y-4 rounded-lg border bg-muted/20 p-4"
	aria-labelledby="notification-mutes-heading"
>
	<div class="flex items-start gap-3">
		<ThemeIcon
			role="notification"
			class="mt-0.5 size-5 shrink-0 text-muted-foreground"
			aria-hidden="true"
		/>
		<div>
			<h2 id="notification-mutes-heading" class="text-sm font-semibold">
				{m.notifications_mutes_heading()}
			</h2>
			<p class="mt-1 text-sm leading-6 text-muted-foreground">
				{m.notifications_mutes_description()}
			</p>
		</div>
	</div>
	{#if queryStatus === 'local' && initialError}
		<InlineNotice tone="error" message={initialError}
			>{#snippet actions()}<Button
					variant="outline"
					size="sm"
					onclick={() => void preferencesQuery.refetch()}>{m.common_retry()}</Button
				>{/snippet}</InlineNotice
		>
	{:else}
		{#if queryStatus === 'local' && staleError}
			<InlineNotice tone="error" message={staleError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void preferencesQuery.refetch()}
						>{m.common_retry()}</Button
					>
				{/snippet}
			</InlineNotice>
		{/if}
		<div
			class="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end"
			aria-busy={loading}
		>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="notification-mute-scope"
					>{m.notifications_mute_scope()}</label
				><Select.Root type="single" bind:value={muteScope}
					><Select.Trigger id="notification-mute-scope" class="min-h-11 w-full"
						>{muteScope === 'workspace'
							? m.notifications_mute_workspace({ workspace: workspaceName })
							: m.notifications_mute_account()}</Select.Trigger
					><Select.Content
						><Select.Item value="account">{m.notifications_mute_account()}</Select.Item><Select.Item
							value="workspace"
							disabled={!workspaceID}
							>{m.notifications_mute_workspace({ workspace: workspaceName })}</Select.Item
						></Select.Content
					></Select.Root
				>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="notification-mute-end"
					>{m.notifications_mute_end_time()}</label
				><Input
					class="min-h-11"
					id="notification-mute-end"
					bind:value={muteEndsAt}
					type="datetime-local"
					required
				/>
			</div>
			<Button class="min-h-11" disabled={loading || muting} onclick={() => void createMute()}
				>{muting ? m.notifications_mute_creating() : m.notifications_mute_create()}</Button
			>
		</div>
		{#if mutes.length > 0}<ul class="space-y-2" aria-label={m.notifications_active_mutes()}>
				{#each mutes as mute (mute.id)}<li
						class="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
					>
						<p class="text-sm">
							<span class="font-medium"
								>{mute.scope === 'workspace'
									? m.notifications_mute_workspace({
											workspace: mute.workspace_name || mute.workspace_id || workspaceName
										})
									: m.notifications_mute_account()}</span
							><span class="block text-muted-foreground"
								>{m.notifications_muted_until({ end: muteEndLabel(mute.ends_at) })}</span
							>
						</p>
						<Button
							class="min-h-11"
							variant="outline"
							size="sm"
							disabled={endingMuteIDs.has(mute.id)}
							onclick={() => void endMute(mute.id)}
							>{endingMuteIDs.has(mute.id)
								? m.notifications_mute_ending()
								: m.notifications_mute_end_now()}</Button
						>
					</li>{/each}
			</ul>{/if}
	{/if}
</section>
