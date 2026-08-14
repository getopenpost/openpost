<script lang="ts">
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { acquireReauthGrant } from '$lib/auth/reauth';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import OrganizationDeleteDialog from '$lib/components/organization-delete-dialog.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';

	type Member = components['schemas']['OrganizationMemberResponse'];
	type Organization = components['schemas']['OrganizationResponse'];
	type Transfer = components['schemas']['OwnershipTransferResponse'];
	type Security = components['schemas']['SecurityStatusOutputBody'];
	type Identity = components['schemas']['OIDCIdentitySummary'];
	interface Props {
		preferredOrganizationID?: string;
		currentUserID: string;
		active?: boolean;
	}
	let { preferredOrganizationID = '', currentUserID, active = false }: Props = $props();
	let loadedOrganizationID = '';
	let organizationsLoaded = false;
	let organizationLoadGeneration = 0;
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
	$effect(() => {
		if (active && organizationID && loadedOrganizationID !== organizationID) {
			loadedOrganizationID = organizationID;
			void loadOrganization();
		}
	});
	async function loadOrganizations() {
		loading = true;
		pendingStateAvailable = false;
		error = '';
		const result = await client.GET('/organizations');
		if (result.error) {
			error = result.error.detail || m.settings_ownership_load_failed();
			loading = false;
			return;
		}
		organizations = (result.data ?? []).filter((organization) => organization.role === 'owner');
		organizationID =
			organizations.find((organization) => organization.id === preferredOrganizationID)?.id ??
			organizations[0]?.id ??
			'';
		if (!organizationID) loading = false;
	}
	async function retryLoad() {
		if (organizationID) {
			await loadOrganization();
			return;
		}
		await loadOrganizations();
	}
	async function loadOrganization() {
		const expectedOrganizationID = organizationID;
		const loadGeneration = ++organizationLoadGeneration;
		loading = true;
		pendingStateAvailable = false;
		error = '';
		nomineeUserID = '';
		confirmation = '';
		password = '';
		members = [];
		transfer = null;
		security = null;
		identities = [];
		const [team, pending, securityResult, identityResult] = await Promise.all([
			client.GET('/organizations/{id}/team', {
				params: { path: { id: expectedOrganizationID } }
			}),
			client.GET('/organizations/{id}/ownership-transfer', {
				params: { path: { id: expectedOrganizationID } }
			}),
			client.GET('/auth/security'),
			client.GET('/auth/oidc/identities')
		]);
		if (loadGeneration !== organizationLoadGeneration || expectedOrganizationID !== organizationID)
			return;
		if (
			team.error ||
			(pending.error && pending.response.status !== 404) ||
			securityResult.error ||
			identityResult.error
		) {
			error =
				team.error?.detail ||
				pending.error?.detail ||
				securityResult.error?.detail ||
				identityResult.error?.detail ||
				m.settings_ownership_load_failed();
			loading = false;
			return;
		}
		members = team.data?.members ?? [];
		transfer = pending.response.status === 404 ? null : (pending.data ?? null);
		pendingStateAvailable = true;
		security = securityResult.data ?? null;
		identities = identityResult.data ?? [];
		loading = false;
	}
	async function initiate() {
		if (!nomineeUserID || confirmation !== organizationName) return;
		busy = true;
		error = '';
		try {
			const grant = await acquireReauthGrant('organization.ownership.transfer', {
				password: passwordUsable ? password : '',
				hasPasskey: passkeyAvailable,
				providerID
			});
			if (grant === null) return;
			const result = await client.POST('/organizations/{id}/ownership-transfer', {
				params: { path: { id: organizationID } },
				body: {
					nominee_user_id: nomineeUserID,
					confirm_organization_name: confirmation,
					reauth_grant: grant
				}
			});
			if (result.error || !result.data)
				throw new Error(result.error?.detail || m.settings_ownership_initiate_failed());
			transfer = result.data;
			nomineeUserID = '';
			confirmation = '';
			password = '';
			showToast(m.settings_ownership_initiated());
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
	async function revoke() {
		busy = true;
		error = '';
		const result = await client.DELETE('/organizations/{id}/ownership-transfer', {
			params: { path: { id: organizationID } }
		});
		busy = false;
		if (result.error) {
			error = result.error.detail || m.settings_ownership_revoke_failed();
			return;
		}
		transfer = null;
		showToast(m.settings_ownership_revoked());
	}
	async function deleteOrganization(confirmation: {
		confirmName: string;
		currentPassword: string;
		reauthGrant?: string;
	}) {
		const deletedID = organizationID;
		await workspaceCtx.deleteOrganization(deletedID, confirmation);
		organizations = organizations.filter((organization) => organization.id !== deletedID);
		organizationID = organizations[0]?.id ?? '';
		loadedOrganizationID = '';
		showToast(m.organization_delete_success());
	}
</script>

{#if loading}<PageLoading layout="settings" variant="cards" label={m.common_loading()} items={2} />
{:else}<div class="space-y-6">
		<SectionHeader
			title={m.settings_ownership_heading()}
			description={m.settings_ownership_body()}
			icon={KeyRoundIcon}
		/>
		{#if error}<InlineNotice tone="error" message={error}
				>{#snippet actions()}<Button variant="outline" size="sm" onclick={() => void retryLoad()}
						>{m.common_retry()}</Button
					>{/snippet}</InlineNotice
			>{/if}
		{#if organizations.length === 0}<InlineNotice
				tone="info"
				message={m.settings_ownership_owner_only()}
			/>
		{:else}<div class="space-y-2 rounded-lg border p-4">
				<Label for="ownership-organization">{m.settings_ownership_organization()}</Label>
				<Select.Root type="single" bind:value={organizationID}>
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
							>{m.settings_ownership_confirm({ organization: organizationName })}</Label
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
						<p class="text-sm font-medium text-destructive">{m.organization_delete_title()}</p>
						<p class="text-sm text-muted-foreground">{m.organization_delete_description()}</p>
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
