<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { page } from '$app/stores';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { get, type Readable } from 'svelte/store';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		workspaceInvitationAcceptanceCachePlan,
		workspaceInvitationRefreshCachePlan
	} from '@openpost/query-catalog';
	import { executeQueryCachePlan } from '$lib/query/cache-plan';
	import { queryClient } from '$lib/query/client';
	import type { QueryClient } from '@tanstack/svelte-query';
	import { m } from '$lib/paraglide/messages';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import UsersIcon from '@lucide/svelte/icons/users';

	type InviteAuthStore = Pick<
		typeof auth,
		'subscribe' | 'captureUserProjection' | 'projectBootstrap'
	>;
	type InviteWorkspace = Pick<typeof workspaceCtx, 'loadWorkspaces' | 'workspaces'>;

	interface InviteDependencies {
		page: Readable<{ url: URL }>;
		auth: InviteAuthStore;
		workspace: InviteWorkspace;
		post: typeof client.POST;
		navigate: typeof goto;
		cache: QueryClient;
	}

	interface AcceptedWorkspaceRefreshContext {
		workspaceID: string;
		actorID: string;
		acceptanceRequestSequence: number;
		invitationKey: string;
	}

	const defaultDependencies: InviteDependencies = {
		page,
		auth,
		workspace: workspaceCtx,
		post: client.POST,
		navigate: goto,
		cache: queryClient
	};
	let { dependencies = defaultDependencies }: { dependencies?: InviteDependencies } = $props();
	let pageStore = $derived(dependencies.page);
	let authStore = $derived(dependencies.auth);

	let authState = $derived($authStore);
	let token = $derived($pageStore.url.searchParams.get('token') ?? '');
	let invitationID = $derived($pageStore.url.searchParams.get('id') ?? '');
	let invitationKey = $derived(invitationID ? `id:${invitationID}` : token ? `token:${token}` : '');
	let attemptedInvitation = $state('');
	let loading = $state(false);
	let accepted = $state(false);
	let error = $state('');
	let workspaceID = $state('');
	let role = $state('');
	let workspaceRefreshError = $state('');
	let workspaceRefreshPending = $state(false);
	let acceptedWorkspaceRefreshContext = $state.raw<AcceptedWorkspaceRefreshContext | null>(null);
	let invitationRequestSequence = 0;
	let workspaceRefreshRequestSequence = 0;
	const invitationPending = $derived(loading || (!accepted && !error));

	onDestroy(() => {
		invitationRequestSequence += 1;
		workspaceRefreshRequestSequence += 1;
		acceptedWorkspaceRefreshContext = null;
	});

	function loginRedirect() {
		const query = invitationID
			? `id=${encodeURIComponent(invitationID)}`
			: `token=${encodeURIComponent(token)}`;
		return `/login?redirect=${encodeURIComponent(`/invite?${query}`)}`;
	}

	async function invalidateAcceptedWorkspaceDependencies(targetWorkspaceID: string) {
		await executeQueryCachePlan(
			dependencies.cache,
			workspaceInvitationAcceptanceCachePlan(targetWorkspaceID)
		);
	}

	async function refreshAcceptedWorkspace(context: AcceptedWorkspaceRefreshContext) {
		const { workspaceID: targetWorkspaceID, actorID, acceptanceRequestSequence } = context;
		if (!targetWorkspaceID || !actorID || get(authStore).user?.id !== actorID) return;
		const refreshRequestSequence = ++workspaceRefreshRequestSequence;
		const isSameActor = () => get(authStore).user?.id === actorID;
		const isCurrentRequest = () =>
			refreshRequestSequence === workspaceRefreshRequestSequence &&
			acceptanceRequestSequence === invitationRequestSequence &&
			acceptedWorkspaceRefreshContext === context &&
			isSameActor() &&
			invitationKey === context.invitationKey;
		if (isCurrentRequest()) {
			workspaceRefreshPending = true;
			workspaceRefreshError = '';
		}
		try {
			const projection = dependencies.auth.captureUserProjection(actorID);
			if (!projection) return;
			const bootstrap = await dependencies.workspace.loadWorkspaces(targetWorkspaceID, {
				selectionIsCurrent: isCurrentRequest
			});
			if (!isSameActor()) return;
			if (!dependencies.auth.projectBootstrap(bootstrap, projection)) return;
			if (!isSameActor()) return;
			const organizationID =
				dependencies.workspace.workspaces.find((workspace) => workspace.id === targetWorkspaceID)
					?.organization_id ?? '';
			await executeQueryCachePlan(
				dependencies.cache,
				workspaceInvitationRefreshCachePlan(targetWorkspaceID, organizationID)
			);
		} catch (e) {
			if (isCurrentRequest()) {
				console.error('Failed to refresh workspaces after accepting invitation:', e);
				workspaceRefreshError = m.invite_workspace_refresh_failed();
			}
		} finally {
			if (isCurrentRequest()) workspaceRefreshPending = false;
		}
	}

	async function acceptInvitation(key: string, retry = false) {
		if (!key || (!retry && attemptedInvitation === key)) return;
		const requestSequence = ++invitationRequestSequence;
		const actorID = authState.user?.id ?? '';
		const isCurrentRequest = () =>
			requestSequence === invitationRequestSequence &&
			Boolean(actorID) &&
			get(authStore).user?.id === actorID &&
			invitationKey === key;
		const isSameActor = () => Boolean(actorID) && get(authStore).user?.id === actorID;
		attemptedInvitation = key;
		workspaceRefreshRequestSequence++;
		acceptedWorkspaceRefreshContext = null;
		loading = true;
		accepted = false;
		error = '';
		workspaceRefreshError = '';
		workspaceRefreshPending = false;
		try {
			const response = invitationID
				? await dependencies.post('/workspace-invitations/{id}/accept', {
						params: { path: { id: invitationID } }
					})
				: await dependencies.post('/workspace-invitations/accept', {
						body: { token }
					});
			const { data, error: apiError } = response;
			if (apiError || !data) {
				throw new Error(apiError?.detail || m.invite_accept_failed());
			}
			if (!isSameActor()) return;
			const refreshContext: AcceptedWorkspaceRefreshContext = {
				workspaceID: data.workspace_id,
				actorID,
				acceptanceRequestSequence: requestSequence,
				invitationKey: key
			};
			acceptedWorkspaceRefreshContext = refreshContext;
			await invalidateAcceptedWorkspaceDependencies(data.workspace_id);
			if (!isSameActor()) return;
			await refreshAcceptedWorkspace(refreshContext);
			if (!isCurrentRequest()) return;
			workspaceID = data.workspace_id;
			role = data.role;
			accepted = true;
			loading = false;
		} catch (cause) {
			if (!isCurrentRequest()) return;
			acceptedWorkspaceRefreshContext = null;
			accepted = false;
			error = cause instanceof Error ? cause.message : m.invite_accept_failed();
		} finally {
			if (isCurrentRequest()) loading = false;
		}
	}

	$effect(() => {
		const context = acceptedWorkspaceRefreshContext;
		if (
			context &&
			(context.actorID !== (authState.user?.id ?? '') || context.invitationKey !== invitationKey)
		) {
			acceptedWorkspaceRefreshContext = null;
			workspaceRefreshRequestSequence += 1;
			workspaceRefreshError = '';
			workspaceRefreshPending = false;
		}
	});

	$effect(() => {
		if (authState.isLoading) return;

		if (!invitationKey) {
			invitationRequestSequence++;
			workspaceRefreshRequestSequence++;
			attemptedInvitation = '';
			loading = false;
			accepted = false;
			error = m.invite_missing_token();
			workspaceRefreshError = '';
			workspaceRefreshPending = false;
			acceptedWorkspaceRefreshContext = null;
			return;
		}

		if (!authState.isAuthenticated) {
			acceptedWorkspaceRefreshContext = null;
			dependencies.navigate(resolveAppPath(loginRedirect()));
			return;
		}

		acceptInvitation(invitationKey);
	});
