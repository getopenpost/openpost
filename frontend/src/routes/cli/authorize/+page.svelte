<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import XIcon from '@lucide/svelte/icons/x';

	type CLIAuthSession = {
		client_name: string;
		client_version?: string;
		client_os?: string;
		requested_scopes?: string;
		expires_at?: string;
	};

	let authState = $derived($auth);
	let userCode = $derived($page.url.searchParams.get('user_code') ?? '');
	let session = $state<CLIAuthSession | null>(null);
	let tokenName = $state('OpenPost CLI');
	let selectedWorkspaceID = $state<string | null>(null);
	let error = $state('');
	let sessionLoadFailed = $state(false);
	let loading = $state(false);
	let submitting = $state(false);
	let completed = $state<'approved' | 'denied' | null>(null);
	let loadedUserCode = $state('');
	let pendingDecision = $state<'approved' | 'denied' | null>(null);
	let activeUserCode = '';
	let requestedUserCode = '';
	let sessionRequestSequence = 0;
	let decisionRequestSequence = 0;
	const sessionPending = $derived(loading || (!session && !error && !completed));
	const selectedWorkspaceLabel = $derived(
		selectedWorkspaceID
			? (workspaceCtx.workspaces.find((workspace) => workspace.id === selectedWorkspaceID)?.name ??
					m.cli_authorize_current_workspace())
			: m.cli_authorize_all_workspaces()
	);

	let scopes = $derived(
		(session?.requested_scopes ?? '')
			.split(/[,\s]+/)
			.map((scope) => scope.trim())
			.filter(Boolean)
	);

	function loginRedirect(code: string) {
		return `/login?redirect=${encodeURIComponent(`/cli/authorize?user_code=${encodeURIComponent(code)}`)}`;
	}

	function resetAuthorization(code: string) {
		activeUserCode = code;
		requestedUserCode = '';
		sessionRequestSequence += 1;
		decisionRequestSequence += 1;
		session = null;
		tokenName = 'OpenPost CLI';
		selectedWorkspaceID = null;
		error = '';
		sessionLoadFailed = false;
		loading = false;
		submitting = false;
		completed = null;
		loadedUserCode = '';
		pendingDecision = null;
	}

	async function loadSession(code: string) {
		if (!code || requestedUserCode === code) return;

		requestedUserCode = code;
		const requestSequence = ++sessionRequestSequence;
		loading = true;
		error = '';
		sessionLoadFailed = false;

		try {
			const { data, error: apiError } = await client.GET('/cli/auth/session', {
				params: { query: { user_code: code } }
			});

			if (apiError || !data) {
				throw new Error(apiError?.detail ?? m.cli_authorize_load_failed());
			}
			if (
				requestSequence !== sessionRequestSequence ||
				activeUserCode !== code ||
				userCode !== code
			) {
				return;
			}

			session = data as CLIAuthSession;
			loadedUserCode = code;
		} catch (e) {
			if (
				requestSequence !== sessionRequestSequence ||
				activeUserCode !== code ||
				userCode !== code
			) {
				return;
			}
			error = (e as Error).message;
			sessionLoadFailed = true;
		} finally {
			if (requestSequence === sessionRequestSequence && activeUserCode === code) {
				loading = false;
			}
		}
	}

	function retryLoadSession() {
		const code = userCode;
		if (!code || code !== activeUserCode || loading) return;
		requestedUserCode = '';
		sessionRequestSequence += 1;
		void loadSession(code);
	}

	async function approve() {
		await submitDecision('approved');
	}

	async function deny() {
		await submitDecision('denied');
	}

	async function submitDecision(decision: 'approved' | 'denied') {
		const code = loadedUserCode;
		if (!session || !code || code !== userCode || code !== activeUserCode) return;

		const requestSequence = ++decisionRequestSequence;
		submitting = true;
		pendingDecision = decision;
		error = '';
		sessionLoadFailed = false;

		try {
			const path = decision === 'approved' ? '/cli/auth/approve' : '/cli/auth/deny';
			const body =
				decision === 'approved'
					? {
							user_code: code,
							name: tokenName || 'OpenPost CLI',
							workspace_id: selectedWorkspaceID ?? ''
						}
					: { user_code: code };
			const { error: apiError } = await client.POST(path, { body });

			if (apiError) {
				throw new Error(apiError?.detail ?? m.cli_authorize_decision_failed());
			}
			if (
				requestSequence !== decisionRequestSequence ||
				activeUserCode !== code ||
				userCode !== code
			) {
				return;
			}

			completed = decision;
		} catch (e) {
			if (
				requestSequence !== decisionRequestSequence ||
				activeUserCode !== code ||
				userCode !== code
			) {
				return;
			}
			error = (e as Error).message;
		} finally {
			if (requestSequence === decisionRequestSequence && activeUserCode === code) {
				submitting = false;
				pendingDecision = null;
			}
		}
	}

	$effect(() => {
		if (selectedWorkspaceID === null && workspaceCtx.currentWorkspace?.id) {
			selectedWorkspaceID = workspaceCtx.currentWorkspace.id;
		}
	});

	$effect(() => {
		const code = userCode;
		if (activeUserCode !== code) resetAuthorization(code);
		if (authState.isLoading) return;

		if (!code) {
			error = m.cli_authorize_missing_code();
			return;
		}

		if (!authState.user && !authState.isAuthenticated) {
			goto(resolve(loginRedirect(code) as '/'));
			return;
		}

		void loadSession(code);
	});
