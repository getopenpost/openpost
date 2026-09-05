<script lang="ts">
	import { onDestroy } from 'svelte';
	import { auth, type AuthIdentityToken } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import {
		oidcIdentitiesQueryOptions,
		OpenPostQueryError,
		organizationQueryKeys,
		organizationsQueryOptions,
		organizationTeamQueryOptions,
		ownershipTransferQueryOptions,
		securityStatusQueryOptions
	} from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';
	import { organizationQueryAPI } from '$lib/query/organizations';
	import { queryClient } from '$lib/query/client';
	import type { components } from '$lib/api/types';
	import { acquireReauthGrant } from '$lib/auth/reauth';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import OrganizationDeleteDialog from '$lib/components/organization-delete-dialog.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';
	import { showToast } from '$lib/toast';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';

	type Member = components['schemas']['OrganizationMemberResponse'];
	type Organization = components['schemas']['OrganizationResponse'];
	type Transfer = components['schemas']['OwnershipTransferResponse'];
	type OrganizationTeam = components['schemas']['OrganizationTeamOutputBody'];
	type PendingTransfer = components['schemas']['PendingOwnershipTransferResponse'];
	type Security = components['schemas']['SecurityStatusOutputBody'];
	type Identity = components['schemas']['OIDCIdentitySummary'];
	interface Props {
		preferredOrganizationID?: string;
		currentUserID: string;
		active?: boolean;
		onDeleted?: () => void | Promise<void>;
	}
	let { preferredOrganizationID = '', currentUserID, active = false, onDeleted }: Props = $props();
	let loadedOrganizationID = '';
	let displayedOrganizationID = $state('');
	let organizationsLoaded = false;
	let organizationsReady = $state(false);
	let organizationListError = $state('');
	let organizationLoadGeneration = 0;
	let mutationSequence = 0;
	let mutationScope = '';
	let loading = $state(false),
		busy = $state(false),
		deleteDialogOpen = $state(false),
		pendingStateAvailable = $state(false),
		error = $state('');
	let organizationID = $state(''),
		nomineeUserID = $state(''),
		confirmation = $state(''),
		password = $state('');
	let organizations = $state.raw<Organization[]>([]),
		members = $state.raw<Member[]>([]),
		transfer = $state.raw<Transfer | null>(null),
		security = $state.raw<Security | null>(null),
		identities = $state.raw<Identity[]>([]);
	const selectedOrganization = $derived(
		organizations.find((organization) => organization.id === organizationID)
	);
	const organizationName = $derived(selectedOrganization?.name ?? '');
	const currentMember = $derived(members.find((member) => member.user_id === currentUserID));
	const currentOwner = $derived(members.find((member) => member.role === 'owner'));
	const isOwner = $derived(currentMember?.role === 'owner');
	const eligibleMembers = $derived(members.filter((member) => member.user_id !== currentUserID));
	const selectedNominee = $derived(members.find((member) => member.user_id === nomineeUserID));
	const passwordUsable = $derived(security?.user.password_usable ?? false);
	const passkeyAvailable = $derived((security?.passkeys?.length ?? 0) > 0);
	const providerID = $derived(identities.find((identity) => identity.active)?.provider_id ?? '');
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.ownership
	);
	$effect(() => {
		// Load-state reads stay unconditional so the effect keeps tracking them even
		// when an earlier term short-circuits; otherwise the boundary never settles.
		const waitingForOrganizations = !organizationsReady && !organizationListError;
		const organizationSelected = organizationsReady && organizationID && !error;
		const scopeStale = displayedOrganizationID !== organizationID;
		const waitingForState = loading && !pendingStateAvailable;
		reportInitialLoad(
			Boolean(
				active &&
				(waitingForOrganizations || (organizationSelected && (scopeStale || waitingForState)))
			)
		);
	});

	$effect(() => {
		const preferredID = preferredOrganizationID;
		if (!active) return;
		if (!organizationsLoaded) {
			organizationsLoaded = true;
			void loadOrganizations();
			return;
		}
		if (
			preferredID &&
			preferredID !== organizationID &&
			organizations.some((organization) => organization.id === preferredID)
		)
			organizationID = preferredID;
	});
	onDestroy(() => {
		organizationLoadGeneration += 1;
		mutationSequence += 1;
	});
	$effect(() => {
		const targetOrganizationID = active ? organizationID : '';
		if (targetOrganizationID !== mutationScope) {
			mutationScope = targetOrganizationID;
			mutationSequence += 1;
			busy = false;
			deleteDialogOpen = false;
		}
		if (active && organizationID && loadedOrganizationID !== organizationID) {
			loadedOrganizationID = organizationID;
			void loadOrganization();
		}
	});
	async function loadOrganizations() {
		const queryOptions = organizationsQueryOptions(organizationQueryAPI);
		const cachedOrganizations = queryClient.getQueryData<Organization[]>(queryOptions.queryKey);
		if (cachedOrganizations !== undefined) {
			applyOrganizations(cachedOrganizations);
			organizationsReady = true;
		}
		loading = cachedOrganizations === undefined;
		organizationListError = '';
		try {
			applyOrganizations(await queryClient.fetchQuery(queryOptions));
			organizationsReady = true;
			return true;
		} catch (cause) {
			if (cause instanceof OpenPostQueryError && (cause.status === 401 || cause.status === 403)) {
				queryClient.removeQueries({
					queryKey: queryOptions.queryKey,
					exact: true
				});
				organizations = [];
				organizationID = '';
				pendingStateAvailable = false;
				organizationsReady = false;
			}
			organizationListError =
				cause instanceof Error ? cause.message : m.settings_ownership_load_failed();
			return false;
		} finally {
			loading = false;
		}
	}

	function applyOrganizations(data: Organization[]) {
		organizations = data.filter((organization) => organization.role === 'owner');
		organizationID =
			organizations.find((organization) => organization.id === organizationID)?.id ??
			organizations.find((organization) => organization.id === preferredOrganizationID)?.id ??
			organizations[0]?.id ??
			'';
	}

	function actorIsCurrent(identity: AuthIdentityToken) {
		return auth.isIdentityCurrent(identity);
	}

	async function invalidateAuditCaches(targetOrganizationID: string, identity: AuthIdentityToken) {
		if (!actorIsCurrent(identity)) return;
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.auditRoot(targetOrganizationID)
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.instanceAuditRoot()
			})
		]);
	}
	async function retryLoad() {
		const organizationsLoadedSuccessfully = await loadOrganizations();
		if (organizationsLoadedSuccessfully && organizationID) {
			loadedOrganizationID = organizationID;
			await loadOrganization();
		}
	}
	async function loadOrganization() {
		const expectedOrganizationID = organizationID;
		const loadGeneration = ++organizationLoadGeneration;
		const scopeChanged = displayedOrganizationID !== expectedOrganizationID;
		error = '';
		nomineeUserID = '';
		confirmation = '';
		password = '';
		if (scopeChanged) {
			pendingStateAvailable = false;
			members = [];
			transfer = null;
			security = null;
			identities = [];
		}
		const teamOptions = organizationTeamQueryOptions(organizationQueryAPI, expectedOrganizationID);
		const transferOptions = ownershipTransferQueryOptions(
			organizationQueryAPI,
			expectedOrganizationID
		);
		const securityOptions = securityStatusQueryOptions(authQueryAPI);
		const identityOptions = oidcIdentitiesQueryOptions(authQueryAPI);
		const cachedTeam = queryClient.getQueryData<OrganizationTeam>(teamOptions.queryKey);
		const cachedTransfer = queryClient.getQueryData<PendingTransfer>(transferOptions.queryKey);
		const cachedSecurity = queryClient.getQueryData<Security>(securityOptions.queryKey);
		const cachedIdentities = queryClient.getQueryData<Identity[]>(identityOptions.queryKey);
		if (
			cachedTeam !== undefined &&
			cachedTransfer !== undefined &&
			cachedSecurity !== undefined &&
			cachedIdentities !== undefined
		) {
			members = cachedTeam.members ?? [];
			transfer = cachedTransfer.transfer ?? null;
			security = cachedSecurity;
			identities = cachedIdentities;
			pendingStateAvailable = true;
			displayedOrganizationID = expectedOrganizationID;
		}
		loading = !pendingStateAvailable;
		try {
			const [team, pending, securityResult, identityResult] = await Promise.all([
				queryClient.fetchQuery(teamOptions),
				queryClient.fetchQuery(transferOptions),
				queryClient.fetchQuery(securityOptions),
				queryClient.fetchQuery(identityOptions)
			]);
			if (
				loadGeneration !== organizationLoadGeneration ||
				expectedOrganizationID !== organizationID
			)
				return;
			members = team.members ?? [];
			transfer = pending.transfer ?? null;
			pendingStateAvailable = true;
			displayedOrganizationID = expectedOrganizationID;
			security = securityResult;
			identities = identityResult;
		} catch (cause) {
			if (
				loadGeneration !== organizationLoadGeneration ||
				expectedOrganizationID !== organizationID
			)
				return;
			if (cause instanceof OpenPostQueryError && (cause.status === 401 || cause.status === 403)) {
				queryClient.removeQueries({
					queryKey: organizationQueryKeys.detailRoot(expectedOrganizationID)
				});
				queryClient.removeQueries({
					queryKey: organizationQueryKeys.all(),
					exact: true
				});
				queryClient.removeQueries({
					queryKey: securityOptions.queryKey,
					exact: true
				});
				queryClient.removeQueries({
					queryKey: identityOptions.queryKey,
					exact: true
				});
				organizations = [];
				members = [];
				transfer = null;
				security = null;
				identities = [];
				pendingStateAvailable = false;
				displayedOrganizationID = '';
			}
			error = cause instanceof Error ? cause.message : m.settings_ownership_load_failed();
		} finally {
			if (
				loadGeneration === organizationLoadGeneration &&
				expectedOrganizationID === organizationID
			)
				loading = false;
		}
	}
	async function initiate() {
		if (!nomineeUserID || confirmation !== organizationName) return;
		const identity = auth.captureIdentity();
		if (!identity || identity.userID !== currentUserID) return;
		const targetOrganizationID = organizationID;
		const targetNomineeUserID = nomineeUserID;
		const targetConfirmation = confirmation;
		const sequence = ++mutationSequence;
		const mutationIsCurrent = () =>
			sequence === mutationSequence &&
			active &&
			organizationID === targetOrganizationID &&
			actorIsCurrent(identity);
		const reauthOptions = {
			password: passwordUsable ? password : '',
			hasPasskey: passkeyAvailable,
			providerID,
			isCurrent: mutationIsCurrent
		};
		busy = true;
		error = '';
		try {
			const grant = await acquireReauthGrant('organization.ownership.transfer', reauthOptions);
			if (grant === null) return;
			if (!reauthOptions.isCurrent()) return;
			const result = await client.POST('/organizations/{id}/ownership-transfer', {
				params: { path: { id: targetOrganizationID } },
				body: {
					nominee_user_id: targetNomineeUserID,
					confirm_organization_name: targetConfirmation,
					reauth_grant: grant
				}
			});
			if (result.error || !result.data)
				throw new Error(result.error?.detail || m.settings_ownership_initiate_failed());
			if (!actorIsCurrent(identity)) return;
			queryClient.setQueryData(organizationQueryKeys.ownershipTransfer(targetOrganizationID), {
				pending: true,
				transfer: result.data
			});
			await invalidateAuditCaches(targetOrganizationID, identity);
			if (!mutationIsCurrent()) return;
			transfer = result.data;
			nomineeUserID = '';
			confirmation = '';
			password = '';
			showToast(m.settings_ownership_initiated());
		} catch (cause) {
			if (mutationIsCurrent()) {
				error = cause instanceof Error ? cause.message : m.settings_ownership_initiate_failed();
			}
		} finally {
			if (mutationIsCurrent()) busy = false;
		}
	}
	async function revoke() {
		const identity = auth.captureIdentity();
		if (!identity || identity.userID !== currentUserID) return;
		const targetOrganizationID = organizationID;
		const sequence = ++mutationSequence;
		const mutationIsCurrent = () =>
			sequence === mutationSequence &&
			active &&
			organizationID === targetOrganizationID &&
			actorIsCurrent(identity);
		busy = true;
		error = '';
		try {
			const result = await client.DELETE('/organizations/{id}/ownership-transfer', {
				params: { path: { id: targetOrganizationID } }
			});
			if (result.error) {
				throw new Error(result.error.detail || m.settings_ownership_revoke_failed());
			}
			if (!actorIsCurrent(identity)) return;
			queryClient.setQueryData(organizationQueryKeys.ownershipTransfer(targetOrganizationID), {
				pending: false
			});
			await invalidateAuditCaches(targetOrganizationID, identity);
			if (mutationIsCurrent()) {
				transfer = null;
				showToast(m.settings_ownership_revoked());
			}
		} catch (cause) {
			if (mutationIsCurrent()) {
				error = cause instanceof Error ? cause.message : m.settings_ownership_revoke_failed();
			}
		} finally {
			if (mutationIsCurrent()) busy = false;
		}
	}
	async function deleteOrganization(
		deletedID: string,
		confirmation: {
			confirmName: string;
			currentPassword: string;
			reauthGrant?: string;
		}
	): Promise<boolean> {
		const identity = auth.captureIdentity();
		if (!identity || identity.userID !== currentUserID) return false;
		const actorID = identity.userID;
		const sequence = ++mutationSequence;
		const isSameActor = () => actorIsCurrent(identity);
		const isOperationCurrent = () => sequence === mutationSequence && active && isSameActor();
		const isCurrentRequest = () => isOperationCurrent() && organizationID === deletedID;
		const projected = await workspaceCtx.deleteOrganization(deletedID, confirmation);
		if (!projected || !isSameActor()) return false;
		try {
			const projection = auth.captureUserProjection(actorID);
			if (!projection) return false;
			const bootstrap = await workspaceCtx.loadWorkspaces(workspaceCtx.currentWorkspace?.id, {
				selectionIsCurrent: isOperationCurrent
			});
			if (!isSameActor()) return false;
			if (!auth.projectBootstrap(bootstrap, projection)) return false;
		} catch {
			// Deletion succeeded. The invalidated bootstrap will retry on the next load.
		}
		if (!isCurrentRequest()) return false;
		const deletedCurrentOrganization = organizationID === deletedID;
		organizations = organizations.filter((organization) => organization.id !== deletedID);
		queryClient.setQueryData<Organization[]>(organizationQueryKeys.all(), (current) =>
			current?.filter((organization) => organization.id !== deletedID)
		);
		queryClient.removeQueries({
			queryKey: organizationQueryKeys.detailRoot(deletedID)
		});
		if (deletedCurrentOrganization) {
			organizationID = organizations[0]?.id ?? '';
			loadedOrganizationID = '';
			displayedOrganizationID = '';
			pendingStateAvailable = false;
			members = [];
			transfer = null;
			security = null;
			identities = [];
		}
		if (!isOperationCurrent()) return false;
		showToast(m.organization_delete_success());
		await onDeleted?.();
		return true;
	}
