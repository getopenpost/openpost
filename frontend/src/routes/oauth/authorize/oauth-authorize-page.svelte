<script lang="ts">
	import { goto } from '$app/navigation';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { page } from '$app/stores';
	import type { Readable } from 'svelte/store';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
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
		workspace: { currentWorkspace: { id: string; name: string } | null };
		post: typeof client.POST;
		navigate: typeof goto;
	}

	const defaultDependencies: OAuthAuthorizeDependencies = {
		page,
		auth,
		workspace: workspaceCtx,
		post: client.POST,
		navigate: goto
	};

	let { dependencies = defaultDependencies }: { dependencies?: OAuthAuthorizeDependencies } =
		$props();
	let pageStore = $derived(dependencies.page);
	let authStore = $derived(dependencies.auth);

	let authState = $derived($authStore);
	let error = $state('');
	let submitting = $state(false);
	let pendingDecision = $state<boolean | null>(null);
	let oauthWorkspaceScope = $state('current');

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

	let clientLabel = $derived(clientDisplayName(params.client_id));
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

	$effect(() => {
		if (authState.isLoading) return;
		if (!authState.user && !authState.isAuthenticated) {
			dependencies.navigate(resolveAppPath(loginRedirect()));
			return;
		}
	});
</script>

<svelte:head>
	<title>{m.oauth_authorize_title()}</title>
</svelte:head>

{#snippet botIcon()}
	<ThemeIcon role="assistant" class="size-6" />
{/snippet}

<StandaloneShell
	title={m.oauth_authorize_heading()}
	description={m.oauth_authorize_description({ client: clientLabel })}
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
			message={requestedReadOnlyAccess
				? m.oauth_authorize_read_access_description()
				: m.oauth_authorize_full_access_description()}
		/>

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

		<div class="flex flex-col gap-2 sm:flex-row">
			<Button
				class="w-full gap-2"
				onclick={() => submit(true)}
				disabled={submitting ||
					!!requestError ||
					(oauthWorkspaceScope === 'current' && !dependencies.workspace.currentWorkspace)}
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
				class="w-full gap-2"
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
