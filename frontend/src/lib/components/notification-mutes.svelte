<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';

	type NotificationMute = components['schemas']['Mute'];
	let { workspaceID = '', workspaceName = '' }: { workspaceID?: string; workspaceName?: string } =
		$props();
	let loading = $state(true);
	let error = $state('');
	let mutes = $state.raw<NotificationMute[]>([]);
	let muteScope = $state<'account' | 'workspace'>('account');
	let muteEndsAt = $state(defaultMuteEnd());
	let createRequests = $state(0);
	let endingMuteIDs = $state.raw<Set<string>>(new Set());
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	let loadSequence = 0;
	let mutationSequence = 0;
	const muting = $derived(createRequests > 0);

	onMount(() => {
		void load();
		return () => clearExpiryTimer();
	});

	async function load() {
		const loadToken = ++loadSequence;
		const mutationToken = mutationSequence;
		loading = true;
		error = '';
		const { data, error: apiError } = await client.GET('/notifications/preferences');
		if (loadToken === loadSequence && mutationToken === mutationSequence) {
			if (apiError || !data) error = apiError?.detail || m.notifications_preferences_load_failed();
			else applyMutes(data.mutes);
		}
		if (loadToken === loadSequence) loading = false;
	}

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
			void load();
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
		const end = new Date(muteEndsAt);
		if (!muteEndsAt || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
			showToast(m.notifications_mute_invalid(), 'error');
			return;
		}
		if (muteScope === 'workspace' && !workspaceID) {
			showToast(m.notifications_mute_workspace_unavailable(), 'error');
			return;
		}
		createRequests += 1;
		mutationSequence += 1;
		const { data, error: apiError } = await client.POST('/notifications/mutes', {
			body: {
				scope: muteScope,
				workspace_id: muteScope === 'workspace' ? workspaceID : undefined,
				ends_at: end.toISOString()
			}
		});
		createRequests -= 1;
		if (apiError || !data) {
			showToast(
				apiError?.status === 400 ? m.notifications_mute_invalid() : m.notifications_mute_failed(),
				'error'
			);
			await load();
			return;
		}
		await load();
		showToast(m.notifications_mute_created(), 'success');
	}

	async function endMute(id: string) {
		endingMuteIDs = new Set(endingMuteIDs).add(id);
		mutationSequence += 1;
		const { data, error: apiError } = await client.DELETE('/notifications/mutes/{id}', {
			params: { path: { id } }
		});
		const remaining = new Set(endingMuteIDs);
		remaining.delete(id);
		endingMuteIDs = remaining;
		if (apiError || !data) {
			showToast(m.notifications_mute_end_failed(), 'error');
			await load();
			return;
		}
		await load();
		showToast(m.notifications_mute_ended(), 'success');
	}
</script>

<section
	class="space-y-4 rounded-lg border bg-muted/20 p-4"
	aria-labelledby="notification-mutes-heading"
>
	<div class="flex items-start gap-3">
		<BellOffIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
		<div>
			<h2 id="notification-mutes-heading" class="text-sm font-semibold">
				{m.notifications_mutes_heading()}
			</h2>
			<p class="mt-1 text-sm leading-6 text-muted-foreground">
				{m.notifications_mutes_description()}
			</p>
		</div>
	</div>
	{#if error}
		<InlineNotice tone="error" message={error}
			>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => void load()}
					>{m.common_retry()}</Button
				>{/snippet}</InlineNotice
		>
	{:else}
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