</script>

{#if loading && !pendingStateAvailable}<PageLoading
		layout="settings"
		variant="cards"
		label={m.common_loading()}
		items={2}
	/>
{:else}<div class="space-y-6">
		{#if organizationListError}<InlineNotice
				tone={organizationsReady ? 'warning' : 'error'}
				message={organizationListError}
				>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => void retryLoad()}
						>{m.common_retry()}</Button
					>{/snippet}</InlineNotice
			>{/if}
		{#if error}<InlineNotice tone={pendingStateAvailable ? 'warning' : 'error'} message={error}
				>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => void retryLoad()}
						>{m.common_retry()}</Button
					>{/snippet}</InlineNotice
			>{/if}
		{#if organizationsReady && organizations.length === 0}<InlineNotice
				tone="info"
				message={m.settings_ownership_owner_only()}
			/>
		{:else if organizationsReady}<div class="space-y-2 rounded-lg border p-4">
				<Label for="ownership-organization">{m.settings_ownership_organization()}</Label>
				<Select.Root type="single" bind:value={organizationID} disabled={busy}>
					<Select.Trigger id="ownership-organization" class="w-full">
						{selectedOrganization?.name ?? m.settings_ownership_choose_organization()}
					</Select.Trigger>
					<Select.Content>
						{#each organizations as organization (organization.id)}
							<Select.Item value={organization.id}>{organization.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if currentOwner}
					<p class="text-sm text-muted-foreground">
						{m.settings_ownership_current_owner({ email: currentOwner.email })}
					</p>
				{/if}
			</div>
		{/if}
		{#if organizations.length > 0 && pendingStateAvailable}
			{#if !isOwner}<InlineNotice tone="info" message={m.settings_ownership_owner_only()} />
			{:else if transfer}<div class="rounded-lg border p-4">
					<p class="font-medium">{m.settings_ownership_pending()}</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{m.settings_ownership_pending_body({
							email: transfer.nominee_email,
							date: new Date(transfer.expires_at).toLocaleString()
						})}
					</p>
					<Button class="mt-4" variant="outline" disabled={busy} onclick={() => void revoke()}
						>{m.settings_ownership_revoke()}</Button
					>
				</div>
			{:else}<form
					class="space-y-4 rounded-lg border p-4"
					onsubmit={(event) => {
						event.preventDefault();
						void initiate();
					}}
				>
					<div class="space-y-2">
						<Label for="ownership-nominee">{m.settings_ownership_nominee()}</Label><Select.Root
							type="single"
							bind:value={nomineeUserID}
							><Select.Trigger id="ownership-nominee" class="w-full"
								>{selectedNominee?.email || m.settings_ownership_choose_nominee()}</Select.Trigger
							><Select.Content
								>{#each eligibleMembers as member (member.user_id)}<Select.Item
										value={member.user_id}>{member.email} · {member.role}</Select.Item
									>{/each}</Select.Content
							></Select.Root
						>
					</div>
					<div class="space-y-2">
						<Label for="ownership-confirm"
							>{m.settings_ownership_confirm({
								organization: organizationName
							})}</Label
						><Input id="ownership-confirm" bind:value={confirmation} autocomplete="off" />
					</div>
					{#if passwordUsable}<div class="space-y-2">
							<Label for="ownership-password">{m.settings_ownership_password()}</Label><Input
								id="ownership-password"
								type="password"
								bind:value={password}
								autocomplete="current-password"
							/>
						</div>{/if}
					<InlineNotice tone="warning" message={m.settings_ownership_warning()} /><Button
						type="submit"
						disabled={busy ||
							!nomineeUserID ||
							confirmation !== organizationName ||
							(passwordUsable && !password)}
						>{busy ? m.common_saving() : m.settings_ownership_initiate()}</Button
					>
				</form>{/if}
			{#if isOwner}<div
					class="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
				>
					<div>
						<p class="text-sm font-medium text-destructive">
							{m.organization_delete_title()}
						</p>
						<p class="text-sm text-muted-foreground">
							{m.organization_delete_description()}
						</p>
					</div>
					<Button variant="destructive" class="shrink-0" onclick={() => (deleteDialogOpen = true)}
						>{m.organization_delete_confirm()}</Button
					>
				</div>{/if}
		{/if}
	</div>{/if}

<OrganizationDeleteDialog
	bind:open={deleteDialogOpen}
	{organizationID}
	{organizationName}
	hasPassword={passwordUsable}
	onConfirm={deleteOrganization}
/>
