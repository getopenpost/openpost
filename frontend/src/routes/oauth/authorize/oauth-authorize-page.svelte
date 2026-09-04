<script lang="ts">
	import { goto } from '$app/navigation';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { page } from '$app/stores';
	import type { Readable } from 'svelte/store';
	import type { QueryClient } from '@tanstack/svelte-query';
	import {
		externalAuthorizationRequestQueryOptions,
		workspaceAccountsQueryOptions
	} from '@openpost/query-catalog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import { queryClient } from '$lib/query/client';
	import { createOpenPostQueryAPI } from '$lib/query/api';
	import { createExternalApplicationQueryAPI } from '$lib/query/external-applications';
	import type { components } from '$lib/api/types';
	import type { SocialAccount, Workspace } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';

	interface AuthorizationAuthState {
		user: { id: string } | null;
		isLoading: boolean;
		isAuthenticated: boolean;
	}

	interface OAuthAuthorizeDependencies {
		page: Readable<{ url: URL }>;
		auth: Readable<AuthorizationAuthState>;
		workspace: { currentWorkspace: Workspace | null; workspaces: Workspace[] };
		get: typeof client.GET;
		post: typeof client.POST;
		cache: Pick<QueryClient, 'fetchQuery'>;
		navigate: typeof goto;
	}

	const defaultDependencies: OAuthAuthorizeDependencies = {
		page,
		auth,
		workspace: workspaceCtx,
		get: client.GET,
		post: client.POST,
		cache: queryClient,
		navigate: goto
	};

	let { dependencies = defaultDependencies }: { dependencies?: OAuthAuthorizeDependencies } =
		$props();
	let pageStore = $derived(dependencies.page);
	let authStore = $derived(dependencies.auth);
	let externalQueryAPI = $derived(createExternalApplicationQueryAPI({ GET: dependencies.get }));
	let accountsQueryAPI = $derived(createOpenPostQueryAPI({ GET: dependencies.get }));

	let authState = $derived($authStore);
	let error = $state('');
	let submitting = $state(false);
	let pendingDecision = $state<boolean | null>(null);
	let oauthWorkspaceScope = $state('current');
	let externalApplicationName = $state('');
	let externalRequestLoading = $state(false);
	let selectedWorkspaceIDs = $state<string[]>([]);
	let accountsByWorkspace = $state<Record<string, SocialAccount[]>>({});
	let accountLoadingByWorkspace = $state<Record<string, boolean>>({});
	let accountErrorByWorkspace = $state<Record<string, string>>({});
	let selectedAccountIDs = $state<Record<string, string[]>>({});
	let allCurrentAccounts = $state<Record<string, boolean>>({});
	let initializedExternalSelection = false;
	const accountLoadPromises = new Map<string, Promise<void>>();

	let params = $derived({
		response_type: $pageStore.url.searchParams.get('response_type') ?? '',
		client_id: $pageStore.url.searchParams.get('client_id') ?? '',
		redirect_uri: $pageStore.url.searchParams.get('redirect_uri') ?? '',
		scope: $pageStore.url.searchParams.get('scope') ?? 'mcp:full',
		state: $pageStore.url.searchParams.get('state') ?? '',
		code_challenge: $pageStore.url.searchParams.get('code_challenge') ?? '',
		code_challenge_method: $pageStore.url.searchParams.get('code_challenge_method') ?? '',
		resource: $pageStore.url.searchParams.get('resource') ?? ''
	});

	let scopes = $derived(
		(params.scope || 'mcp:full')
			.split(/[,\s]+/)
			.map((scope) => scope.trim())
			.filter(Boolean)
	);
	let requestedReadOnlyAccess = $derived(
		scopes.includes('mcp:read') && !scopes.includes('mcp:full')
	);
	let isExternalApplication = $derived(scopes.some((scope) => !scope.startsWith('mcp:')));
	let eligibleWorkspaces = $derived(
		dependencies.workspace.workspaces.filter((workspace) => workspace.role === 'admin')
	);
	let externalAccountsReady = $derived(
		selectedWorkspaceIDs.every(
			(workspaceID) =>
				accountsByWorkspace[workspaceID] !== undefined &&
				accountLoadingByWorkspace[workspaceID] !== true &&
				!accountErrorByWorkspace[workspaceID]
		)
	);

	let clientLabel = $derived(externalApplicationName || clientDisplayName(params.client_id));
	let redirectHost = $derived(hostname(params.redirect_uri));
	let requestError = $derived(validateRequest());
	const oauthWorkspaceOptions = $derived([
		{
			value: 'current',
			label: m.oauth_authorize_current_workspace(),
			description:
				dependencies.workspace.currentWorkspace?.name ??
				m.oauth_authorize_current_workspace_description()
		},
		{
			value: 'all',
			label: m.oauth_authorize_all_workspaces(),
			description: m.oauth_authorize_all_workspaces_description()
		}
	]);
	const selectedOAuthWorkspaceScope = $derived(
		oauthWorkspaceOptions.find((option) => option.value === oauthWorkspaceScope) ??
			oauthWorkspaceOptions[0]
	);

	function currentPath() {
		return `${$pageStore.url.pathname}${$pageStore.url.search}`;
	}

	function loginRedirect() {
		return `/login?redirect=${encodeURIComponent(currentPath())}`;
	}

	function clientDisplayName(clientID: string) {
		if (!clientID) return m.oauth_authorize_default_client();
		const host = hostname(clientID);
		if (host) return host;
		return clientID;
	}

	function hostname(value: string) {
		try {
			return new URL(value).hostname;
		} catch {
			return '';
		}
	}

	function validateRequest() {
		if (params.response_type !== 'code') return m.oauth_authorize_missing_response_type();
		if (!params.client_id) return m.oauth_authorize_missing_client_id();
		if (!params.redirect_uri) return m.oauth_authorize_missing_redirect_uri();
		if (!params.code_challenge) return m.oauth_authorize_missing_pkce_challenge();
		if (params.code_challenge_method !== 'S256') return m.oauth_authorize_pkce_s256_required();
		return '';
	}

	async function submit(approved: boolean) {
		if (approved && requestError) {
			error = '';
			return;
		}
		if (!approved && (!params.redirect_uri || !params.client_id)) {
			error = '';
			return;
		}

		submitting = true;
		pendingDecision = approved;
		error = '';
		const workspaceID =
			approved && oauthWorkspaceScope === 'current'
				? (dependencies.workspace.currentWorkspace?.id ?? '')
				: '';

		try {
			if (isExternalApplication) {
				if (approved) {
					await Promise.all(selectedWorkspaceIDs.map(loadAccounts));
					if (!selectedWorkspaceIDs.every((workspaceID) => accountsByWorkspace[workspaceID])) {
						throw new Error(m.oauth_authorize_accounts_failed());
					}
				}
				const body: components['schemas']['AuthorizeExternalApplicationInputBody'] = {
					approved,
					client_id: params.client_id,
					redirect_uri: params.redirect_uri,
					scope: params.scope,
					state: params.state,
					code_challenge: params.code_challenge,
					workspace_grants: selectedWorkspaceIDs.map((workspaceID) => ({
						workspace_id: workspaceID,
						all_current_accounts: allCurrentAccounts[workspaceID] === true,
						account_ids:
							allCurrentAccounts[workspaceID] === true
								? []
								: (selectedAccountIDs[workspaceID] ?? [])
					}))
				};
				const { data, error: apiError } = await dependencies.post(
					'/external-applications/oauth/authorize',
					{ body }
				);
				if (apiError || !data?.redirect_url) {
					throw new Error(apiError?.detail ?? m.oauth_authorize_failed());
				}
				window.location.href = data.redirect_url;
				return;
			}
			const body: components['schemas']['CreateMCPOAuthAuthorizationInputBody'] = {
				...params,
				approved
			};
			if (workspaceID) body.workspace_id = workspaceID;
			const { data, error: apiError } = await dependencies.post('/mcp/oauth/authorize', {
				body
			});
			if (apiError || !data?.redirect_url) {
				throw new Error(apiError?.detail ?? m.oauth_authorize_failed());
			}
			window.location.href = data.redirect_url;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.oauth_authorize_failed();
		} finally {
			submitting = false;
			pendingDecision = null;
		}
	}

	function toggleWorkspace(workspaceID: string) {
		selectedWorkspaceIDs = selectedWorkspaceIDs.includes(workspaceID)
			? selectedWorkspaceIDs.filter((id) => id !== workspaceID)
			: [...selectedWorkspaceIDs, workspaceID];
	}

	function toggleAllWorkspaces() {
		selectedWorkspaceIDs =
			selectedWorkspaceIDs.length === eligibleWorkspaces.length
				? []
				: eligibleWorkspaces.map((workspace) => workspace.id);
	}

	function toggleAccount(workspaceID: string, accountID: string) {
		const selected = selectedAccountIDs[workspaceID] ?? [];
		selectedAccountIDs = {
			...selectedAccountIDs,
			[workspaceID]: selected.includes(accountID)
				? selected.filter((id) => id !== accountID)
				: [...selected, accountID]
		};
	}

	function setAllCurrentAccounts(workspaceID: string, checked: boolean) {
		allCurrentAccounts = { ...allCurrentAccounts, [workspaceID]: checked };
	}

	async function loadExternalApplication() {
		externalRequestLoading = true;
		try {
			const data = await dependencies.cache.fetchQuery(
				externalAuthorizationRequestQueryOptions(
					externalQueryAPI,
					params.client_id,
					params.redirect_uri
				)
			);
			externalApplicationName = data.application.name;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.oauth_authorize_failed();
		} finally {
			externalRequestLoading = false;
		}
	}

	function loadAccounts(workspaceID: string): Promise<void> {
		if (accountsByWorkspace[workspaceID] !== undefined) return Promise.resolve();
		const inFlight = accountLoadPromises.get(workspaceID);
		if (inFlight) return inFlight;
		accountLoadingByWorkspace = { ...accountLoadingByWorkspace, [workspaceID]: true };
		accountErrorByWorkspace = { ...accountErrorByWorkspace, [workspaceID]: '' };
		const request = (async () => {
			try {
				const accounts = (
					await dependencies.cache.fetchQuery(
						workspaceAccountsQueryOptions(accountsQueryAPI, workspaceID)
					)
				).filter((account) => account.is_active);
				accountsByWorkspace = { ...accountsByWorkspace, [workspaceID]: accounts };
				selectedAccountIDs = {
					...selectedAccountIDs,
					[workspaceID]: accounts.map((account) => account.id)
				};
			} catch (cause) {
				const message =
					cause instanceof Error ? cause.message : m.oauth_authorize_accounts_failed();
				accountErrorByWorkspace = { ...accountErrorByWorkspace, [workspaceID]: message };
				error = message;
			} finally {
				accountLoadingByWorkspace = { ...accountLoadingByWorkspace, [workspaceID]: false };
				accountLoadPromises.delete(workspaceID);
			}
		})();
		accountLoadPromises.set(workspaceID, request);
		return request;
	}

	$effect(() => {
		if (authState.isLoading) return;
		if (!authState.user && !authState.isAuthenticated) {
			dependencies.navigate(resolveAppPath(loginRedirect()));
			return;
		}
	});

	$effect(() => {
		if (!isExternalApplication || !authState.isAuthenticated || initializedExternalSelection)
			return;
		initializedExternalSelection = true;
		const currentID = dependencies.workspace.currentWorkspace?.id;
		const initialWorkspace = eligibleWorkspaces.find((workspace) => workspace.id === currentID);
		selectedWorkspaceIDs = initialWorkspace
			? [initialWorkspace.id]
			: eligibleWorkspaces.slice(0, 1).map((workspace) => workspace.id);
		void loadExternalApplication();
	});

	$effect(() => {
		if (!isExternalApplication) return;
		for (const workspaceID of selectedWorkspaceIDs) void loadAccounts(workspaceID);
	});
