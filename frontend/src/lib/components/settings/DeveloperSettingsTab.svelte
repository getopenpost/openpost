<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { client } from '$lib/api/client';
	import { getLocaleTag } from '$lib/i18n';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { showToast } from '$lib/toast';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import {
		apiTokenCustomExpiryMax,
		apiTokenCustomExpiryMin,
		apiTokenExpiresAt,
		apiTokenScopeOptions as apiTokenScopes,
		isAPITokenScope,
		type APITokenScope,
		type APITokenSummary,
		type APITokenExpiryPreset,
		type MCPActivityItem
	} from '../../../routes/settings/settings-data';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	const authState = $derived($auth);
	const unsavedChanges = getOptionalUnsavedChanges();
	let apiTokens = $state<APITokenSummary[]>([]);
	let apiTokensLoading = $state(true);
	let apiTokensLoadError = $state('');
	let apiTokenError = $state('');
	let mcpActivity = $state.raw<MCPActivityItem[]>([]);
	let mcpActivityLoading = $state(true);
	let mcpActivityError = $state('');
	let apiTokenBusy = $state(false);
	let apiTokenName = $state('OpenPost MCP');
	let apiTokenScope = $state<APITokenScope>('mcp:read');
	let apiTokenWorkspaceScope = $state('current');
	let apiTokenExpiryPreset = $state<APITokenExpiryPreset>('90');
	let apiTokenCustomExpiry = $state('');
	let savedAPITokenDraft = $state(
		JSON.stringify({
			name: 'OpenPost MCP',
			scope: 'mcp:read',
			workspace: 'current',
			expiry: '90',
			customExpiry: ''
		})
	);
	let createdAPIToken = $state('');
	let apiTokenCopyState = $state<'idle' | 'copied' | 'failed'>('idle');
	let loadedAPITokensUserID = '';
	let apiTokensRequestUserID = '';
	let loadedMCPActivityUserID = '';
	let apiTokensRequestSequence = 0;
	let revokeDialogOpen = $state(false);
	let pendingTokenID = $state('');

	function notify(message: string, tone: 'success' | 'error' = 'success') {
		showToast(message, tone);
	}

	function requestTokenRevocation(tokenID: string) {
		pendingTokenID = tokenID;
		revokeDialogOpen = true;
	}

	async function confirmTokenRevocation(): Promise<DestructiveActionOutcome> {
		if (!pendingTokenID) return { ok: false };
		const ok = await revokeAPIToken(pendingTokenID);
		const message = ok ? undefined : apiTokenError;
		if (!ok) apiTokenError = '';
		return { ok, message };
	}

	function apiTokenScopeLabel(value: string) {
		if (value === 'api:read') return m.settings_token_scope_api_read();
		if (value === 'api:write') return m.settings_token_scope_api_write();
		if (value === 'mcp:read') return m.settings_token_scope_mcp_read();
		if (value === 'mcp:full') return m.settings_token_scope_mcp();
		if (value === 'cli:full') return m.settings_token_scope_cli();
		return value;
	}

	function apiTokenScopeDescription(value: string) {
		if (value === 'api:read') return m.settings_token_scope_api_read_description();
		if (value === 'api:write') return m.settings_token_scope_api_write_description();
		if (value === 'mcp:read') return m.settings_token_scope_mcp_read_description();
		if (value === 'mcp:full') return m.settings_token_scope_mcp_description();
		if (value === 'cli:full') return m.settings_token_scope_cli_description();
		return '';
	}

	function apiTokenStatusLabel(status: APITokenSummary['status']) {
		if (status === 'expired') return m.settings_token_status_expired();
		if (status === 'revoked') return m.settings_token_status_revoked();
		return m.settings_token_status_active();
	}

	function apiTokenExpiryLabel() {
		if (apiTokenExpiryPreset === '30') return m.settings_token_expiry_30_days();
		if (apiTokenExpiryPreset === '365') return m.settings_token_expiry_one_year();
		if (apiTokenExpiryPreset === 'custom') return m.settings_token_expiry_custom();
		return m.settings_token_expiry_90_days();
	}

	function mcpStatusLabel(status: string) {
		if (status === 'success') return m.settings_mcp_status_success();
		if (status === 'error') return m.settings_mcp_status_error();
		if (status === 'failed') return m.settings_mcp_status_failed();
		if (status === 'pending') return m.settings_mcp_status_pending();
		return status;
	}

	async function loadAPITokens(userID = authState.user?.id ?? '') {
		if (!userID) return;
		const requestSequence = ++apiTokensRequestSequence;
		apiTokensRequestUserID = userID;
		apiTokensLoading = true;
		apiTokensLoadError = '';
		if (loadedAPITokensUserID && loadedAPITokensUserID !== userID) apiTokens = [];
		try {
			const { data, error: err } = await client.GET('/api-tokens');
			if (err || !data) throw new Error(err?.detail || m.settings_tokens_load_failed());
			if (requestSequence !== apiTokensRequestSequence || authState.user?.id !== userID) return;
			apiTokens = data as APITokenSummary[];
			loadedAPITokensUserID = userID;
		} catch (e) {
			if (requestSequence !== apiTokensRequestSequence || authState.user?.id !== userID) return;
			apiTokensLoadError = (e as Error).message;
		} finally {
			if (requestSequence === apiTokensRequestSequence) {
				apiTokensRequestUserID = '';
				apiTokensLoading = false;
			}
		}
	}

	async function loadMCPActivity() {
		mcpActivityLoading = true;
		mcpActivityError = '';
		try {
			const { data, error: err } = await client.GET('/mcp/activity', {
				params: { query: { limit: 8 } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			mcpActivity = data as MCPActivityItem[];
		} catch (e) {
			mcpActivityError = (e as Error).message;
		} finally {
			mcpActivityLoading = false;
		}
	}

	async function createAPIToken() {
		apiTokenBusy = true;
		apiTokenError = '';
		createdAPIToken = '';
		apiTokenCopyState = 'idle';
		const name = apiTokenName.trim();
		if (!name) {
			apiTokenError = m.settings_token_name_required();
			apiTokenBusy = false;
			return;
		}
		const workspaceID =
			apiTokenWorkspaceScope === 'current' ? (workspaceCtx.currentWorkspace?.id ?? '') : '';
		const expiresAt = apiTokenExpiresAt(apiTokenExpiryPreset, apiTokenCustomExpiry);
		if (!expiresAt) {
			apiTokenError = m.settings_token_expiry_description();
			apiTokenBusy = false;
			return;
		}
		try {
			const { data, error: err } = await client.POST('/api-tokens', {
				body: {
					name,
					scope: apiTokenScope,
					workspace_id: workspaceID,
					expires_at: expiresAt
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			createdAPIToken = data.token;
			apiTokenName = '';
			savedAPITokenDraft = apiTokenDraftSnapshot();
			await loadAPITokens();
		} catch (e) {
			apiTokenError = (e as Error).message;
		} finally {
			apiTokenBusy = false;
		}
	}

	function apiTokenDraftSnapshot() {
		return JSON.stringify({
			name: apiTokenName,
			scope: apiTokenScope,
			workspace: apiTokenWorkspaceScope,
			expiry: apiTokenExpiryPreset,
			customExpiry: apiTokenCustomExpiry
		});
	}

	async function copyCreatedAPIToken() {
		try {
			await navigator.clipboard.writeText(createdAPIToken);
			apiTokenCopyState = 'copied';
			notify(m.settings_token_copy_success());
		} catch {
			apiTokenCopyState = 'failed';
			apiTokenError = m.settings_token_copy_failed();
		}
	}

	async function revokeAPIToken(tokenID: string) {
		apiTokenBusy = true;
		apiTokenError = '';
		try {
			const { error: err } = await client.DELETE('/api-tokens/{id}', {
				params: { path: { id: tokenID } }
			});
			if (err) throw new Error(err.detail || m.settings_action_failed());
			await loadAPITokens();
			notify(m.settings_token_revoked());
			return true;
		} catch (e) {
			apiTokenError = (e as Error).message;
			return false;
		} finally {
			apiTokenBusy = false;
		}
	}

	function formatDateTime(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	const apiTokenScopeOptions = $derived(
		apiTokenScopes.map((value) => ({
			value,
			label: apiTokenScopeLabel(value),
			description: apiTokenScopeDescription(value)
		}))
	);
	const selectedAPITokenScope = $derived(
		apiTokenScopeOptions.find((option) => option.value === apiTokenScope) ?? apiTokenScopeOptions[0]
	);
	const apiTokenWorkspaceOptions = $derived([
		{
			value: 'current',
			label: m.settings_current_workspace(),
			description: workspaceCtx.currentWorkspace?.name ?? m.settings_current_workspace_body()
		},
		{
			value: 'all',
			label: m.settings_all_workspaces(),
			description: m.settings_all_workspaces_body()
		}
	]);
	const selectedAPITokenWorkspaceScope = $derived(
		apiTokenWorkspaceOptions.find((option) => option.value === apiTokenWorkspaceScope) ??
			apiTokenWorkspaceOptions[0]
	);
	const developerDraftDirty = $derived(apiTokenDraftSnapshot() !== savedAPITokenDraft);

	$effect(() => {
		const userID = authState.user?.id ?? '';
		if (!authState.isAuthenticated || !userID) return;
		if (loadedAPITokensUserID !== userID && apiTokensRequestUserID !== userID) {
			void loadAPITokens(userID);
		}
		if (loadedMCPActivityUserID !== userID) {
			loadedMCPActivityUserID = userID;
			void loadMCPActivity();
		}
	});

	$effect(() => {
		unsavedChanges?.set('developer-settings', developerDraftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('developer-settings');
	});
</script>

<SectionHeader
	title={m.settings_tokens_heading()}
	description={m.settings_tokens_body()}
	icon={TerminalIcon}
	class="mb-4"
/>

{#if apiTokenScope === 'api:read'}
	<InlineNotice tone="info" message={m.settings_token_scope_api_read_boundary()} class="mb-4" />
{:else if apiTokenScope === 'api:write'}
	<InlineNotice tone="warning" message={m.settings_token_scope_api_write_boundary()} class="mb-4" />
{:else if apiTokenScope === 'mcp:read'}
	<InlineNotice tone="info" message={m.settings_token_scope_mcp_read_boundary()} class="mb-4" />
{:else if apiTokenScope === 'mcp:full'}
	<InlineNotice tone="warning" message={m.settings_token_scope_mcp_full_boundary()} class="mb-4" />
{/if}

{#if apiTokensLoadError}
	<div data-testid="api-tokens-load-error" class="mb-4">
		<InlineNotice tone="error" message={apiTokensLoadError}>
			{#snippet actions()}
				<Button
					variant="outline"
					size="sm"
					onclick={() => void loadAPITokens()}
					disabled={apiTokensLoading}
				>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{/if}
{#if apiTokenError}
	<InlineNotice tone="error" message={apiTokenError} class="mb-4" />
{/if}

<div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px_190px_auto]">
	<div class="space-y-2">
		<Label for="api-token-name">{m.settings_token_name()}</Label>
		<Input
			id="api-token-name"
			bind:value={apiTokenName}
			placeholder={m.settings_token_name_placeholder()}
			maxlength={120}
		/>
	</div>
	<div class="space-y-2">
		<Label for="api-token-scope">{m.settings_token_scope()}</Label>
		<Select.Root
			type="single"
			value={apiTokenScope}
			onValueChange={(value) => {
				if (value && isAPITokenScope(value)) apiTokenScope = value;
			}}
		>
			<Select.Trigger id="api-token-scope" data-testid="api-token-scope" class="w-full">
				{selectedAPITokenScope.label}
			</Select.Trigger>
			<Select.Content>
				{#each apiTokenScopeOptions as option (option.value)}
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
	<div class="space-y-2">
		<Label for="api-token-workspace">{m.settings_access_boundary()}</Label>
		<Select.Root
			type="single"
			value={apiTokenWorkspaceScope}
			onValueChange={(value) => value && (apiTokenWorkspaceScope = value)}
		>
			<Select.Trigger id="api-token-workspace" class="w-full">
				{selectedAPITokenWorkspaceScope.label}
			</Select.Trigger>
			<Select.Content>
				{#each apiTokenWorkspaceOptions as option (option.value)}
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
	<div class="space-y-2">
		<Label for="api-token-expiry">{m.settings_token_expiry()}</Label>
		<Select.Root
			type="single"
			value={apiTokenExpiryPreset}
			onValueChange={(value) => value && (apiTokenExpiryPreset = value as APITokenExpiryPreset)}
		>
			<Select.Trigger id="api-token-expiry" class="w-full">
				{apiTokenExpiryLabel()}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="30">{m.settings_token_expiry_30_days()}</Select.Item>
				<Select.Item value="90">{m.settings_token_expiry_90_days()}</Select.Item>
				<Select.Item value="365">{m.settings_token_expiry_one_year()}</Select.Item>
				<Select.Item value="custom">{m.settings_token_expiry_custom()}</Select.Item>
			</Select.Content>
		</Select.Root>
	</div>
	<div class="flex items-end">
		<Button
			onclick={createAPIToken}
			disabled={apiTokenBusy ||
				!apiTokenName.trim() ||
				(apiTokenExpiryPreset === 'custom' && !apiTokenCustomExpiry) ||
				(apiTokenWorkspaceScope === 'current' && !workspaceCtx.currentWorkspace)}
		>
			{#if apiTokenBusy}
				<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
			{/if}
			{m.settings_create_token()}
		</Button>
	</div>
</div>
{#if apiTokenExpiryPreset === 'custom'}
	<div class="mb-4 max-w-xs space-y-2">
		<Label for="api-token-custom-expiry">{m.settings_token_custom_expiry()}</Label>
		<Input
			id="api-token-custom-expiry"
			type="date"
			bind:value={apiTokenCustomExpiry}
			min={apiTokenCustomExpiryMin()}
			max={apiTokenCustomExpiryMax()}
		/>
		<p class="text-xs leading-5 text-muted-foreground">
			{m.settings_token_expiry_description()}
		</p>
	</div>
{/if}

{#if createdAPIToken}
	<div
		class="mb-4 rounded-lg border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-950"
		data-feedback-redact
	>
		<p class="font-medium">{m.settings_copy_token_now()}</p>
		<p class="mt-2 font-mono text-xs break-all" aria-label={m.settings_token_secret_label()}>
			{createdAPIToken}
		</p>
		<Button
			type="button"
			variant="outline"
			class="mt-3 gap-2 border-amber-700/30 bg-white/80 text-amber-950 hover:bg-white"
			onclick={() => void copyCreatedAPIToken()}
		>
			<CopyIcon class="size-4" />
			{m.common_copy()}
		</Button>
		<p class="sr-only" aria-live="polite">
			{apiTokenCopyState === 'copied'
				? m.settings_token_copy_success()
				: apiTokenCopyState === 'failed'
					? m.settings_token_copy_failed()
					: ''}
		</p>
	</div>
{/if}

{#if apiTokensLoading && apiTokens.length === 0}
	<PageLoading layout="list" label={m.common_loading()} items={2} />
{:else if apiTokens.length === 0 && !apiTokensLoadError}
	<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
		{m.settings_no_tokens()}
	</p>
{:else if apiTokens.length > 0}
	<div class="space-y-2">
		{#each apiTokens as token (token.id)}
			<div
				class="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<p class="text-sm font-medium">{token.name}</p>
						<span
							class={[
								'rounded-full border px-2 py-0.5 text-xs font-medium',
								token.status === 'active'
									? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
									: 'border-muted-foreground/30 bg-muted text-muted-foreground'
							]}
						>
							{apiTokenStatusLabel(token.status)}
						</span>
					</div>
					<p class="text-xs text-muted-foreground">
						{m.settings_token_prefix()}
						<span class="font-mono">{token.token_prefix}</span> ·
						{apiTokenScopeLabel(token.scope)} ·
						{m.settings_token_created({ date: formatDateTime(token.created_at) })}
						{#if token.workspace_id}
							· {m.settings_token_workspace()}
							<span class="font-mono">{token.workspace_id}</span>
						{:else}
							· {m.settings_all_workspaces()}
						{/if}
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_expires()}
						{token.expires_at ? formatDateTime(token.expires_at) : m.settings_never()}
						· {token.last_used_at
							? m.settings_token_last_used({ date: formatDateTime(token.last_used_at) })
							: m.settings_token_never_used()}
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					class="text-destructive hover:text-destructive"
					onclick={() => requestTokenRevocation(token.id)}
					disabled={apiTokenBusy || token.status === 'revoked'}
				>
					{m.settings_revoke()}
				</Button>
			</div>
		{/each}
	</div>
{/if}

<a
	href="https://docs.openpost.social/development/api-tokens"
	target="_blank"
	rel="noreferrer"
	class="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
>
	{m.settings_token_docs()}
	<ExternalLinkIcon class="size-4" aria-hidden="true" />
</a>

<div class="mt-6 border-t pt-6">
	<div class="mb-4 flex items-center justify-between gap-3">
		<div>
			<h3 class="flex items-center gap-2 text-sm font-semibold">
				<ActivityIcon class="h-4 w-4 text-muted-foreground" />
				{m.settings_mcp_activity()}
			</h3>
			<p class="mt-1 text-sm text-muted-foreground">
				{m.settings_mcp_activity_body()}
			</p>
		</div>
		<Button variant="outline" size="sm" onclick={loadMCPActivity} disabled={mcpActivityLoading}>
			{#if mcpActivityLoading}
				<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
			{/if}
			{m.common_refresh()}
		</Button>
	</div>

	{#if mcpActivityError}
		<div data-testid="mcp-activity-error" class="mb-3">
			<InlineNotice tone="error" message={mcpActivityError} />
		</div>
	{/if}

	{#if mcpActivityLoading && mcpActivity.length === 0}
		<PageLoading layout="list" label={m.common_loading()} items={2} />
	{:else if mcpActivity.length === 0 && !mcpActivityError}
		<p
			data-testid="mcp-activity-empty"
			class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground"
		>
			{m.settings_no_mcp_activity()}
		</p>
	{:else}
		<div data-testid="mcp-activity-list" class="space-y-2">
			{#each mcpActivity as call (call.id)}
				<div class="rounded-md border px-3 py-3">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{call.tool_name}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{formatDateTime(call.created_at)} · {call.duration_ms} ms
								{#if call.workspace_id}
									· {m.settings_mcp_workspace()}
									<span class="font-mono">{call.workspace_id}</span>
								{/if}
							</p>
							{#if call.client_name || call.client_scope}
								<p class="mt-1 truncate text-xs text-muted-foreground">
									{m.settings_mcp_client()}
									{call.client_name || apiTokenScopeLabel(call.client_scope ?? '')}
									{#if call.client_token_prefix}
										· <span class="font-mono">{call.client_token_prefix}</span>
									{/if}
								</p>
							{/if}
						</div>
						<span
							class={[
								'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium',
								call.status === 'success'
									? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
									: 'border-destructive/30 bg-destructive/10 text-destructive'
							]}
						>
							{mcpStatusLabel(call.status)}
						</span>
					</div>
					{#if call.error_message}
						<p class="mt-2 text-xs text-destructive">{call.error_message}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<DestructiveConfirmDialog
	bind:open={revokeDialogOpen}
	title={m.settings_revoke_token_title()}
	description={m.settings_revoke_token_body()}
	confirmLabel={m.settings_revoke()}
	onConfirm={confirmTokenRevocation}
/>
