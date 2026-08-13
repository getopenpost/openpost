<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { client, type Workspace, type SocialAccount, type ProviderInfo } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageContainer from '$lib/components/page-container.svelte';
	import SettingsNavigation from '$lib/components/settings-navigation.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import { formatAccountHandle, getPlatformName, getPlatformColor } from '$lib/utils';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import {
		accountRemovalKinds,
		grantDestinationCount,
		type AccountRemovalKind
	} from './account-removal';
	import {
		presentProviderReadiness,
		type ProviderReadinessDecision,
		type ProviderReadinessPresentation
	} from '$lib/provider-readiness';

	type ProviderEntry = ProviderInfo & { readiness?: ProviderReadinessDecision };

	type AccountRemovalAction = {
		kind: AccountRemovalKind;
		account: SocialAccount;
	};

	let embedded = $derived(page.url.pathname === '/settings');

	let workspaces = $derived<Workspace[]>(workspaceCtx.workspaces);
	let authState = $derived($auth);
	let selectedWorkspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let loading = $state(true);
	let error = $state('');

	let accounts = $state<SocialAccount[]>([]);
	let accountsLoading = $state(false);
	let accountsLoadError = $state('');
	let accountsRequestSequence = 0;

	let providerEntries = $state.raw<ProviderEntry[]>([]);
	let providersLoading = $state(false);
	let providersLoadError = $state('');
	let mastodonModalOpen = $state(false);
	let customMastodonInstance = $state('');
	let customMastodonLoading = $state(false);
	let mastodonError = $state('');
	let mastodonProviders = $derived(
		providerEntries.filter((provider) => provider.platform === 'mastodon')
	);
	let connectionProviderEntries = $derived.by(() => {
		const preferredMastodon =
			mastodonProviders.find(isCustomMastodonProvider) ?? mastodonProviders[0];
		return providerEntries.filter(
			(provider) => provider.platform !== 'mastodon' || provider === preferredMastodon
		);
	});
	let selectedWorkspaceName = $derived(
		workspaces?.find((workspace) => workspace.id === selectedWorkspaceId)?.name ||
			m.accounts_select_workspace()
	);
	let toastMessage = $state('');
	let toastActionHref = $state('');
	let toastActionLabel = $state('');
	let toastTone = $state<'neutral' | 'error'>('neutral');

	let blueskyModalOpen = $state(false);
	let blueskyHandle = $state('');
	let blueskyAppPassword = $state('');
	let blueskyLoading = $state(false);
	let blueskyError = $state('');
	let discordModalOpen = $state(false);
	let discordWebhookUrl = $state('');
	let discordLoading = $state(false);
	let discordError = $state('');
	let oauthConfirmOpen = $state(false);
	let oauthConfirmProvider = $state.raw<ProviderEntry | null>(null);

	let editAccountDialogOpen = $state(false);
	let editingAccount = $state<SocialAccount | null>(null);
	let editAccountSlug = $state('');
	let editMessagesEnabled = $state(false);
	const unsavedChanges = getOptionalUnsavedChanges();
	const accountEditDirty = $derived(
		Boolean(
			editingAccount &&
			(editAccountSlug !== accountSlug(editingAccount) ||
				(editingAccount.messaging_supported &&
					editMessagesEnabled !== (editingAccount.messages_enabled ?? false)))
		)
	);

	$effect(() => {
		unsavedChanges?.set('social-account-settings', accountEditDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('social-account-settings');
	});
	let editAccountLoading = $state(false);
	let editAccountError = $state('');
	let accountRemovalDialogOpen = $state(false);
	let accountRemovalAction = $state.raw<AccountRemovalAction | null>(null);
	const accountSlugPattern = '[a-z0-9][a-z0-9-]{0,62}';

	function clearToast() {
		toastMessage = '';
		toastActionHref = '';
		toastActionLabel = '';
		toastTone = 'neutral';
	}

	function showToast(
		message: string,
		action?: { href: string; label: string },
		tone: 'neutral' | 'error' = 'error'
	) {
		error = '';
		toastMessage = message;
		toastActionHref = action?.href ?? '';
		toastActionLabel = action?.label ?? '';
		toastTone = tone;
	}

	function connectErrorMessage(value: unknown, fallback: string): string {
		if (value && typeof value === 'object') {
			const maybeError = value as { detail?: string; message?: string };
			return maybeError.detail || maybeError.message || fallback;
		}
		return fallback;
	}

	function showConnectError(value: unknown, fallback: string = m.accounts_connect_failed()) {
		const message = connectErrorMessage(value, fallback);
		const lower = message.toLowerCase();
		const needsBilling = lower.includes('subscription') || lower.includes('social account limit');
		showToast(
			message,
			needsBilling
				? { href: '/settings?tab=billing#billing', label: m.accounts_open_billing() }
				: undefined
		);
	}

	async function loadAccounts(workspaceID = selectedWorkspaceId) {
		if (!workspaceID) {
			accountsRequestSequence++;
			accountsLoading = false;
			accountsLoadError = '';
			accounts = [];
			return;
		}
		const requestSequence = ++accountsRequestSequence;
		const isCurrentRequest = () =>
			requestSequence === accountsRequestSequence && selectedWorkspaceId === workspaceID;
		accountsLoading = true;
		accountsLoadError = '';
		accounts = [];
		try {
			const { data, error: err } = await client.GET('/accounts', {
				params: { query: { workspace_id: workspaceID } }
			});
			if (err) throw new Error(err.detail || m.accounts_load_failed());
			if (!isCurrentRequest()) return;
			accounts = data ?? [];
		} catch (e) {
			if (!isCurrentRequest()) return;
			console.error('Failed to load accounts:', e);
			accountsLoadError = (e as Error).message;
		} finally {
			if (isCurrentRequest()) accountsLoading = false;
		}
	}

	async function loadProviders() {
		providersLoading = true;
		providersLoadError = '';
		try {
			const { data, error: err } = await client.GET('/accounts/providers');
			if (err) throw new Error(err.detail ?? m.accounts_providers_load_failed());
			providerEntries = (data ?? []) as ProviderEntry[];
		} catch (e) {
			console.error('Failed to load account providers:', e);
			providersLoadError =
				e instanceof Error && e.message ? e.message : m.accounts_providers_load_failed();
			providerEntries = [];
		} finally {
			providersLoading = false;
		}
	}

	function requestAccountRemoval(account: SocialAccount, kind: AccountRemovalKind) {
		accountRemovalAction = { account, kind };
		accountRemovalDialogOpen = true;
	}

	function accountRemovalActionLabel(account: SocialAccount, kind: AccountRemovalKind): string {
		if (kind === 'disconnect-destination') return m.accounts_disconnect_destination();
		const count = grantDestinationCount(account);
		return count > 1
			? m.accounts_remove_shared_authorization({ count })
			: m.accounts_remove_connection();
	}

	function accountRemovalTitle(): string {
		const action = accountRemovalAction;
		if (!action) return '';
		const account = accountDisplayName(action.account);
		if (action.kind === 'disconnect-destination') {
			return m.accounts_disconnect_destination_title({ account });
		}
		const count = grantDestinationCount(action.account);
		return count > 1
			? m.accounts_remove_shared_title({ count })
			: m.accounts_remove_connection_title({ account });
	}

	function accountRemovalDescription(): string {
		const action = accountRemovalAction;
		if (!action) return '';
		const account = accountDisplayName(action.account);
		const count = grantDestinationCount(action.account);
		if (action.kind === 'disconnect-destination') {
			return m.accounts_disconnect_destination_body({ account, count });
		}
		const platform = getPlatformName(action.account.platform);
		return count > 1
			? m.accounts_remove_shared_body({ count, platform })
			: m.accounts_remove_connection_body({
					account,
					platform
				});
	}

	function accountRemovalConfirmLabel(): string {
		const action = accountRemovalAction;
		if (!action) return '';
		if (action.kind === 'disconnect-destination') return m.accounts_disconnect_destination();
		return grantDestinationCount(action.account) > 1
			? m.accounts_remove_authorization()
			: m.accounts_remove_connection();
	}

	async function confirmAccountRemoval() {
		const action = accountRemovalAction;
		if (!action) return;
		const account = action.account;
		const count = grantDestinationCount(account);
		try {
			const result =
				action.kind === 'disconnect-destination'
					? await client.DELETE('/accounts/{account_id}', {
							params: { path: { account_id: account.id } }
						})
					: await client.DELETE('/accounts/{account_id}/grant', {
							params: { path: { account_id: account.id } }
						});
			const fallback =
				action.kind === 'disconnect-destination'
					? m.accounts_disconnect_failed()
					: m.accounts_remove_authorization_failed();
			if (result.error) throw new Error(result.error.detail || fallback);
			await loadAccounts();
			if (action.kind === 'disconnect-destination') {
				showToast(
					m.accounts_destination_disconnected_success({ account: accountDisplayName(account) }),
					undefined,
					'neutral'
				);
			} else if (count > 1) {
				showToast(m.accounts_authorization_removed_success({ count }), undefined, 'neutral');
			} else {
				showToast(
					m.accounts_connection_removed_success({ account: accountDisplayName(account) }),
					undefined,
					'neutral'
				);
			}
		} catch (e) {
			error =
				e instanceof Error && e.message
					? e.message
					: action.kind === 'disconnect-destination'
						? m.accounts_disconnect_failed()
						: m.accounts_remove_authorization_failed();
		}
	}

	function accountDisplayName(account: SocialAccount): string {
		const handle = formatAccountHandle(account.account_username);
		if (handle) return handle;
		if (account.instance_url) return account.instance_url.replace('https://', '');
		return account.account_id || account.platform;
	}

	function accountSlug(account: SocialAccount): string {
		return account.slug || account.account_username || account.account_id || account.platform;
	}

	function accountServer(account: SocialAccount): string {
		if (account.platform !== 'mastodon' || !account.instance_url) return '';
		try {
			return new URL(account.instance_url).host;
		} catch {
			return account.instance_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
		}
	}

	function openEditAccount(account: SocialAccount) {
		editingAccount = account;
		editAccountSlug = account.slug ?? '';
		editMessagesEnabled = account.messages_enabled ?? false;
		editAccountError = '';
		editAccountDialogOpen = true;
	}

	function handleEditAccountDialogOpen(nextOpen: boolean) {
		if (!nextOpen && accountEditDirty && unsavedChanges && !unsavedChanges.confirmDiscard()) return;
		editAccountDialogOpen = nextOpen;
		if (!nextOpen) editingAccount = null;
	}

	async function updateAccountSlug() {
		if (!editingAccount) return;
		editAccountLoading = true;
		editAccountError = '';
		try {
			const { error: err } = await client.PATCH('/accounts/{account_id}', {
				params: { path: { account_id: editingAccount.id } },
				body: {
					slug: editAccountSlug.trim(),
					messages_enabled: editingAccount.messaging_supported ? editMessagesEnabled : undefined
				}
			});
			if (err) throw new Error(err.detail || m.accounts_update_slug_failed());
			if (editingAccount.messaging_supported && editMessagesEnabled && selectedWorkspaceId) {
				await client.POST('/communications/refresh', {
					body: { workspace_id: selectedWorkspaceId }
				});
			}
			editAccountDialogOpen = false;
			editingAccount = null;
			await loadAccounts();
		} catch (e) {
			editAccountError =
				e instanceof Error && e.message ? e.message : m.accounts_update_slug_failed();
		} finally {
			editAccountLoading = false;
		}
	}

	onMount(() => {
		if (!embedded) {
			const params = new URLSearchParams(window.location.search);
			params.set('tab', 'accounts');
			void goto(resolve(`/settings?${params.toString()}`), { replaceState: true });
			return;
		}
		const params = new URLSearchParams(window.location.search);
		const urlError = params.get('error');
		if (urlError) {
			error = urlError;
			params.delete('error');
			if (params.size) {
				replaceState(resolve(`/settings?${params.toString()}`), {});
			} else {
				replaceState(resolve('/settings'), {});
			}
		}

		const unsubscribe = auth.subscribe(async (state) => {
			if (!state.isLoading && !state.isAuthenticated) {
				goto(resolve('/login'));
			} else if (!state.isLoading && state.isAuthenticated) {
				try {
					if (workspaceCtx.workspaces.length === 0) {
						await workspaceCtx.initialize();
					}
					await loadProviders();
				} catch (e) {
					console.error('Failed to load workspaces:', e);
				} finally {
					loading = false;
				}
			}
		});
		return unsubscribe;
	});

	$effect(() => {
		const workspaceID = selectedWorkspaceId;
		void loadAccounts(workspaceID);
	});

	async function connectTwitter() {
		if (!selectedWorkspaceId) {
			showToast(m.accounts_create_workspace_first());
			return;
		}
		try {
			const { data, error: err } = await client.GET('/accounts/{platform}/auth-url', {
				params: { path: { platform: 'x' }, query: { workspace_id: selectedWorkspaceId } }
			});
			if (err) throw new Error((err as any).detail || m.accounts_x_connection_start_failed());
			if (!data?.url) throw new Error(m.accounts_x_connection_start_failed());
			window.location.href = data.url;
		} catch (e) {
			showConnectError(e);
		}
	}

	type MastodonConnectionOptions = { serverName?: string; instanceURL?: string };

	async function connectMastodon(options: MastodonConnectionOptions) {
		if (!selectedWorkspaceId) {
			throw new Error(m.accounts_create_workspace_first());
		}

		rememberMastodonConnection(options);
		const { data, error: err } = await client.GET('/accounts/{platform}/auth-url', {
			params: {
				path: { platform: 'mastodon' },
				query: {
					workspace_id: selectedWorkspaceId,
					server_name: options.serverName,
					instance_url: options.instanceURL
				}
			}
		});
		if (err) throw new Error((err as any).detail || m.accounts_connect_failed());
		if (!data?.url) throw new Error(m.accounts_connect_failed());
		window.location.href = data.url;
	}

	async function connectCustomMastodon() {
		const options = mastodonConnectionOptions();
		if (!options) return;
		customMastodonLoading = true;
		mastodonError = '';
		try {
			await connectMastodon(options);
		} catch (e) {
			mastodonError = connectErrorMessage(e, m.accounts_connect_failed());
		} finally {
			customMastodonLoading = false;
		}
	}

	async function connectBluesky() {
		if (!selectedWorkspaceId) {
			showToast(m.accounts_create_workspace_first());
			return;
		}
		clearToast();
		blueskyHandle = '';
		blueskyAppPassword = '';
		blueskyError = '';
		blueskyModalOpen = true;
	}

	async function submitBlueskyLogin() {
		if (!blueskyHandle.trim() || !blueskyAppPassword.trim()) {
			blueskyError = m.accounts_bluesky_fields_required();
			return;
		}

		blueskyLoading = true;
		blueskyError = '';

		try {
			const { error: err } = await client.POST('/accounts/bluesky/login', {
				body: {
					workspace_id: selectedWorkspaceId,
					handle: blueskyHandle.trim(),
					app_password: blueskyAppPassword.trim()
				}
			});
			if (err) throw new Error(err.detail || m.accounts_login_failed());
			blueskyModalOpen = false;
			await loadAccounts();
		} catch (e) {
			blueskyError = e instanceof Error && e.message ? e.message : m.accounts_login_failed();
			showConnectError(e, m.accounts_login_failed());
		} finally {
			blueskyLoading = false;
		}
	}

	function connectDiscord() {
		if (!selectedWorkspaceId) {
			showToast(m.accounts_create_workspace_first());
			return;
		}
		clearToast();
		discordWebhookUrl = '';
		discordError = '';
		discordModalOpen = true;
	}

	async function submitDiscordWebhook() {
		if (!discordWebhookUrl.trim()) {
			discordError = m.accounts_discord_url_required();
			return;
		}
		discordLoading = true;
		discordError = '';
		try {
			const { error: err } = await client.POST('/accounts/discord/webhook', {
				body: {
					workspace_id: selectedWorkspaceId,
					webhook_url: discordWebhookUrl.trim()
				}
			});
			if (err) throw new Error(err.detail || m.accounts_connect_failed());
			discordModalOpen = false;
			await loadAccounts();
		} catch (requestError) {
			discordError = connectErrorMessage(requestError, m.accounts_discord_verify_failed());
		} finally {
			discordLoading = false;
		}
	}

	async function connectOAuthProvider(platform: string) {
		if (!selectedWorkspaceId) {
			showToast(m.accounts_create_workspace_first());
			return;
		}
		try {
			localStorage.setItem('oauth_workspace_id', selectedWorkspaceId);
			const { data, error: err } = await client.GET('/accounts/{platform}/auth-url', {
				params: {
					path: { platform },
					query: { workspace_id: selectedWorkspaceId }
				}
			});
			if (err) throw new Error((err as any).detail || m.accounts_connect_failed());
			if (!data?.url) throw new Error(m.accounts_connect_failed());
			window.location.href = data.url;
		} catch (e) {
			showConnectError(e);
		}
	}

	const connectLinkedIn = () => connectOAuthProvider('linkedin');
	const connectThreads = () => connectOAuthProvider('threads');
	const connectTikTok = () => connectOAuthProvider('tiktok');
	const connectFacebook = () => connectOAuthProvider('facebook');
	const connectInstagram = () => connectOAuthProvider('instagram');
	const connectYouTube = () => connectOAuthProvider('youtube');

	function providerKey(provider: ProviderEntry): string {
		return provider.platform;
	}

	function providerTitle(provider: ProviderEntry): string {
		return provider.display_name || getPlatformName(provider.platform);
	}

	function providerDescription(provider: ProviderEntry): string {
		if (provider.platform === 'mastodon') {
			return m.accounts_provider_custom_mastodon();
		}
		switch (provider.platform) {
			case 'x':
				return m.accounts_provider_x();
			case 'threads':
				return m.accounts_provider_threads();
			case 'bluesky':
				return m.accounts_provider_bluesky();
			case 'discord':
				return m.accounts_provider_discord();
			case 'linkedin':
				return m.accounts_provider_linkedin();
			case 'instagram':
				return m.accounts_provider_instagram();
			case 'facebook':
				return m.accounts_provider_facebook();
			case 'youtube':
				return m.accounts_provider_youtube();
			case 'tiktok':
				return m.accounts_provider_tiktok();
			default:
				return provider.description || m.accounts_provider_default();
		}
	}

	function providerReadiness(provider: ProviderEntry): ProviderReadinessPresentation {
		return presentProviderReadiness(provider.readiness, 'connect');
	}

	function providerStatusLabel(provider: ProviderEntry): string {
		if (provider.status === 'planned') return m.accounts_provider_planned();
		switch (providerReadiness(provider).state) {
			case 'unsupported':
				return m.provider_readiness_label_unsupported();
			case 'disabled':
				return m.provider_readiness_label_disabled();
			case 'needs_configuration':
				return m.provider_readiness_label_needs_configuration();
			case 'reconnect_required':
				return m.provider_readiness_label_reconnect_required();
			case 'degraded':
				return m.provider_readiness_label_degraded();
			case 'approval_required':
				return m.provider_readiness_label_approval_required();
			case 'trial_only':
				return m.provider_readiness_label_trial_only();
			case 'policy_restricted':
				return m.provider_readiness_label_policy_restricted();
			case 'certification_required':
				return m.provider_readiness_label_certification_required();
			case 'expired_proof':
				return m.provider_readiness_label_expired_proof();
			case 'healthy':
			default:
				return '';
		}
	}

	function providerStatusClass(provider: ProviderEntry): string {
		if (provider.status === 'planned') {
			return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300';
		}
		switch (providerReadiness(provider).tone) {
			case 'warning':
				return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300';
			case 'error':
				return 'border-destructive/20 bg-destructive/10 text-destructive';
			case 'neutral':
			default:
				return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300';
		}
	}

	function providerReadinessMessage(provider: ProviderEntry): string {
		const platform = providerTitle(provider);
		switch (providerReadiness(provider).state) {
			case 'unsupported':
				return m.provider_readiness_unsupported({ platform });
			case 'disabled':
				return m.provider_readiness_disabled({ platform });
			case 'needs_configuration':
				return m.provider_readiness_needs_configuration({ platform });
			case 'reconnect_required':
				return m.provider_readiness_reconnect_required({ platform });
			case 'degraded':
				return m.provider_readiness_degraded({ platform });
			case 'approval_required':
				return m.provider_readiness_approval_required({ platform });
			case 'trial_only':
				return m.provider_readiness_trial_only({ platform });
			case 'policy_restricted':
				return m.provider_readiness_policy_restricted({ platform });
			case 'certification_required':
				return m.provider_readiness_certification_required({ platform });
			case 'expired_proof':
				return m.provider_readiness_expired_proof({ platform });
			case 'healthy':
			default:
				return '';
		}
	}

	function providerCanConnect(provider: ProviderEntry): boolean {
		return provider.status !== 'planned' && providerReadiness(provider).canProceed;
	}

	function providerActionEnabled(provider: ProviderEntry): boolean {
		return providerCanConnect(provider) || providerReadiness(provider).action === 'retry';
	}

	function providerActionLabel(provider: ProviderEntry): string {
		if (provider.status === 'planned') return m.accounts_provider_planned();
		if (providerCanConnect(provider)) return m.common_connect();
		switch (providerReadiness(provider).action) {
			case 'retry':
				return m.accounts_provider_retry_readiness();
			case 'reconnect':
				return m.activity_reconnect_account();
			case 'configure':
			case 'contact_admin':
			default:
				return m.accounts_provider_ask_admin();
		}
	}

	function handleProviderAction(provider: ProviderEntry) {
		if (providerCanConnect(provider)) {
			connectProvider(provider);
			return;
		}
		if (providerReadiness(provider).action === 'retry') void loadProviders();
	}

	function isCustomMastodonProvider(provider: ProviderEntry): boolean {
		return (
			provider.platform === 'mastodon' && providerCanConnect(provider) && !provider.instance_url
		);
	}

	function mastodonHost(value: string): string {
		try {
			const url = new URL(value.includes('://') ? value : `https://${value}`);
			return url.host.toLowerCase();
		} catch {
			return '';
		}
	}

	function mastodonConnectionOptions(): MastodonConnectionOptions | null {
		const instance = customMastodonInstance.trim();
		if (!instance) {
			mastodonError = m.accounts_enter_mastodon_instance();
			return null;
		}

		if (mastodonProviders.some(isCustomMastodonProvider)) {
			return { instanceURL: instance };
		}

		const instanceHost = mastodonHost(instance);
		const configuredProvider = mastodonProviders.find(
			(provider) =>
				(provider.instance_url && mastodonHost(provider.instance_url) === instanceHost) ||
				provider.name?.toLowerCase() === instance.toLowerCase()
		);
		if (configuredProvider) {
			return { serverName: configuredProvider.name || configuredProvider.instance_url };
		}

		mastodonError = m.accounts_mastodon_instance_unavailable();
		return null;
	}

	function openMastodonModal() {
		if (!selectedWorkspaceId) {
			showToast(m.accounts_create_workspace_first());
			return;
		}
		clearToast();
		customMastodonInstance = '';
		mastodonError = '';
		mastodonModalOpen = true;
	}

	function rememberMastodonConnection(options: MastodonConnectionOptions) {
		if (!selectedWorkspaceId) return;
		localStorage.setItem('oauth_workspace_id', selectedWorkspaceId);
		if (options.instanceURL) {
			localStorage.setItem('oauth_mastodon_instance_url', options.instanceURL);
			localStorage.removeItem('oauth_mastodon_server');
		} else if (options.serverName) {
			localStorage.setItem('oauth_mastodon_server', options.serverName);
			localStorage.removeItem('oauth_mastodon_instance_url');
		}
	}

	async function canOpenMastodonCode(options: MastodonConnectionOptions): Promise<boolean> {
		if (!selectedWorkspaceId) {
			mastodonError = m.accounts_create_workspace_first();
			return false;
		}

		const query: { workspace_id: string; server_name?: string; instance_url?: string } = {
			workspace_id: selectedWorkspaceId,
			server_name: options.serverName,
			instance_url: options.instanceURL
		};

		try {
			const { error: err } = await client.GET('/accounts/{platform}/auth-url', {
				params: { path: { platform: 'mastodon' }, query }
			});
			if (err) {
				throw new Error((err as any).detail || m.accounts_mastodon_connection_start_failed());
			}
			return true;
		} catch (e) {
			mastodonError = connectErrorMessage(e, m.accounts_connect_failed());
			return false;
		}
	}

	async function openMastodonCode() {
		const options = mastodonConnectionOptions();
		if (!options || !(await canOpenMastodonCode(options))) return;
		rememberMastodonConnection(options);
		goto(resolve('/accounts/mastodon/callback'));
	}

	function providerUsesOAuth(provider: ProviderEntry): boolean {
		return [
			'x',
			'mastodon',
			'threads',
			'linkedin',
			'instagram',
			'facebook',
			'youtube',
			'tiktok'
		].includes(provider.platform);
	}

	function connectProvider(provider: ProviderEntry) {
		if (!providerCanConnect(provider)) return;
		if (providerUsesOAuth(provider)) {
			oauthConfirmProvider = provider;
			oauthConfirmOpen = true;
			return;
		}
		beginProviderConnection(provider);
	}

	function confirmOAuthConnection() {
		const provider = oauthConfirmProvider;
		if (!provider) return;
		oauthConfirmOpen = false;
		beginProviderConnection(provider);
	}

	function beginProviderConnection(provider: ProviderEntry) {
		switch (provider.platform) {
			case 'x':
				connectTwitter();
				break;
			case 'mastodon':
				openMastodonModal();
				break;
			case 'threads':
				connectThreads();
				break;
			case 'bluesky':
				connectBluesky();
				break;
			case 'discord':
				connectDiscord();
				break;
			case 'linkedin':
				connectLinkedIn();
				break;
			case 'instagram':
				connectInstagram();
				break;
			case 'facebook':
				connectFacebook();
				break;
			case 'youtube':
				connectYouTube();
				break;
			case 'tiktok':
				connectTikTok();
				break;
		}
	}
</script>

{#if toastMessage}
	<AppToast
		message={toastMessage}
		tone={toastTone}
		onDismiss={clearToast}
		dismissLabel={m.common_dismiss()}
		actionHref={toastActionHref || undefined}
		actionLabel={toastActionLabel || undefined}
	/>
{/if}

<PageContainer
	title={m.accounts_heading()}
	description={m.accounts_description()}
	icon={UsersIcon}
	{loading}
	loadingLayout="sections"
	loadingMessage={m.common_loading()}
	{embedded}
>
	<div class={embedded ? 'min-w-0' : 'grid min-w-0 gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]'}>
		{#if !embedded}
			<SettingsNavigation active="accounts" showInstance={Boolean(authState.user?.is_admin)} />
		{/if}
		<div class:min-w-0={!embedded} class="min-w-0">
			{#if !workspaces || workspaces.length === 0}
				<EmptyState
					icon={UsersIcon}
					title={m.accounts_no_workspaces_title()}
					description={m.accounts_no_workspaces_body()}
					actionLabel={m.accounts_create_workspace()}
					actionHref="/"
					variant="muted"
				/>
			{:else}
				{#if page.url.searchParams.get('onboarding') === '1' && accounts.length === 0}
					<div class="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-5">
						<p class="text-sm font-medium text-primary">{m.accounts_onboarding_progress()}</p>
						<h2 class="mt-1 text-lg font-semibold">{m.accounts_onboarding_heading()}</h2>
						<p class="mt-1 text-sm/6 text-muted-foreground">
							{m.accounts_onboarding_description()}
						</p>
						<ol class="mt-4 grid gap-2 text-sm sm:grid-cols-3">
							<li class="flex items-center gap-2 text-muted-foreground">
								<span
									class="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-700"
									>✓</span
								>
								{m.accounts_onboarding_plan_done()}
							</li>
							<li class="flex items-center gap-2 font-medium">
								<span
									class="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
									>2</span
								>
								{m.accounts_onboarding_connect()}
							</li>
							<li class="flex items-center gap-2 text-muted-foreground">
								<span
									class="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold"
									>3</span
								>
								{m.accounts_onboarding_post()}
							</li>
						</ol>
					</div>
				{/if}
				{#if error}
					<InlineNotice
						tone="error"
						message={error}
						dismissLabel={m.common_dismiss()}
						onDismiss={() => (error = '')}
						class="mb-6"
					/>
				{/if}

				<!-- Connected Accounts -->
				<div class="mb-10">
					<SectionHeader
						title={m.accounts_connected_channels()}
						description={accountsLoadError
							? undefined
							: m.accounts_connection_summary({
									count: accounts.length,
									workspace: selectedWorkspaceName
								})}
						class="mb-4"
					>
						{#snippet actions()}
							<Button href="/" size="sm">{m.accounts_create_post()}</Button>
						{/snippet}
					</SectionHeader>

					{#if accountsLoadError}
						<div data-testid="accounts-load-error">
							<InlineNotice tone="error" message={accountsLoadError}>
								{#snippet actions()}
									<Button
										variant="outline"
										size="sm"
										onclick={() => void loadAccounts()}
										disabled={accountsLoading}
									>
										{m.common_retry()}
									</Button>
								{/snippet}
							</InlineNotice>
						</div>
					{:else if accountsLoading}
						<PageLoading layout="grid" label={m.common_loading()} items={3} />
					{:else if !accounts || accounts.length === 0}
						<EmptyState
							icon={UsersIcon}
							title={m.accounts_empty_title()}
							description={m.accounts_empty_body()}
							variant="muted"
							size="md"
							headingLevel={3}
						/>
					{:else}
						<div
							class="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-3"
						>
							{#each accounts as account (account.id)}
								<article
									data-testid={`account-card-${account.id}`}
									class="flex min-h-28 flex-col justify-between gap-3 bg-background p-4"
								>
									<div class="flex items-start gap-3">
										<div
											class="flex size-10 shrink-0 items-center justify-center rounded-lg {getPlatformColor(
												account.platform
											)}"
										>
											<PlatformIcon platform={account.platform} class="size-5 text-white" />
										</div>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<h3 class="truncate text-sm font-semibold">
													{getPlatformName(account.platform)}
												</h3>
												{#if !account.is_active}
													<span
														class="size-1.5 rounded-full bg-amber-500"
														aria-label={m.accounts_connection_paused()}
													></span>
												{/if}
											</div>
											<p class="mt-1 truncate text-sm text-muted-foreground">
												{accountDisplayName(account)}
											</p>
										</div>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="ghost"
														size="icon-sm"
														aria-label={m.accounts_actions_for({
															account: accountDisplayName(account)
														})}
													>
														<MoreHorizontalIcon class="size-4" />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end" class="w-64">
												<DropdownMenu.Item onclick={() => openEditAccount(account)}
													>{m.accounts_details()}</DropdownMenu.Item
												>
												<DropdownMenu.Separator />
												{#each accountRemovalKinds(account) as kind (kind)}
													<DropdownMenu.Item
														class="text-destructive"
														onclick={() => requestAccountRemoval(account, kind)}
													>
														{accountRemovalActionLabel(account, kind)}
													</DropdownMenu.Item>
												{/each}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
									<div
										class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
									>
										<span class="inline-flex min-w-0 items-center gap-1.5">
											<span>{m.accounts_shortcut()}</span>
											<code
												class="max-w-44 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground"
												>{accountSlug(account)}</code
											>
										</span>
										{#if accountServer(account)}
											<span class="truncate">{m.accounts_server()}: {accountServer(account)}</span>
										{/if}
										{#if !account.is_active}
											<span class="text-amber-700 dark:text-amber-300"
												>{m.accounts_connection_paused()}</span
											>
										{/if}
									</div>
								</article>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Connect a Platform -->
				<div>
					<SectionHeader
						title={m.accounts_add_channel()}
						description={m.accounts_add_channel_body()}
						class="mb-4"
					/>

					{#if providersLoadError}
						<div data-testid="providers-load-error">
							<InlineNotice tone="error" message={providersLoadError}>
								{#snippet actions()}
									<Button
										variant="outline"
										size="sm"
										onclick={() => void loadProviders()}
										disabled={providersLoading}
									>
										{m.common_retry()}
									</Button>
								{/snippet}
							</InlineNotice>
						</div>
					{:else if providersLoading}
						<PageLoading layout="grid" label={m.common_loading()} items={4} />
					{:else}
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{#each connectionProviderEntries as provider (providerKey(provider))}
								<div
									data-testid={`provider-card-${provider.platform}`}
									class="group flex h-full min-h-28 flex-col rounded-lg border bg-card p-4 transition-all hover:shadow-sm {providerCanConnect(
										provider
									)
										? ''
										: 'bg-muted/20'}"
								>
									<div class="flex items-start gap-3">
										<div
											class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {getPlatformColor(
												provider.platform
											)}"
										>
											<PlatformIcon platform={provider.platform} class="h-4 w-4 text-white" />
										</div>
										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-center gap-2">
												<h3 class="text-sm font-medium">{providerTitle(provider)}</h3>
												{#if provider.status === 'planned' || !providerReadiness(provider).quiet}
													<span
														class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium {providerStatusClass(
															provider
														)}"
													>
														{providerStatusLabel(provider)}
													</span>
												{/if}
											</div>
											<p class="truncate text-sm text-muted-foreground">
												{providerDescription(provider)}
											</p>
											{#if provider.status !== 'planned' && !providerReadiness(provider).quiet}
												<p
													data-testid={`provider-readiness-${provider.platform}`}
													class="mt-1 text-xs leading-5 text-muted-foreground"
												>
													{providerReadinessMessage(provider)}
												</p>
											{/if}
										</div>
									</div>
									<Button
										class="mt-3 min-h-11 self-end sm:min-h-9"
										onclick={() => handleProviderAction(provider)}
										size="sm"
										disabled={!providerActionEnabled(provider)}
									>
										{providerActionLabel(provider)}
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={accountRemovalDialogOpen}
	title={accountRemovalTitle()}
	description={accountRemovalDescription()}
	confirmLabel={accountRemovalConfirmLabel()}
	onConfirm={confirmAccountRemoval}
/>

<Dialog.Root bind:open={oauthConfirmOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{m.accounts_oauth_confirm_title({
					platform: oauthConfirmProvider
						? providerTitle(oauthConfirmProvider)
						: m.accounts_callback_social_account()
				})}
			</Dialog.Title>
			<Dialog.Description>{m.accounts_oauth_confirm_description()}</Dialog.Description>
		</Dialog.Header>
		<ol class="space-y-3 text-sm">
			<li class="flex gap-3">
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
					>1</span
				>
				<span>{m.accounts_oauth_step_redirect()}</span>
			</li>
			<li class="flex gap-3">
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
					>2</span
				>
				<span>{m.accounts_oauth_step_approve()}</span>
			</li>
			<li class="flex gap-3">
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
					>3</span
				>
				<span>{m.accounts_oauth_step_return()}</span>
			</li>
		</ol>
		<div
			class="rounded-md border border-emerald-500/20 bg-emerald-500/8 p-3 text-sm text-emerald-800 dark:text-emerald-200"
		>
			<p class="font-medium">{m.accounts_oauth_password_title()}</p>
			<p class="mt-1 text-xs/5">{m.accounts_oauth_password_description()}</p>
		</div>
		<Dialog.Footer>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="outline">{m.common_cancel()}</Button>
				{/snippet}
			</Dialog.Close>
			<Button onclick={confirmOAuthConnection}>
				{m.accounts_oauth_continue({
					platform: oauthConfirmProvider
						? providerTitle(oauthConfirmProvider)
						: m.accounts_callback_social_account()
				})}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={mastodonModalOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_connect_mastodon()}</Dialog.Title>
			<Dialog.Description>{m.accounts_mastodon_description()}</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(e: SubmitEvent) => {
				e.preventDefault();
				connectCustomMastodon();
			}}
		>
			<div class="space-y-2">
				<Label for="mastodon-server">{m.accounts_mastodon_server_address()}</Label>
				<Input
					id="mastodon-server"
					class="h-11 sm:h-9"
					bind:value={customMastodonInstance}
					placeholder="mastodon.social"
					autocomplete="url"
					autocapitalize="none"
					spellcheck="false"
					required
				/>
			</div>
			{#if mastodonError}
				<InlineNotice
					tone="error"
					message={mastodonError}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => (mastodonError = '')}
				/>
			{/if}
			<div class="flex flex-wrap justify-end gap-2">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} class="min-h-11 sm:min-h-9" variant="outline" type="button">
							{m.common_cancel()}
						</Button>
					{/snippet}
				</Dialog.Close>
				<Button
					class="min-h-11 sm:min-h-9"
					variant="outline"
					type="button"
					onclick={openMastodonCode}
				>
					{m.accounts_code()}
				</Button>
				<Button class="min-h-11 sm:min-h-9" type="submit" disabled={customMastodonLoading}>
					{customMastodonLoading ? m.common_connecting() : m.common_connect()}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={blueskyModalOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_connect_bluesky()}</Dialog.Title>
			<Dialog.Description>
				{m.accounts_bluesky_description()}
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				submitBlueskyLogin();
			}}
		>
			<div class="space-y-2">
				<Label for="bluesky-handle">{m.accounts_handle()}</Label>
				<Input
					type="text"
					id="bluesky-handle"
					bind:value={blueskyHandle}
					placeholder="user.bsky.social"
					required
				/>
			</div>
			<div class="space-y-2">
				<Label for="bluesky-password">{m.accounts_app_password()}</Label>
				<Input
					type="password"
					id="bluesky-password"
					bind:value={blueskyAppPassword}
					placeholder="xxxx-xxxx-xxxx-xxxx"
					required
				/>
			</div>
			{#if blueskyError}
				<InlineNotice
					tone="error"
					message={blueskyError}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => (blueskyError = '')}
				/>
			{/if}
			<div class="flex justify-end gap-2">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" type="button">{m.common_cancel()}</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={blueskyLoading}>
					{blueskyLoading ? m.common_connecting() : m.common_connect()}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={discordModalOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_connect_discord()}</Dialog.Title>
			<Dialog.Description>{m.accounts_discord_description()}</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				void submitDiscordWebhook();
			}}
		>
			<div class="space-y-2">
				<Label for="discord-webhook-url">{m.accounts_discord_webhook_url()}</Label>
				<Input
					id="discord-webhook-url"
					type="password"
					bind:value={discordWebhookUrl}
					placeholder="https://discord.com/api/webhooks/…"
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					required
				/>
				<p class="text-sm text-muted-foreground">{m.accounts_discord_url_help()}</p>
			</div>
			{#if discordError}
				<InlineNotice
					tone="error"
					message={discordError}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => (discordError = '')}
				/>
			{/if}
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" type="button">{m.common_cancel()}</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" disabled={discordLoading}>
					{discordLoading ? m.accounts_discord_verifying() : m.common_connect()}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editAccountDialogOpen} onOpenChange={handleEditAccountDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.accounts_details()}</Dialog.Title>
			<Dialog.Description>
				{m.accounts_details_description()}
			</Dialog.Description>
		</Dialog.Header>
		{#if editingAccount}
			<form
				class="space-y-4"
				onsubmit={(e) => {
					e.preventDefault();
					updateAccountSlug();
				}}
			>
				<div class="rounded-md bg-muted/40 p-3 text-sm">
					<div class="font-medium">{accountDisplayName(editingAccount)}</div>
					<div class="text-muted-foreground">{getPlatformName(editingAccount.platform)}</div>
					{#if editingAccount.account_kind}
						<div class="mt-1 text-xs text-muted-foreground capitalize">
							{editingAccount.account_kind.replaceAll('_', ' ')}
						</div>
					{/if}
					{#if accountServer(editingAccount)}
						<div class="mt-1 text-xs text-muted-foreground">
							{m.accounts_server()}: {accountServer(editingAccount)}
						</div>
					{/if}
				</div>
				{#if editingAccount.messaging_supported}
					<div class="space-y-3 rounded-md border p-3">
						<div class="flex items-start gap-3">
							<Checkbox
								id="account-messages-enabled"
								class="mt-1"
								bind:checked={editMessagesEnabled}
							/>
							<div class="space-y-1">
								<Label for="account-messages-enabled">{m.accounts_inbox_sync()}</Label>
								<p class="text-xs text-muted-foreground">
									{m.accounts_inbox_sync_description()}
								</p>
							</div>
						</div>
						{#if editingAccount.platform === 'facebook' || editingAccount.platform === 'instagram'}
							<p class="text-xs text-muted-foreground">
								{m.accounts_inbox_meta_window()}
							</p>
						{:else if editingAccount.platform === 'mastodon'}
							<p class="text-xs text-muted-foreground">
								{m.accounts_inbox_mastodon_notice()}
							</p>
						{/if}
					</div>
				{/if}
				<div class="space-y-3 rounded-md border p-3">
					<h3 class="text-sm font-medium">{m.accounts_developer_shortcut()}</h3>
					<p class="text-xs text-muted-foreground">
						{m.accounts_shortcut_example()}
						<code class="rounded bg-muted px-1 py-0.5"
							>openpost post create --accounts {editAccountSlug || 'main-x'}</code
						>.
					</p>
					<div class="space-y-2">
						<Label for="account-slug">{m.accounts_shortcut()}</Label>
						<Input
							id="account-slug"
							bind:value={editAccountSlug}
							placeholder="main-x"
							pattern={accountSlugPattern}
							required
						/>
						<p class="text-xs text-muted-foreground">
							{m.accounts_shortcut_hint()}
						</p>
					</div>
				</div>
				{#if editAccountError}
					<InlineNotice
						tone="error"
						message={editAccountError}
						dismissLabel={m.common_dismiss()}
						onDismiss={() => (editAccountError = '')}
					/>
				{/if}
				<div class="flex justify-end gap-2">
					<Dialog.Close>
						{#snippet child({ props })}
							<Button {...props} variant="outline" type="button">{m.common_cancel()}</Button>
						{/snippet}
					</Dialog.Close>
					<Button type="submit" disabled={editAccountLoading || !editAccountSlug.trim()}>
						{editAccountLoading ? m.common_saving() : m.accounts_save_details()}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