</script>

<svelte:head>
	<title>{m.cli_authorize_title()}</title>
</svelte:head>

{#snippet terminalIcon()}
	<TerminalIcon class="size-6" />
{/snippet}

{#snippet retryLoadAction()}
	<Button variant="outline" size="sm" disabled={loading} onclick={retryLoadSession}>
		{m.common_retry()}
	</Button>
{/snippet}

<StandaloneShell
	title={completed === 'approved'
		? m.cli_authorize_approved()
		: completed === 'denied'
			? m.cli_authorize_denied()
			: m.cli_authorize_heading()}
	description={completed ? m.cli_authorize_close_tab() : m.cli_authorize_description()}
	icon={terminalIcon}
	maxWidth="lg"
	loading={sessionPending}
	loadingLabel={m.cli_authorize_loading()}
>
	{#if error}
		<InlineNotice
			tone="error"
			message={error}
			actions={sessionLoadFailed ? retryLoadAction : undefined}
			class="mb-4"
		/>
	{/if}
	{#if completed}
		<div class="flex justify-center" role="status" aria-atomic="true">
			<span class="sr-only">
				{completed === 'approved' ? m.cli_authorize_approved() : m.cli_authorize_denied()}
				{m.cli_authorize_close_tab()}
			</span>
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				{#if completed === 'approved'}
					<ShieldCheckIcon class="size-6 text-primary" />
				{:else}
					<XIcon class="size-6 text-muted-foreground" />
				{/if}
			</div>
		</div>
	{:else if session}
		<div class="space-y-5">
			<div class="rounded-md border bg-muted/30 p-4">
				<div class="text-base font-semibold">{session.client_name}</div>
				<p class="mt-1 text-sm text-muted-foreground">
					{session.client_version || m.cli_authorize_unknown_version()} · {session.client_os ||
						m.cli_authorize_unknown_os()}
				</p>
			</div>

			<div class="space-y-2">
				<Label>{m.cli_authorize_scopes()}</Label>
				<div class="flex flex-wrap gap-2">
					{#each scopes as scope (scope)}
						<Badge>{scope}</Badge>
					{:else}
						<Badge>{m.cli_authorize_default_scope()}</Badge>
					{/each}
				</div>
			</div>

			<div class="space-y-2">
				<Label for="token-name">{m.cli_authorize_token_name()}</Label>
				<Input id="token-name" bind:value={tokenName} autocomplete="off" maxlength={120} />
			</div>

			<div class="space-y-2">
				<Label for="cli-workspace-scope">{m.cli_authorize_access_boundary()}</Label>
				<Select.Root
					type="single"
					value={selectedWorkspaceID || '__all__'}
					onValueChange={(value) => (selectedWorkspaceID = value === '__all__' ? '' : value)}
				>
					<Select.Trigger id="cli-workspace-scope" class="w-full">
						{selectedWorkspaceLabel}
					</Select.Trigger>
					<Select.Content>
						{#each workspaceCtx.workspaces as workspace (workspace.id)}
							<Select.Item value={workspace.id}>{workspace.name}</Select.Item>
						{/each}
						<Select.Item value="__all__">{m.cli_authorize_all_workspaces()}</Select.Item>
					</Select.Content>
				</Select.Root>
				<p class="text-sm leading-6 text-muted-foreground">
					{selectedWorkspaceID
						? m.cli_authorize_current_workspace_description()
						: m.cli_authorize_all_workspaces_description()}
				</p>
			</div>
			{#if selectedWorkspaceID === ''}
				<InlineNotice tone="warning" message={m.cli_authorize_all_workspaces_warning()} />
			{/if}

			<div class="flex flex-col gap-2 sm:flex-row">
				<Button
					class="w-full gap-2"
					onclick={approve}
					disabled={submitting || selectedWorkspaceID === null}
				>
					{#if pendingDecision === 'approved'}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<ShieldCheckIcon class="h-4 w-4" />
					{/if}
					{m.cli_authorize_approve()}
				</Button>
				<Button variant="outline" class="w-full gap-2" onclick={deny} disabled={submitting}>
					{#if pendingDecision === 'denied'}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<XIcon class="h-4 w-4" />
					{/if}
					{m.cli_authorize_deny()}
				</Button>
			</div>
		</div>
	{/if}
</StandaloneShell>
