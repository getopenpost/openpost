<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { SocialAccount } from '$lib/api/client';
	import { loadWorkspaceAccounts } from '$lib/api/performance-cache';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import {
		createOpenPostVoiceProfilesClient,
		localizedVoiceProfilesCopy,
		type VoiceProfileAccount,
		type VoiceProfilesClient
	} from '$lib/voice-profiles';
	import { formatAccountHandle, getPlatformName } from '$lib/utils';
	import VoiceProfilesSettings from './voice-profiles-settings.svelte';

	interface Props {
		workspaceId: string;
		active?: boolean;
		canEdit?: boolean;
		profileClient?: VoiceProfilesClient;
		accountLoader?: (workspaceId: string) => Promise<SocialAccount[]>;
	}

	let {
		workspaceId,
		active = true,
		canEdit = true,
		profileClient = createOpenPostVoiceProfilesClient(),
		accountLoader = (targetWorkspaceId) => loadWorkspaceAccounts(targetWorkspaceId, true)
	}: Props = $props();

	const copy = localizedVoiceProfilesCopy();
	let accounts = $state.raw<VoiceProfileAccount[]>([]);
	let accountsLoading = $state(false);
	let accountsError = $state('');
	let attemptedWorkspaceId = '';
	let presentedWorkspaceId = '';
	let requestSequence = 0;
	let destroyed = false;

	function accountLabel(account: SocialAccount): string {
		return (
			formatAccountHandle(account.account_username) ||
			account.slug?.trim() ||
			getPlatformName(account.platform)
		);
	}

	function mapAccount(account: SocialAccount): VoiceProfileAccount {
		return {
			id: account.id,
			label: accountLabel(account),
			platform: account.platform,
			handle: getPlatformName(account.platform),
			active: account.is_active
		};
	}

	async function loadAccounts(): Promise<void> {
		const targetWorkspaceId = workspaceId.trim();
		if (!targetWorkspaceId) return;
		const sequence = ++requestSequence;
		attemptedWorkspaceId = targetWorkspaceId;
		if (presentedWorkspaceId !== targetWorkspaceId) accounts = [];
		accountsLoading = true;
		accountsError = '';
		try {
			const loaded = await accountLoader(targetWorkspaceId);
			if (destroyed || sequence !== requestSequence || workspaceId.trim() !== targetWorkspaceId) {
				return;
			}
			accounts = loaded.map(mapAccount);
			presentedWorkspaceId = targetWorkspaceId;
		} catch (cause) {
			if (destroyed || sequence !== requestSequence || workspaceId.trim() !== targetWorkspaceId) {
				return;
			}
			const detail = cause instanceof Error ? cause.message.trim() : '';
			accountsError = detail || m.settings_voice_accounts_load_failed();
		} finally {
			if (!destroyed && sequence === requestSequence) accountsLoading = false;
		}
	}

	$effect(() => {
		const targetWorkspaceId = workspaceId.trim();
		if (!targetWorkspaceId) {
			untrack(() => {
				requestSequence += 1;
				attemptedWorkspaceId = '';
				presentedWorkspaceId = '';
				accounts = [];
				accountsLoading = false;
				accountsError = '';
			});
			return;
		}
		if (!active || attemptedWorkspaceId === targetWorkspaceId) return;
		untrack(() => void loadAccounts());
	});

	onDestroy(() => {
		destroyed = true;
		requestSequence += 1;
	});
</script>

<div class="space-y-5">
	{#if !canEdit}
		<InlineNotice tone="info" message={m.settings_voice_read_only()} />
	{/if}
	{#if accountsError}
		<InlineNotice tone="error" message={accountsError}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => void loadAccounts()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{/if}
	<VoiceProfilesSettings
		{workspaceId}
		client={profileClient}
		{accounts}
		{accountsLoading}
		{active}
		{canEdit}
		{copy}
		showHeader={false}
	/>
</div>