</script>

<svelte:head>
	<title>{m.invite_title()}</title>
</svelte:head>

{#snippet inviteIcon()}
	{#if accepted}
		<ShieldCheckIcon class="size-6" />
	{:else}
		<UsersIcon class="size-6" />
	{/if}
{/snippet}

{#snippet retryInvitation()}
	<Button
		variant="outline"
		size="sm"
		onclick={() => acceptInvitation(invitationKey, true)}
		disabled={!invitationKey || loading}
	>
		{m.common_retry()}
	</Button>
{/snippet}

{#snippet retryWorkspaceRefresh()}
	<Button
		variant="outline"
		size="sm"
		onclick={() =>
			acceptedWorkspaceRefreshContext &&
			void refreshAcceptedWorkspace(acceptedWorkspaceRefreshContext)}
		disabled={workspaceRefreshPending || !acceptedWorkspaceRefreshContext}
	>
		{m.common_retry()}
	</Button>
{/snippet}

<StandaloneShell
	title={accepted ? m.invite_accepted_heading() : m.invite_heading()}
	description={accepted ? m.invite_accepted_description({ role }) : m.invite_description()}
	icon={inviteIcon}
	maxWidth="lg"
	loading={invitationPending}
	loadingLabel={loading ? m.invite_accepting() : m.invite_checking()}
>
	{#if error}
		<div data-testid="invite-error">
			<InlineNotice tone="error" message={error} actions={retryInvitation} />
		</div>
	{/if}
	{#if accepted}
		<div class="space-y-4">
			<div class="rounded-md border bg-muted/30 p-4 text-sm">
				<p class="font-medium">{m.invite_workspace_joined()}</p>
				<p class="mt-1 font-mono text-xs text-muted-foreground">
					{workspaceID}
				</p>
			</div>
			{#if workspaceRefreshError}
				<div data-testid="invite-workspace-refresh-error">
					<InlineNotice
						tone="error"
						message={workspaceRefreshError}
						actions={retryWorkspaceRefresh}
					/>
				</div>
			{:else if workspaceRefreshPending}
				<InlineNotice tone="info" message={m.invite_refreshing_workspaces()} />
			{:else}
				<Button class="w-full" href={resolve('/')}>
					{m.invite_open_workspace()}
				</Button>
			{/if}
		</div>
	{/if}
</StandaloneShell>
