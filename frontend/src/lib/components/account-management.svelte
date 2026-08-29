<script lang="ts">
	import { client, type SocialAccount, type ProviderInfo } from '$lib/api/client';
	import type { AccountManagementProps } from '$lib/account-management';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import PageContainer from '$lib/components/page-container.svelte';
	import SettingsNavigation from '$lib/components/settings-navigation.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import WorkspaceSetupGuide from '$lib/components/workspace-setup-guide.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import { formatAccountHandle, getPlatformName, getPlatformColor } from '$lib/utils';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { accountSetupHref } from '$lib/account-management-route';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { m } from '$lib/paraglide/messages';
	import AccountFeaturePresentation from '$lib/components/account-feature-presentation.svelte';
	import type { components } from '$lib/api/types';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import {
		accountRemovalKinds,
		grantDestinationCount,
		type AccountRemovalKind
	} from '$lib/account-removal';
	import {
		presentProviderReadiness,
		type ProviderReadinessPresentation
	} from '$lib/provider-readiness';

	type ProviderEntry = ProviderInfo;
	let {
		workspace,
		workspaces,
		links,
		loading = false,
		showInstanceSettings = false,
		feedback = null,
		onFeedbackDismiss = () => undefined,
		onContinue,
		onAccountsChanged
	}: AccountManagementProps = $props();

	type AccountRemovalAction = {
		kind: AccountRemovalKind;
		account: SocialAccount;
	};

	function isConnectorAccount(account: SocialAccount): boolean {
		return Boolean(account.provider_installation_id);
	}

	function isConnectorProvider(provider: ProviderEntry): boolean {
		return provider.auth_mode === 'preconfigured' && Boolean(provider.installation_id);
	}

	let embedded = true;
	let selectedWorkspaceId = $derived(workspace?.id ?? '');
	let canEditWorkspace = $derived(workspace?.can_edit ?? false);
	let error = $state('');

	let accounts = $state<SocialAccount[]>([]);
	let accountsLoading = $state(false);
	let accountsLoadError = $state('');
	let accountsWorkspaceID = '';
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
	let lastFailedProvider = $state.raw<ProviderEntry | null>(null);
	let lastFailedMessage = $state('');
	let setupRequiredOpen = $state(false);
	let connectingInstallationID = $state('');

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
	let editFeatureSelections = $state<Record<string, boolean>>({});
	let editFeatures = $state<components['schemas']['FeatureStateResponse'][]>([]);
	let editFeaturesLoading = $state(false);
	let editFeaturesError = $state('');
	let editFeaturesInitial = $state<Record<string, boolean>>({});
	const unsavedChanges = getOptionalUnsavedChanges();
	const accountEditDirty = $derived(
		Boolean(
			editingAccount &&
			(editAccountSlug !== accountSlug(editingAccount) ||
				JSON.stringify(editFeatureSelections) !== JSON.stringify(editFeaturesInitial))
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

	type Feature = components['schemas']['FeatureStateResponse'];
	let accountFeatures = $state<Feature[]>([]);
	let accountFeaturesLoading = $state(false);
	let undecidedAccountIds = $derived.by(() => {
		const grouped = new Map<string, Feature[]>();
		for (const f of accountFeatures) {
			if (!grouped.has(f.social_account_id)) grouped.set(f.social_account_id, []);
			grouped.get(f.social_account_id)!.push(f);
		}
		const ids: string[] = [];
		for (const [accountId, feats] of grouped) {
			const hasUndecided = feats.some((f) => f.supported && !f.stored_exists);
			if (hasUndecided) ids.push(accountId);
		}
		return ids;
	});
	let showFeatureReminder = $derived(
		undecidedAccountIds.length > 0 && !accountsLoading && !accountFeaturesLoading
	);

	async function loadAccountFeatures(workspaceID: string, accountIds: string[]) {
		if (!workspaceID || accountIds.length === 0) {
			accountFeatures = [];
			return;
		}
		accountFeaturesLoading = true;
		try {
			const { data, error: err } = await client.GET('/account-features', {
				params: {
					query: {
						workspace_id: workspaceID,
						account_ids: accountIds.join(',')
					}
				}
			});
			if (err) {
				accountFeatures = [];
				return;
			}
			accountFeatures = data ?? [];
		} catch {
			accountFeatures = [];
		} finally {
			accountFeaturesLoading = false;
		}
	}

	function reminderAccountName(): string {
		if (undecidedAccountIds.length === 1) {
			const id = undecidedAccountIds[0];
			const acc = accounts.find((a) => a.id === id);
			if (acc) return formatAccountHandle(acc.account_username) || getPlatformName(acc.platform);
			return id.slice(0, 8);
		}
		return '';
	}

	function reminderSetupHref(): string {
		return accountSetupHref({
			workspaceID: selectedWorkspaceId,
			accountIDs: accounts.map((a) => a.id),
			newAccountIDs: undecidedAccountIds,
			openFreshComposer: false
		});
	}

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

	function connectErrorMessage(error: Error, fallback: string): string {
		const message = error.message.trim();
		if (/failed to resolve instance_url host/i.test(message)) {
			return m.accounts_mastodon_connection_start_failed();
		}
		if (
			/x auth url generation failed|oauth1 .*request token failed|callback url not approved/i.test(
				message
			)
		) {
			return m.accounts_x_connection_start_failed();
		}
		return message || fallback;
	}

	function showConnectError(
		error: Error,
		fallback: string = m.accounts_connect_failed(),
		provider: ProviderEntry | null = null
	) {
		const message = connectErrorMessage(error, fallback);
		const lower = message.toLowerCase();
		const needsBilling = lower.includes('subscription') || lower.includes('social account limit');
		lastFailedProvider = provider ?? lastFailedProvider;
		lastFailedMessage = message;
		showToast(
			message,
			needsBilling ? { href: links.billingHref, label: m.accounts_open_billing() } : undefined
		);
	}

	function clearConnectionFailure() {
		lastFailedProvider = null;
		lastFailedMessage = '';
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
		const workspaceChanged = accountsWorkspaceID !== workspaceID;
		accountsWorkspaceID = workspaceID;
		accountsLoading = true;
		accountsLoadError = '';
		if (workspaceChanged) accounts = [];
		try {
			const { data, error: err } = await client.GET('/accounts', {
				params: { query: { workspace_id: workspaceID } }
			});
			if (err) throw new Error(err.detail || m.accounts_load_failed());
			if (!isCurrentRequest()) return;
			accounts = data ?? [];
			if (accounts.length > 0) {
				void loadAccountFeatures(
					workspaceID,
					accounts.map((a) => a.id)
				);
			} else {
				accountFeatures = [];
			}
		} catch (e) {
			if (!isCurrentRequest()) return;
			console.error('Failed to load accounts:', e);
			accountsLoadError = e instanceof Error ? e.message : m.accounts_load_failed();
		} finally {
			if (isCurrentRequest()) accountsLoading = false;
		}
	}

	async function loadProviders(workspaceID = selectedWorkspaceId) {
		providersLoading = true;
		providersLoadError = '';
		try {
			const { data, error: err } = await client.GET('/accounts/providers', {
				params: { query: { workspace_id: workspaceID || undefined } }
			});
			if (err) throw new Error(err.detail ?? m.accounts_providers_load_failed());
			providerEntries = data ?? [];
			if (lastFailedMessage) clearConnectionFailure();
		} catch (e) {
			console.error('Failed to load account providers:', e);
			providersLoadError =
				e instanceof Error && e.message ? e.message : m.accounts_providers_load_failed();
		} finally {
			providersLoading = false;
		}
	}

	let directProviders = $derived(
		connectionProviderEntries.filter((provider) => !providerNeedsAdminSetup(provider))
	);
	let setupRequiredProviders = $derived(connectionProviderEntries.filter(providerNeedsAdminSetup));
	let hasConnectionFailure = $derived(Boolean(lastFailedMessage || providersLoadError));

	function requestAccountRemoval(account: SocialAccount, kind: AccountRemovalKind) {
		accountRemovalAction = { account, kind };
		accountRemovalDialogOpen = true;
	}

	function accountRemovalActionLabel(account: SocialAccount, kind: AccountRemovalKind): string {
		if (isConnectorAccount(account)) return m.accounts_connector_remove_action();
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
		if (isConnectorAccount(action.account)) {
			return m.accounts_connector_remove_title({ account });
		}
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
		if (isConnectorAccount(action.account)) {
			return m.accounts_connector_remove_body({ account });
		}
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
		if (isConnectorAccount(action.account)) return m.accounts_connector_remove_action();
		if (action.kind === 'disconnect-destination') return m.accounts_disconnect_destination();
		return grantDestinationCount(action.account) > 1
			? m.accounts_remove_authorization()
			: m.accounts_remove_connection();
	}

	async function confirmAccountRemoval(): Promise<DestructiveActionOutcome> {
		const action = accountRemovalAction;
		if (!action) return { ok: false };
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
			onAccountsChanged();
			const successMessage = isConnectorAccount(account)
				? m.accounts_connector_removed_success({
						account: accountDisplayName(account)
					})
				: action.kind === 'disconnect-destination'
					? m.accounts_destination_disconnected_success({
							account: accountDisplayName(account)
						})
					: count > 1
						? m.accounts_authorization_removed_success({ count })
						: m.accounts_connection_removed_success({
								account: accountDisplayName(account)
							});
			return { ok: true, successMessage };
		} catch (e) {
			return {
				ok: false,
				message:
					e instanceof Error && e.message
						? e.message
						: action.kind === 'disconnect-destination'
							? m.accounts_disconnect_failed()
							: m.accounts_remove_authorization_failed()
			};
		}
	}

	function accountDisplayName(account: SocialAccount): string {
		const handle = formatAccountHandle(account.account_username);
		if (handle) return handle;
		if (account.instance_url) return account.instance_url.replace('https://', '');
		return account.account_id || account.platform;
	}

	function accountPlatformName(account: SocialAccount): string {
		const provider = providerEntries.find(
			(entry) =>
				(entry.installation_id && entry.installation_id === account.provider_installation_id) ||
				(!entry.installation_id && entry.platform === account.platform)
		);
		return provider ? providerTitle(provider) : getPlatformName(account.platform);
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

	async function openEditAccount(account: SocialAccount) {
		editingAccount = account;
		editAccountSlug = account.slug ?? '';
		editAccountError = '';
		editFeatures = [];
		editFeatureSelections = {};
		editFeaturesInitial = {};
		editFeaturesError = '';
		editAccountDialogOpen = true;
		editFeaturesLoading = true;
		try {
			const { data, error: err } = await client.GET('/account-features', {
				params: {
					query: { workspace_id: selectedWorkspaceId, account_ids: account.id }
				}
			});
			if (err) {
				editFeaturesError = err.detail ?? m.account_setup_error_load_failed();
				return;
			}
			editFeatures = data ?? [];
			const offered = editFeatures.filter((f) => f.availability !== 'unsupported');
			const next: Record<string, boolean> = {};
			for (const f of offered) {
				next[f.feature] = f.stored_exists ? f.stored_enabled : f.effective_enabled;
			}
			editFeatureSelections = { ...next };
			editFeaturesInitial = { ...next };
		} catch (e) {
			editFeaturesError = e instanceof Error ? e.message : m.account_setup_error_load_failed();
		} finally {
			editFeaturesLoading = false;
		}
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
					slug: editAccountSlug.trim()
				}
			});
			if (err) throw new Error(err.detail || m.accounts_update_slug_failed());
			const offered = editFeatures.filter((f) => f.availability !== 'unsupported');
			if (offered.length > 0) {
				const choices = offered.map((f) => ({
					account_id: editingAccount!.id,
					feature: f.feature,
					enabled: Boolean(editFeatureSelections[f.feature]),
					source: 'user_save'
				}));
				const { error: featErr } = await client.POST('/account-features', {
					body: { workspace_id: selectedWorkspaceId, choices }
				});
				if (featErr) throw new Error(featErr.detail ?? m.account_setup_error_load_failed());
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

	$effect(() => {
		if (!loading) void loadProviders();
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
				params: {
					path: { platform: 'x' },
					query: {
						workspace_id: selectedWorkspaceId,
					}
				}
			});
			if (err) throw new Error(err.detail || m.accounts_x_connection_start_failed());
			if (!data?.url) throw new Error(m.accounts_x_connection_start_failed());
			clearConnectionFailure();
			onContinue({
				kind: 'external-oauth',
				url: data.url,
				workspaceID: selectedWorkspaceId
			});
		} catch (e) {
			const provider = providerEntries.find((entry) => entry.platform === 'x') ?? null;
			showConnectError(
				e instanceof Error ? e : new Error(m.accounts_connect_failed()),
				undefined,
				provider
			);
		}
	}

	type MastodonConnectionOptions = {
		serverName?: string;
		instanceURL?: string;
	};

	async function connectMastodon(options: MastodonConnectionOptions) {
		if (!selectedWorkspaceId) {
			throw new Error(m.accounts_create_workspace_first());
		}

		const { data, error: err } = await client.GET('/accounts/{platform}/auth-url', {
			params: {
				path: { platform: 'mastodon' },
				query: {
					workspace_id: selectedWorkspaceId,
					server_name: options.serverName,
					instance_url: options.instanceURL,
				}
			}
		});
		if (err) throw new Error(err.detail || m.accounts_connect_failed());
		if (!data?.url) throw new Error(m.accounts_connect_failed());
		onContinue({
			kind: 'external-oauth',
			url: data.url,
			workspaceID: selectedWorkspaceId,
			mastodon: options
		});
	}

	async function connectCustomMastodon() {
		const options = mastodonConnectionOptions();
		if (!options) return;
		customMastodonLoading = true;
		mastodonError = '';
		try {
			await connectMastodon(options);
		} catch (e) {
			mastodonError = connectErrorMessage(
				e instanceof Error ? e : new Error(m.accounts_connect_failed()),
				m.accounts_connect_failed()
			);
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
			const { data, error: err } = await client.POST('/accounts/bluesky/login', {
				body: {
					workspace_id: selectedWorkspaceId,
					handle: blueskyHandle.trim(),
					app_password: blueskyAppPassword.trim(),
				}
			});
			if (err) throw new Error(err.detail || m.accounts_login_failed());
			blueskyModalOpen = false;
			if (data?.feature_setup_required && data.new_account_ids?.length) {
				if (browser) {
					try {
					} catch {
						// Storage may be unavailable in hardened browser contexts; navigation still succeeds.
					}
				}
				await goto(
					resolveAppPath(
						accountSetupHref({
							workspaceID: data.workspace_id,
							accountIDs: data.account_ids ?? [],
							newAccountIDs: data.new_account_ids ?? [],
							openFreshComposer: data.open_fresh_composer
						})
					)
				);
				return;
			}
			await loadAccounts();
			onAccountsChanged();
		} catch (e) {
			blueskyError = e instanceof Error && e.message ? e.message : m.accounts_login_failed();
			showConnectError(
				e instanceof Error ? e : new Error(m.accounts_login_failed()),
				m.accounts_login_failed()
			);
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
			const { data, error: err } = await client.POST('/accounts/discord/webhook', {
				body: {
					workspace_id: selectedWorkspaceId,
					webhook_url: discordWebhookUrl.trim(),
				}
			});
			if (err) throw new Error(err.detail || m.accounts_connect_failed());
			discordModalOpen = false;
			if (data?.feature_setup_required && data.new_account_ids?.length) {
				if (browser) {
					try {
					} catch {
						// Storage may be unavailable in hardened browser contexts; navigation still succeeds.
					}
				}
				await goto(
					resolveAppPath(
						accountSetupHref({
							workspaceID: data.workspace_id,
							accountIDs: data.account_ids ?? [],
							newAccountIDs: data.new_account_ids ?? [],
							openFreshComposer: data.open_fresh_composer
						})
					)
				);
				return;
			}
			await loadAccounts();
			onAccountsChanged();
		} catch (requestError) {
			discordError = connectErrorMessage(
				requestError instanceof Error
					? requestError
					: new Error(m.accounts_discord_verify_failed()),
				m.accounts_discord_verify_failed()
			);
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
			const { data, error: err } = await client.GET('/accounts/{platform}/auth-url', {
				params: {
					path: { platform },
					query: {
						workspace_id: selectedWorkspaceId,
					}
				}
			});
			if (err) throw new Error(err.detail || m.accounts_connect_failed());
			if (!data?.url) throw new Error(m.accounts_connect_failed());
			clearConnectionFailure();
			onContinue({
				kind: 'external-oauth',
				url: data.url,
				workspaceID: selectedWorkspaceId
			});
		} catch (e) {
			const provider = providerEntries.find((entry) => entry.platform === platform) ?? null;
			showConnectError(
				e instanceof Error ? e : new Error(m.accounts_connect_failed()),
				undefined,
				provider
			);
		}
	}

	const connectLinkedIn = () => connectOAuthProvider('linkedin');
	const connectThreads = () => connectOAuthProvider('threads');
	const connectTikTok = () => connectOAuthProvider('tiktok');
	const connectFacebook = () => connectOAuthProvider('facebook');
	const connectInstagram = () => connectOAuthProvider('instagram');
	const connectYouTube = () => connectOAuthProvider('youtube');

	function providerKey(provider: ProviderEntry): string {
		return provider.installation_id || provider.platform;
	}

	function providerTestID(provider: ProviderEntry): string {
		return provider.installation_id || provider.platform;
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
		if (isConnectorProvider(provider) && providerCanConnect(provider)) {
			return m.accounts_custom_connector();
		}
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
		if (isConnectorProvider(provider)) {
			return 'border-border bg-muted text-muted-foreground';
		}
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

	function providerNeedsAdminSetup(provider: ProviderEntry): boolean {
		if (provider.status === 'planned') return true;
		const action = providerReadiness(provider).action;
		return action === 'configure' || action === 'contact_admin';
	}

	function providerActionEnabled(provider: ProviderEntry): boolean {
		return (
			connectingInstallationID !== provider.installation_id &&
			(providerCanConnect(provider) || providerReadiness(provider).action === 'retry')
		);
	}

	function providerActionLabel(provider: ProviderEntry): string {
		if (connectingInstallationID && connectingInstallationID === provider.installation_id) {
			return m.accounts_connector_connecting();
		}
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
		if (providerReadiness(provider).action === 'retry') {
			clearConnectionFailure();
			void loadProviders();
		}
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

		const instanceHost = mastodonHost(instance);
		const configuredProvider = mastodonProviders.find(
			(provider) =>
				(provider.instance_url && mastodonHost(provider.instance_url) === instanceHost) ||
				provider.name?.toLowerCase() === instance.toLowerCase()
		);
		if (configuredProvider) {
			return {
				serverName: configuredProvider.name || configuredProvider.instance_url
			};
		}

		if (mastodonProviders.some(isCustomMastodonProvider)) {
			return { instanceURL: instance };
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

	async function canOpenMastodonCode(options: MastodonConnectionOptions): Promise<boolean> {
		if (!selectedWorkspaceId) {
			mastodonError = m.accounts_create_workspace_first();
			return false;
		}

		const query = {
			workspace_id: selectedWorkspaceId,
			server_name: options.serverName,
			instance_url: options.instanceURL,
		};

		try {
			const { error: err } = await client.GET('/accounts/{platform}/auth-url', {
				params: { path: { platform: 'mastodon' }, query }
			});
			if (err) {
				throw new Error(err.detail || m.accounts_mastodon_connection_start_failed());
			}
			return true;
		} catch (e) {
			mastodonError = connectErrorMessage(
				e instanceof Error ? e : new Error(m.accounts_connect_failed()),
				m.accounts_connect_failed()
			);
			return false;
		}
	}

	async function openMastodonCode() {
		const options = mastodonConnectionOptions();
		if (!options || !(await canOpenMastodonCode(options))) return;
		onContinue({
			kind: 'mastodon-code',
			href: links.mastodonCallbackHref,
			workspaceID: selectedWorkspaceId,
			mastodon: options
		});
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
		clearConnectionFailure();
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
		if (isConnectorProvider(provider)) {
			void connectConnector(provider);
			return;
		}
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

	async function connectConnector(provider: ProviderEntry) {
		if (!selectedWorkspaceId || !provider.installation_id) {
			showToast(m.accounts_connect_failed());
			return;
		}
		connectingInstallationID = provider.installation_id;
		try {
			const { data, error: requestError } = await client.POST(
				'/accounts/connectors/{installation_id}/connections',
				{
					params: { path: { installation_id: provider.installation_id } },
					body: { workspace_id: selectedWorkspaceId }
				}
			);
			if (requestError) throw new Error(requestError.detail || m.accounts_connect_failed());
			clearConnectionFailure();
			await loadAccounts();
			onAccountsChanged();
			showToast(
				m.accounts_connector_connected({
					count: data?.account_ids?.length ?? 0
				}),
				undefined,
				'neutral'
			);
		} catch (requestError) {
			showConnectError(
				requestError instanceof Error ? requestError : new Error(m.accounts_connect_failed()),
				m.accounts_connect_failed(),
				provider
			);
		} finally {
			connectingInstallationID = '';
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

{#if feedback}
	<div class={embedded ? 'mb-6' : 'mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8'}>
		<InlineNotice
			tone={feedback.tone}
			message={feedback.message}
			dismissLabel={m.common_dismiss()}
			onDismiss={onFeedbackDismiss}
		/>
	</div>
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
			<SettingsNavigation active="accounts" showInstance={showInstanceSettings} />
		{/if}
		<div class:min-w-0={!embedded} class="min-w-0">
			{#if !workspaces || workspaces.length === 0}
				<EmptyState
					icon={UsersIcon}
					title={m.accounts_no_workspaces_title()}
					description={m.accounts_no_workspaces_body()}
					actionLabel={m.accounts_create_workspace()}
					actionHref={links.createWorkspaceHref}
					variant="muted"
				/>
			{:else}
				{#if selectedWorkspaceId && canEditWorkspace}
					<WorkspaceSetupGuide
						workspaceID={selectedWorkspaceId}
						context="accounts"
						wrapperClass="mb-6"
					/>
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

				{#if showFeatureReminder}
					<div
						data-testid="account-setup-reminder"
						class="mb-6 rounded-lg border bg-amber-500/5 p-3 sm:p-4"
					>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="space-y-1">
								<p class="text-sm font-medium">
									{m.account_features_reminder_title()}
								</p>
								<p class="text-xs leading-5 text-muted-foreground">
									{#if undecidedAccountIds.length === 1}
										{m.account_features_reminder_body({
											account: reminderAccountName()
										})}
									{:else}
										{m.account_features_reminder_body_plural({
											count: undecidedAccountIds.length
										})}
									{/if}
								</p>
							</div>
							<div class="flex gap-2">
								<Button
									href={resolveAppPath(reminderSetupHref())}
									size="sm"
									class="min-h-11 sm:min-h-9"
								>
									{m.account_features_reminder_action()}
								</Button>
							</div>
						</div>
					</div>
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
							{#if canEditWorkspace}
								<Button href={links.createPublicationHref} size="sm"
									>{m.accounts_create_post()}</Button
								>
							{/if}
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
					{/if}
					{#if accountsLoading && accounts.length === 0}
						<PageLoading layout="grid" label={m.common_loading()} items={3} />
					{:else if !accountsLoadError && (!accounts || accounts.length === 0)}
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
											<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
												<h3 class="line-clamp-2 min-w-0 text-sm font-semibold break-words">
													{accountPlatformName(account)}
												</h3>
												{#if isConnectorAccount(account)}
													<Badge
														class="shrink-0 rounded-full border-border bg-muted text-[11px] whitespace-nowrap text-muted-foreground shadow-none"
													>
														{m.accounts_custom_connector()}
													</Badge>
												{/if}
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
										{#if canEditWorkspace}<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													{#snippet child({ props })}
														<Button
															{...props}
															variant="ghost"
															size="icon-sm"
															class="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
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
											</DropdownMenu.Root>{/if}
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

				{#if canEditWorkspace}
					<!-- Connect a Platform -->
					<div>
						<SectionHeader
							title={m.accounts_add_channel()}
							description={m.accounts_add_channel_body()}
							class="mb-4"
						/>

						{#if providersLoadError}
							<div data-testid="providers-load-error" class="mb-4">
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
						{/if}
						{#if lastFailedMessage}
							<div data-testid="provider-connection-error" class="mb-4">
								<InlineNotice tone="error" message={lastFailedMessage}>
									{#snippet actions()}
										<div class="flex gap-2">
											{#if lastFailedProvider && providerCanConnect(lastFailedProvider)}
												<Button size="sm" onclick={() => handleProviderAction(lastFailedProvider!)}>
													{m.common_retry()}
												</Button>
											{:else}
												<Button
													variant="outline"
													size="sm"
													onclick={() => void loadProviders()}
													disabled={providersLoading}
												>
													{m.common_retry()}
												</Button>
											{/if}
											<Button variant="ghost" size="sm" onclick={clearConnectionFailure}>
												{m.common_dismiss()}
											</Button>
										</div>
									{/snippet}
								</InlineNotice>
							</div>
						{/if}
						{#if providersLoading && providerEntries.length === 0}
							<PageLoading layout="grid" label={m.common_loading()} items={4} />
						{:else if providerEntries.length > 0}
							{#if directProviders.length > 0}
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
									{#each directProviders as provider (providerKey(provider))}
										<div
											data-testid={`provider-card-${providerTestID(provider)}`}
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
														<h3 class="text-sm font-medium">
															{providerTitle(provider)}
														</h3>
														{#if isConnectorProvider(provider) || provider.status === 'planned' || !providerReadiness(provider).quiet}
															<Badge
																class="rounded-full px-2 py-0.5 text-[11px] shadow-none {providerStatusClass(
																	provider
																)}"
															>
																{providerStatusLabel(provider)}
															</Badge>
														{/if}
													</div>
													<p class="truncate text-sm text-muted-foreground">
														{providerDescription(provider)}
													</p>
													{#if provider.status !== 'planned' && !providerReadiness(provider).quiet}
														<p
															data-testid={`provider-readiness-${providerTestID(provider)}`}
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
												{#if connectingInstallationID === provider.installation_id}
													<LoaderIcon
														class="size-4 animate-spin motion-reduce:animate-none"
														aria-hidden="true"
													/>
												{/if}
												{providerActionLabel(provider)}
											</Button>
										</div>
									{/each}
								</div>
							{/if}
							{#if setupRequiredProviders.length > 0}
								<details
									class="mt-4 rounded-lg border bg-muted/10"
									ontoggle={(e) =>
										(setupRequiredOpen = (e.currentTarget as HTMLDetailsElement).open)}
								>
									<summary
										class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
									>
										<span
											>{m.accounts_provider_admin_required()} · {setupRequiredProviders.length}</span
										>
										<span class="text-xs text-muted-foreground"
											>{setupRequiredOpen
												? m.accounts_provider_admin_hide()
												: m.accounts_provider_admin_show()}</span
										>
									</summary>
									<div class="border-t px-3 py-3">
										<p class="mb-3 text-xs text-muted-foreground">
											{m.accounts_provider_admin_enable()}
										</p>
										<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
											{#each setupRequiredProviders as provider (providerKey(provider))}
												<div
													data-testid={`provider-card-${providerTestID(provider)}`}
													class="flex h-full min-h-28 flex-col rounded-lg border bg-card p-4 opacity-75"
												>
													<div class="flex items-start gap-3">
														<div
															class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {getPlatformColor(
																provider.platform
															)}"
														>
															<PlatformIcon
																platform={provider.platform}
																class="h-4 w-4 text-white"
															/>
														</div>
														<div class="min-w-0 flex-1">
															<div class="flex flex-wrap items-center gap-2">
																<h3 class="text-sm font-medium">
																	{providerTitle(provider)}
																</h3>
																<span
																	class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium {providerStatusClass(
																		provider
																	)}"
																>
																	{providerStatusLabel(provider)}
																</span>
															</div>
															<p class="truncate text-sm text-muted-foreground">
																{providerDescription(provider)}
															</p>
															<p
																data-testid={`provider-readiness-${providerTestID(provider)}`}
																class="mt-1 text-xs leading-5 text-muted-foreground"
															>
																{providerReadinessMessage(provider)}
															</p>
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
									</div>
								</details>
							{/if}
						{/if}
					</div>
				{/if}
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
				<p class="text-sm text-muted-foreground">
					{m.accounts_discord_url_help()}
				</p>
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

<Sheet.Root open={editAccountDialogOpen} onOpenChange={handleEditAccountDialogOpen}>
	<Sheet.Content
		side="right"
		class="w-full! gap-0 overflow-hidden p-0 sm:max-w-lg!"
		data-testid="account-settings-drawer"
	>
		<Sheet.Header class="shrink-0 border-b px-4 py-4 pr-16 text-left sm:px-5">
			<Sheet.Title>{m.accounts_details()}</Sheet.Title>
			<Sheet.Description>
				{m.accounts_details_description()}
			</Sheet.Description>
		</Sheet.Header>
		{#if editingAccount}
			<form
				class="flex min-h-0 flex-1 flex-col"
				onsubmit={(e) => {
					e.preventDefault();
					updateAccountSlug();
				}}
			>
				<div
					class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5"
					data-testid="account-settings-scroll"
				>
					<div class="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
						<div
							class="flex size-10 shrink-0 items-center justify-center rounded-lg {getPlatformColor(
								editingAccount.platform
							)}"
						>
							<PlatformIcon platform={editingAccount.platform} class="size-5 text-white" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-semibold">
								{accountDisplayName(editingAccount)}
							</div>
							<div class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
								<span>{getPlatformName(editingAccount.platform)}</span>
								{#if editingAccount.account_kind}
									<span aria-hidden="true">·</span>
									<span class="capitalize">
										{editingAccount.account_kind.replaceAll('_', ' ')}
									</span>
								{/if}
							</div>
							{#if accountServer(editingAccount)}
								<div class="truncate text-xs text-muted-foreground">
									{m.accounts_server()}: {accountServer(editingAccount)}
								</div>
							{/if}
						</div>
					</div>
					{#if editFeaturesLoading}
						<div class="rounded-lg border p-3 text-sm text-muted-foreground">
							{m.common_loading()}
						</div>
					{:else if editFeaturesError}
						<InlineNotice
							tone="error"
							message={editFeaturesError}
							dismissLabel={m.common_dismiss()}
							onDismiss={() => (editFeaturesError = '')}
						/>
					{:else if editFeatures.filter((f) => f.availability !== 'unsupported').length > 0}
						<section class="space-y-3" aria-labelledby="account-feature-settings-heading">
							<div class="space-y-1">
								<h3 id="account-feature-settings-heading" class="text-sm font-semibold">
									{m.account_features_details_heading()}
								</h3>
								<p class="text-xs leading-5 text-muted-foreground">
									{m.account_features_details_description()}
								</p>
							</div>
							<AccountFeaturePresentation
								accountId={editingAccount.id}
								features={editFeatures}
								selections={editFeatureSelections}
								mode="details"
								busy={editAccountLoading}
								onToggle={(feature, checked) => {
									editFeatureSelections = {
										...editFeatureSelections,
										[feature]: checked
									};
								}}
							/>
							<p class="text-xs leading-5 text-muted-foreground">
								{m.account_setup_provider_auth_note()}
							</p>
						</section>
					{/if}

					<details class="group rounded-lg border bg-muted/10">
						<summary
							class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							{m.accounts_developer_shortcut()}
							<span
								class="text-muted-foreground transition-transform group-open:rotate-180"
								aria-hidden="true">⌄</span
							>
						</summary>
						<div class="space-y-3 border-t px-3 py-3">
							<p class="text-xs leading-5 text-muted-foreground">
								{m.accounts_shortcut_example()}
								<code class="rounded bg-muted px-1 py-0.5 break-all"
									>openpost post create --accounts {editAccountSlug || 'main-x'}</code
								>.
							</p>
							<div class="space-y-2">
								<Label for="account-slug">{m.accounts_shortcut()}</Label>
								<Input
									id="account-slug"
									class="min-h-11 sm:min-h-9"
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
					</details>
					{#if editAccountError}
						<InlineNotice
							tone="error"
							message={editAccountError}
							dismissLabel={m.common_dismiss()}
							onDismiss={() => (editAccountError = '')}
						/>
					{/if}
				</div>
				<Sheet.Footer
					class="shrink-0 border-t bg-background px-4 py-3 sm:flex-row sm:justify-end sm:px-5"
					data-testid="account-settings-footer"
				>
					<Sheet.Close>
						{#snippet child({ props })}
							<Button {...props} class="min-h-11 sm:min-h-9" variant="outline" type="button">
								{m.common_cancel()}
							</Button>
						{/snippet}
					</Sheet.Close>
					<Button
						class="min-h-11 sm:min-h-9"
						type="submit"
						disabled={editAccountLoading || !editAccountSlug.trim()}
					>
						{editAccountLoading ? m.common_saving() : m.accounts_save_details()}
					</Button>
				</Sheet.Footer>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>