</script>

<svelte:head>
	<title>{isExternalApplication ? m.oauth_authorize_app_title() : m.oauth_authorize_title()}</title>
</svelte:head>

{#snippet botIcon()}
	<ThemeIcon role="assistant" class="size-6" />
{/snippet}

<StandaloneShell
	title={isExternalApplication ? m.oauth_authorize_app_heading() : m.oauth_authorize_heading()}
	description={isExternalApplication
		? m.oauth_authorize_app_description({ client: clientLabel })
		: m.oauth_authorize_description({ client: clientLabel })}
	icon={botIcon}
	maxWidth="lg"
>
	{#if error || requestError}
		<InlineNotice tone="error" message={error || requestError} class="mb-4" />
	{/if}

	<div class="space-y-5">
		<div class="rounded-md border bg-muted/30 p-4">
			<div class="text-base font-semibold">{clientLabel}</div>
			{#if redirectHost}
				<p class="mt-1 text-sm text-muted-foreground">
					{m.oauth_authorize_redirects_to({ host: redirectHost })}
				</p>
			{/if}
		</div>

		<div class="space-y-2">
			<p class="text-sm font-medium">{m.oauth_authorize_requested_access()}</p>
			<div class="flex flex-wrap gap-2">
				{#each scopes as scope (scope)}
					<Badge>{scope}</Badge>
				{:else}
					<Badge>mcp:full</Badge>
				{/each}
			</div>
		</div>

		<InlineNotice
			tone={requestedReadOnlyAccess ? 'info' : 'warning'}
			message={isExternalApplication
				? m.oauth_authorize_app_access_description()
				: requestedReadOnlyAccess
					? m.oauth_authorize_read_access_description()
					: m.oauth_authorize_full_access_description()}
		/>

		{#if isExternalApplication}
			<div class="space-y-3">
				<div class="flex items-center justify-between gap-3">
					<p class="text-sm font-medium">{m.oauth_authorize_access_boundary()}</p>
					<Label class="flex items-center gap-2 text-sm font-normal">
						<Checkbox
							checked={eligibleWorkspaces.length > 0 &&
								selectedWorkspaceIDs.length === eligibleWorkspaces.length}
							onCheckedChange={toggleAllWorkspaces}
						/>
						{m.oauth_authorize_all_eligible_workspaces()}
					</Label>
				</div>
				{#each eligibleWorkspaces as workspace (workspace.id)}
					<div class="rounded-md border p-3">
						<Label class="flex items-center gap-3 font-medium">
							<Checkbox
								checked={selectedWorkspaceIDs.includes(workspace.id)}
								onCheckedChange={() => toggleWorkspace(workspace.id)}
							/>
							{workspace.name}
						</Label>
						{#if selectedWorkspaceIDs.includes(workspace.id)}
							<div class="mt-3 space-y-2 border-t pt-3 pl-7">
								{#if accountLoadingByWorkspace[workspace.id]}
									<ProtectedIcon icon="loading" class="size-4 animate-spin" />
								{:else if accountErrorByWorkspace[workspace.id]}
									<InlineNotice tone="error" message={accountErrorByWorkspace[workspace.id]} />
								{/if}
								<Label class="flex items-center gap-2 text-sm font-normal">
									<Checkbox
										checked={allCurrentAccounts[workspace.id] === true}
										onCheckedChange={(checked) =>
											setAllCurrentAccounts(workspace.id, checked === true)}
									/>
									{m.oauth_authorize_all_current_accounts()}
								</Label>
								{#if !allCurrentAccounts[workspace.id]}
									{#each accountsByWorkspace[workspace.id] ?? [] as account (account.id)}
										<Label class="flex items-center gap-2 text-sm font-normal">
											<Checkbox
												checked={(selectedAccountIDs[workspace.id] ?? []).includes(account.id)}
												onCheckedChange={() => toggleAccount(workspace.id, account.id)}
											/>
											<span>{account.account_username || account.platform}</span>
											<span class="text-muted-foreground">{account.platform}</span>
										</Label>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<InlineNotice tone="warning" message={m.oauth_authorize_no_admin_workspaces()} />
				{/each}
			</div>
		{:else}
			<div class="space-y-2">
				<p class="text-sm font-medium">{m.oauth_authorize_access_boundary()}</p>
				<Select.Root
					type="single"
					value={oauthWorkspaceScope}
					onValueChange={(value) => value && (oauthWorkspaceScope = value)}
				>
					<Select.Trigger class="w-full">{selectedOAuthWorkspaceScope.label}</Select.Trigger>
					<Select.Content>
						{#each oauthWorkspaceOptions as option (option.value)}
							<Select.Item value={option.value}>
								<div class="flex flex-col gap-0.5 text-left">
									<span>{option.label}</span>
									<span class="text-xs text-muted-foreground">{option.description}</span>
								</div>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}

		<div class="flex flex-col gap-2 sm:flex-row">
			<Button
				class="w-full gap-2 sm:flex-1"
				onclick={() => submit(true)}
				disabled={submitting ||
					externalRequestLoading ||
					!!requestError ||
					(isExternalApplication && selectedWorkspaceIDs.length === 0) ||
					(isExternalApplication && !externalAccountsReady) ||
					(!isExternalApplication &&
						oauthWorkspaceScope === 'current' &&
						!dependencies.workspace.currentWorkspace)}
			>
				{#if pendingDecision === true}
					<ProtectedIcon icon="loading" class="size-4 animate-spin" />
				{:else}
					<ThemeIcon role="security" class="h-4 w-4" />
				{/if}
				{pendingDecision === true ? m.oauth_authorize_authorizing() : m.oauth_authorize_approve()}
			</Button>
			<Button
				variant="outline"
				class="w-full gap-2 sm:flex-1"
				onclick={() => submit(false)}
				disabled={submitting || !params.redirect_uri || !params.client_id}
			>
				{#if pendingDecision === false}
					<ProtectedIcon icon="loading" class="size-4 animate-spin" />
				{:else}
					<ThemeIcon role="close" class="h-4 w-4" />
				{/if}
				{pendingDecision === false ? m.oauth_authorize_denying() : m.oauth_authorize_deny()}
			</Button>
		</div>
	</div>
</StandaloneShell>
