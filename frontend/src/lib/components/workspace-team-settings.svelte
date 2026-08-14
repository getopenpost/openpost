<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AppSelect from '$lib/components/app-select.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { client } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import type {
		TeamMember,
		WorkspaceAccessAuditEvent,
		WorkspaceInvitation,
		WorkspaceTeam
	} from '../../routes/settings/settings-data';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UsersIcon from '@lucide/svelte/icons/users';

	type WorkspaceRole = 'admin' | 'editor' | 'viewer';
	type TeamStatus = 'all' | 'active' | 'inactive' | 'pending' | 'expired';
	type DestructiveAction =
		| { kind: 'revoke'; invitation: WorkspaceInvitation }
		| { kind: 'deactivate'; member: TeamMember }
		| { kind: 'remove'; member: TeamMember };

	interface Props {
		workspaceID: string;
		currentUserID: string;
		active?: boolean;
		onMembershipChanged?: () => void | Promise<void>;
	}

	let {
		workspaceID,
		currentUserID,
		active = false,
		onMembershipChanged = () => undefined
	}: Props = $props();

	const unsavedChanges = getOptionalUnsavedChanges();
	let loading = $state(false);
	let loadError = $state('');
	let actionError = $state('');
	let team = $state.raw<WorkspaceTeam | null>(null);
	let auditEvents = $state.raw<WorkspaceAccessAuditEvent[]>([]);
	let auditLoading = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<WorkspaceRole>('editor');
	let search = $state('');
	let roleFilter = $state<'all' | WorkspaceRole>('all');
	let statusFilter = $state<TeamStatus>('all');
	let busyKey = $state('');
	let createdInviteURL = $state('');
	let createdInviteDeliveryStatus = $state<WorkspaceInvitation['email_delivery_status'] | ''>('');
	let destructiveOpen = $state(false);
	let destructiveAction = $state.raw<DestructiveAction | null>(null);
	let requestSequence = 0;
	let loadedWorkspaceID = '';

	const canManage = $derived(team?.can_manage ?? false);
	const draftDirty = $derived(Boolean(inviteEmail.trim()) || inviteRole !== 'editor');
	const normalizedSearch = $derived(search.trim().toLocaleLowerCase());
	const filteredMembers = $derived.by(() => {
		if (!team || statusFilter === 'pending' || statusFilter === 'expired') return [];
		return team.members.filter((member) => {
			if (roleFilter !== 'all' && member.role !== roleFilter) return false;
			if (statusFilter !== 'all' && member.status !== statusFilter) return false;
			return !normalizedSearch || member.email.toLocaleLowerCase().includes(normalizedSearch);
		});
	});
	const filteredInvitations = $derived.by(() => {
		if (!team || statusFilter === 'active' || statusFilter === 'inactive') return [];
		return team.invitations.filter((invitation) => {
			if (roleFilter !== 'all' && invitation.role !== roleFilter) return false;
			if (statusFilter !== 'all' && invitation.status !== statusFilter) return false;
			return !normalizedSearch || invitation.email.toLocaleLowerCase().includes(normalizedSearch);
		});
	});
	const hasResults = $derived(filteredMembers.length > 0 || filteredInvitations.length > 0);
	const roleOptions = $derived([
		{ value: 'all', label: m.settings_team_all_roles() },
		{ value: 'admin', label: roleLabel('admin') },
		{ value: 'editor', label: roleLabel('editor') },
		{ value: 'viewer', label: roleLabel('viewer') }
	]);
	const editableRoleOptions = $derived(roleOptions.slice(1));
	const statusOptions = $derived([
		{ value: 'all', label: m.settings_team_all_statuses() },
		{ value: 'active', label: m.settings_member_status_active() },
		{ value: 'inactive', label: m.settings_member_status_inactive() },
		{ value: 'pending', label: m.settings_invitation_status_pending() },
		{ value: 'expired', label: m.settings_invitation_status_expired() }
	]);

	$effect(() => {
		unsavedChanges?.set('member-settings', draftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('member-settings');
	});

	$effect(() => {
		const nextWorkspaceID = workspaceID;
		if (!active || !nextWorkspaceID || loadedWorkspaceID === nextWorkspaceID) return;
		void loadTeam(nextWorkspaceID);
	});

	async function loadTeam(targetWorkspaceID = workspaceID, preserveCurrent = false) {
		if (!targetWorkspaceID) return;
		const sequence = ++requestSequence;
		loadedWorkspaceID = targetWorkspaceID;
		loading = true;
		loadError = '';
		actionError = '';
		if (!preserveCurrent) {
			team = null;
			auditEvents = [];
			createdInviteURL = '';
			createdInviteDeliveryStatus = '';
		}
		try {
			const { data, error } = await client.GET('/workspaces/{id}/team', {
				params: { path: { id: targetWorkspaceID } }
			});
			if (error || !data) throw new Error(error?.detail || m.settings_team_load_failed());
			if (sequence !== requestSequence || workspaceID !== targetWorkspaceID) return;
			team = data as WorkspaceTeam;
			if (team.can_manage) void loadAudit(targetWorkspaceID, sequence);
		} catch (error) {
			if (sequence !== requestSequence || workspaceID !== targetWorkspaceID) return;
			loadedWorkspaceID = '';
			loadError = (error as Error).message || m.settings_team_load_failed();
		} finally {
			if (sequence === requestSequence) loading = false;
		}
	}

	async function loadAudit(targetWorkspaceID: string, sequence = requestSequence) {
		auditLoading = true;
		try {
			const { data, error } = await client.GET('/workspaces/{id}/access-audit', {
				params: { path: { id: targetWorkspaceID }, query: { limit: 20 } }
			});
			if (error) throw new Error(error.detail || m.settings_action_failed());
			if (sequence === requestSequence && workspaceID === targetWorkspaceID) {
				auditEvents = (data ?? []) as WorkspaceAccessAuditEvent[];
			}
		} catch (error) {
			if (sequence === requestSequence && workspaceID === targetWorkspaceID) {
				actionError = (error as Error).message;
			}
		} finally {
			if (sequence === requestSequence) auditLoading = false;
		}
	}

	async function createInvitation(event: SubmitEvent) {
		event.preventDefault();
		if (!canManage || !inviteEmail.trim()) return;
		const targetWorkspaceID = workspaceID;
		busyKey = 'invite';
		actionError = '';
		createdInviteURL = '';
		createdInviteDeliveryStatus = '';
		try {
			const { data, error } = await client.POST('/workspaces/{id}/invitations', {
				params: { path: { id: targetWorkspaceID } },
				body: { email: inviteEmail.trim(), role: inviteRole }
			});
			if (error || !data) throw new Error(error?.detail || m.settings_action_failed());
			if (workspaceID !== targetWorkspaceID) return;
			const invitation = data;
			const nextInviteURL = invitation.accept_url || '';
			inviteEmail = '';
			inviteRole = 'editor';
			createdInviteURL = nextInviteURL;
			createdInviteDeliveryStatus = invitation.email_delivery_status;
			await reloadAfterMutation(targetWorkspaceID);
			showToast(m.settings_invite_created());
		} catch (error) {
			if (workspaceID === targetWorkspaceID) actionError = (error as Error).message;
		} finally {
			busyKey = '';
		}
	}

	async function updateMember(
		member: TeamMember,
		update: { role?: WorkspaceRole; status?: 'active' | 'inactive' }
	) {
		const targetWorkspaceID = workspaceID;
		busyKey = `member:${member.user_id}`;
		actionError = '';
		try {
			const { error } = await client.PATCH('/workspaces/{id}/members/{user_id}', {
				params: { path: { id: targetWorkspaceID, user_id: member.user_id } },
				body: update
			});
			if (error) throw new Error(error.detail || m.settings_action_failed());
			if (workspaceID !== targetWorkspaceID) return;
			await reloadAfterMutation(targetWorkspaceID);
			if (update.role) showToast(m.settings_member_role_updated());
			if (update.status === 'inactive') showToast(m.settings_member_deactivated());
			if (update.status === 'active') showToast(m.settings_member_reactivated());
			if (member.user_id === currentUserID) await onMembershipChanged();
		} catch (error) {
			if (workspaceID === targetWorkspaceID) actionError = (error as Error).message;
		} finally {
			busyKey = '';
		}
	}

	async function removeMember(member: TeamMember) {
		const targetWorkspaceID = workspaceID;
		busyKey = `member:${member.user_id}`;
		actionError = '';
		try {
			const { error } = await client.DELETE('/workspaces/{id}/members/{user_id}', {
				params: { path: { id: targetWorkspaceID, user_id: member.user_id } }
			});
			if (error) throw new Error(error.detail || m.settings_action_failed());
			if (workspaceID !== targetWorkspaceID) return;
			showToast(m.settings_member_removed());
			if (member.user_id === currentUserID) {
				await onMembershipChanged();
				return;
			}
			await reloadAfterMutation(targetWorkspaceID);
		} catch (error) {
			if (workspaceID === targetWorkspaceID) actionError = (error as Error).message;
		} finally {
			busyKey = '';
		}
	}

	async function resendInvitation(invitation: WorkspaceInvitation) {
		const targetWorkspaceID = workspaceID;
		busyKey = `invitation:${invitation.id}`;
		actionError = '';
		createdInviteURL = '';
		createdInviteDeliveryStatus = '';
		try {
			const { data, error } = await client.POST(
				'/workspaces/{id}/invitations/{invitation_id}/resend',
				{ params: { path: { id: targetWorkspaceID, invitation_id: invitation.id } } }
			);
			if (error || !data) throw new Error(error?.detail || m.settings_action_failed());
			if (workspaceID !== targetWorkspaceID) return;
			const nextInviteURL = data.accept_url || '';
			createdInviteURL = nextInviteURL;
			createdInviteDeliveryStatus = data.email_delivery_status;
			await reloadAfterMutation(targetWorkspaceID);
			showToast(m.settings_invitation_resent());
		} catch (error) {
			if (workspaceID === targetWorkspaceID) actionError = (error as Error).message;
		} finally {
			busyKey = '';
		}
	}

	async function revokeInvitation(invitation: WorkspaceInvitation) {
		const targetWorkspaceID = workspaceID;
		busyKey = `invitation:${invitation.id}`;
		actionError = '';
		try {
			const { error } = await client.DELETE('/workspaces/{id}/invitations/{invitation_id}', {
				params: { path: { id: targetWorkspaceID, invitation_id: invitation.id } }
			});
			if (error) throw new Error(error.detail || m.settings_action_failed());
			if (workspaceID !== targetWorkspaceID) return;
			await reloadAfterMutation(targetWorkspaceID);
			showToast(m.settings_invitation_revoked());
		} catch (error) {
			if (workspaceID === targetWorkspaceID) actionError = (error as Error).message;
		} finally {
			busyKey = '';
		}
	}

	async function reloadAfterMutation(targetWorkspaceID: string) {
		loadedWorkspaceID = '';
		await loadTeam(targetWorkspaceID, true);
	}

	async function copyInviteURL() {
		if (!createdInviteURL) return;
		await navigator.clipboard.writeText(createdInviteURL);
		showToast(m.settings_invite_copied());
	}

	function requestDestructiveAction(action: DestructiveAction) {
		destructiveAction = action;
		destructiveOpen = true;
	}

	async function confirmDestructiveAction() {
		const action = destructiveAction;
		if (!action) return;
		if (action.kind === 'revoke') await revokeInvitation(action.invitation);
		if (action.kind === 'deactivate') {
			await updateMember(action.member, { status: 'inactive' });
		}
		if (action.kind === 'remove') await removeMember(action.member);
	}

	function destructiveTitle() {
		if (destructiveAction?.kind === 'revoke') return m.settings_revoke_invitation_title();
		if (destructiveAction?.kind === 'deactivate') return m.settings_member_deactivate_title();
		return m.settings_member_remove_title();
	}

	function destructiveBody() {
		if (destructiveAction?.kind === 'revoke') return m.settings_revoke_invitation_body();
		if (destructiveAction?.kind === 'deactivate') {
			return m.settings_member_deactivate_body({ email: destructiveAction.member.email });
		}
		if (destructiveAction?.kind === 'remove') {
			return m.settings_member_remove_body({ email: destructiveAction.member.email });
		}
		return '';
	}

	function roleLabel(role: string) {
		if (role === 'admin') return m.settings_role_admin();
		if (role === 'viewer') return m.settings_role_viewer();
		return m.settings_role_editor();
	}

	function roleDescription(role: string) {
		if (role === 'admin') return m.settings_role_admin_description();
		if (role === 'viewer') return m.settings_role_viewer_description();
		return m.settings_role_editor_description();
	}

	function invitationDelivery(status: WorkspaceInvitation['email_delivery_status']) {
		switch (status) {
			case 'queued':
				return {
					label: m.settings_invitation_delivery_queued(),
					createdMessage: m.settings_invite_delivery_queued(),
					tone: 'success' as const,
					needsAction: false
				};
			case 'sent':
				return {
					label: m.settings_invitation_delivery_sent(),
					createdMessage: m.settings_invite_delivery_sent(),
					tone: 'success' as const,
					needsAction: false
				};
			case 'failed':
				return {
					label: m.settings_invitation_delivery_failed(),
					createdMessage: m.settings_invite_delivery_failed(),
					tone: 'warning' as const,
					needsAction: true
				};
			default:
				return {
					label: m.settings_invitation_delivery_unavailable(),
					createdMessage: m.settings_invite_delivery_unavailable(),
					tone: 'warning' as const,
					needsAction: true
				};
		}
	}

	function formatDate(value: string) {
		if (!value) return '';
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
	}

	function auditDescription(event: WorkspaceAccessAuditEvent) {
		const email = event.subject_email || m.settings_team_member_unknown();
		if (event.action === 'invitation.created')
			return m.settings_access_invitation_created({ email });
		if (event.action === 'invitation.resent') return m.settings_access_invitation_resent({ email });
		if (event.action === 'invitation.revoked')
			return m.settings_access_invitation_revoked({ email });
		if (event.action === 'invitation.accepted')
			return m.settings_access_invitation_accepted({ email });
		if (event.action === 'member.role_changed') {
			return m.settings_access_role_changed({
				email,
				from: roleLabel(event.previous_role || ''),
				to: roleLabel(event.role || '')
			});
		}
		if (event.action === 'member.deactivated')
			return m.settings_access_member_deactivated({ email });
		if (event.action === 'member.reactivated')
			return m.settings_access_member_reactivated({ email });
		if (event.action === 'member.removed') return m.settings_access_member_removed({ email });
		return event.action;
	}
</script>

{#snippet headerActions()}
	{#if !loading && team}
		<div class="rounded-md border bg-muted/20 px-3 py-2 text-sm">
			<span class="text-muted-foreground">
				{team.current_seats === 1
					? m.settings_seat_reserved()
					: m.settings_seats_reserved({ count: team.current_seats })}
			</span>
		</div>
	{/if}
{/snippet}

<SectionHeader
	title={m.settings_team()}
	description={m.settings_team_body()}
	icon={UsersIcon}
	actions={!loading && team ? headerActions : undefined}
	class="mb-4"
/>

{#if loadError}
	<div data-testid="team-load-error" class="mb-4">
		<InlineNotice tone="error" message={loadError}>
			{#snippet actions()}
				<Button
					variant="outline"
					size="sm"
					onclick={() => void loadTeam(workspaceID, Boolean(createdInviteURL))}
					disabled={loading}
				>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{/if}
{#if actionError}
	<div data-testid="team-error" class="mb-4">
		<InlineNotice tone="error" message={actionError} />
	</div>
{/if}

{#if loading}
	<PageLoading layout="grid" label={m.common_loading()} items={2} />
{:else if team}
	{#if canManage}
		<form
			onsubmit={createInvitation}
			class="mb-5 grid gap-3 rounded-lg border bg-muted/10 p-4 lg:grid-cols-[minmax(0,1fr)_220px_auto]"
		>
			<div class="space-y-2">
				<Label for="team-invite-email">{m.settings_invite_email()}</Label>
				<Input
					id="team-invite-email"
					data-testid="team-invite-email"
					type="email"
					bind:value={inviteEmail}
					placeholder="teammate@example.com"
					autocomplete="email"
					required
				/>
			</div>
			<div class="space-y-2">
				<Label for="team-invite-role">{m.settings_role()}</Label>
				<AppSelect
					id="team-invite-role"
					bind:value={inviteRole}
					options={editableRoleOptions}
					ariaLabel={m.settings_role()}
				/>
				<p class="text-xs text-muted-foreground">{roleDescription(inviteRole)}</p>
			</div>
			<div class="flex items-end">
				<Button type="submit" disabled={Boolean(busyKey) || !inviteEmail.trim()}>
					{#if busyKey === 'invite'}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<UserPlusIcon class="size-4" />
					{/if}
					{m.settings_send_invite()}
				</Button>
			</div>
		</form>
	{:else}
		<div class="mb-5"><InlineNotice tone="info" message={m.settings_team_read_only()} /></div>
	{/if}

	{#if createdInviteURL}
		<div data-testid="team-invite-link" data-feedback-redact>
			<InlineNotice
				tone={invitationDelivery(createdInviteDeliveryStatus || 'unavailable').tone}
				class="mb-5"
			>
				<p class="font-medium">
					{invitationDelivery(createdInviteDeliveryStatus || 'unavailable').createdMessage}
				</p>
				<div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
					<p class="min-w-0 flex-1 rounded-md bg-background px-3 py-2 font-mono text-xs break-all">
						{createdInviteURL}
					</p>
					<Button type="button" variant="outline" size="sm" onclick={copyInviteURL}>
						<CopyIcon class="size-4" />
						{m.common_copy()}
					</Button>
				</div>
			</InlineNotice>
		</div>
	{/if}

	<div class="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
		<div class="space-y-2">
			<Label for="team-search">{m.settings_team_search()}</Label>
			<div class="relative">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id="team-search"
					data-testid="team-search"
					bind:value={search}
					class="pl-9"
					placeholder={m.settings_team_search_placeholder()}
				/>
			</div>
		</div>
		<div class="space-y-2">
			<Label for="team-role-filter">{m.settings_team_filter_role()}</Label>
			<AppSelect
				id="team-role-filter"
				bind:value={roleFilter}
				options={roleOptions}
				ariaLabel={m.settings_team_filter_role()}
			/>
		</div>
		<div class="space-y-2">
			<Label for="team-status-filter">{m.settings_team_filter_status()}</Label>
			<AppSelect
				id="team-status-filter"
				bind:value={statusFilter}
				options={statusOptions}
				ariaLabel={m.settings_team_filter_status()}
			/>
		</div>
	</div>

	{#if !hasResults}
		<p class="rounded-md border bg-muted/20 p-5 text-sm text-muted-foreground">
			{m.settings_team_no_results()}
		</p>
	{:else}
		<div class="grid gap-5 xl:grid-cols-2">
			{#if statusFilter !== 'pending' && statusFilter !== 'expired'}
				<div>
					<h3 class="mb-2 text-sm font-semibold">{m.settings_members_heading()}</h3>
					<div data-testid="team-members-list" class="space-y-2">
						{#each filteredMembers as member (member.user_id)}
							<div class="rounded-md border p-3">
								<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">
											{member.email}
											{#if member.user_id === currentUserID}<span class="text-muted-foreground">
													{m.settings_member_you()}</span
												>{/if}
										</p>
										<p class="mt-1 text-xs text-muted-foreground">
											{m.settings_member_since({ date: formatDate(member.created_at) })}
										</p>
									</div>
									<span
										class={[
											'inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium',
											member.status === 'active'
												? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
												: 'bg-muted text-muted-foreground'
										]}
									>
										{member.status === 'active'
											? m.settings_member_status_active()
											: m.settings_member_status_inactive()}
									</span>
								</div>
								<div class="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
									{#if canManage}
										<AppSelect
											value={member.role}
											options={editableRoleOptions}
											ariaLabel={m.settings_member_role_for({ email: member.email })}
											disabled={Boolean(busyKey)}
											class="w-full sm:w-40"
											onValueChange={(role) => {
												if (role === 'admin' || role === 'editor' || role === 'viewer') {
													void updateMember(member, { role });
												}
											}}
										/>
										<div class="flex flex-wrap gap-1 sm:ml-auto">
											{#if member.status === 'active'}
												<Button
													type="button"
													variant="outline"
													size="sm"
													disabled={Boolean(busyKey)}
													onclick={() => requestDestructiveAction({ kind: 'deactivate', member })}
												>
													{m.settings_member_deactivate()}
												</Button>
											{:else}
												<Button
													type="button"
													variant="outline"
													size="sm"
													disabled={Boolean(busyKey)}
													onclick={() => void updateMember(member, { status: 'active' })}
												>
													{#if busyKey === `member:${member.user_id}`}<LoaderIcon
															class="size-4 animate-spin"
														/>{:else}<RefreshCwIcon class="size-4" />{/if}
													{m.settings_member_reactivate()}
												</Button>
											{/if}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="text-destructive hover:text-destructive"
												disabled={Boolean(busyKey)}
												onclick={() => requestDestructiveAction({ kind: 'remove', member })}
											>
												{m.settings_member_remove()}
											</Button>
										</div>
									{:else}
										<span
											class="inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium"
											>{roleLabel(member.role)}</span
										>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if statusFilter !== 'active' && statusFilter !== 'inactive'}
				<div>
					<h3 class="mb-2 text-sm font-semibold">{m.settings_pending_invitations()}</h3>
					<div data-testid="team-invitations-list" class="space-y-2">
						{#each filteredInvitations as invitation (invitation.id)}
							<div class="rounded-md border p-3">
								<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">{invitation.email}</p>
										<p class="mt-1 text-xs text-muted-foreground">
											{m.settings_invitation_details({
												role: roleLabel(invitation.role),
												date: formatDate(invitation.expires_at)
											})}
										</p>
										<p class="mt-1 text-xs text-muted-foreground">
											{m.settings_invitation_last_sent({
												date: formatDate(invitation.last_sent_at)
											})}
										</p>
										<p
											data-testid={`invitation-email-delivery-${invitation.id}`}
											class={[
												'mt-1 text-xs font-medium',
												invitationDelivery(invitation.email_delivery_status).needsAction
													? 'text-amber-700 dark:text-amber-300'
													: 'text-muted-foreground'
											]}
										>
											{invitationDelivery(invitation.email_delivery_status).label}
										</p>
										{#if invitationDelivery(invitation.email_delivery_status).needsAction}
											<p class="mt-1 text-xs text-muted-foreground">
												{m.settings_invitation_delivery_action()}
											</p>
										{/if}
									</div>
									<span
										class="inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium"
									>
										{invitation.status === 'expired'
											? m.settings_invitation_status_expired()
											: m.settings_invitation_status_pending()}
									</span>
								</div>
								{#if canManage}
									<div class="mt-3 flex flex-wrap justify-end gap-1 border-t pt-3">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={Boolean(busyKey)}
											onclick={() => void resendInvitation(invitation)}
										>
											{#if busyKey === `invitation:${invitation.id}`}<LoaderIcon
													class="size-4 animate-spin"
												/>{:else}<RefreshCwIcon class="size-4" />{/if}
											{m.settings_invitation_resend()}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											class="text-destructive hover:text-destructive"
											disabled={Boolean(busyKey)}
											onclick={() => requestDestructiveAction({ kind: 'revoke', invitation })}
										>
											{m.settings_revoke()}
										</Button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if canManage}
		<div class="mt-6 border-t pt-5">
			<div class="mb-3 flex items-start gap-3">
				<div class="rounded-md border bg-muted/30 p-2"><HistoryIcon class="size-4" /></div>
				<div>
					<h3 class="text-sm font-semibold">{m.settings_access_history()}</h3>
					<p class="text-sm text-muted-foreground">{m.settings_access_history_body()}</p>
				</div>
			</div>
			{#if auditLoading}
				<PageLoading layout="list" label={m.common_loading()} items={3} />
			{:else if auditEvents.length === 0}
				<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
					{m.settings_access_history_empty()}
				</p>
			{:else}
				<ol class="space-y-2">
					{#each auditEvents as event (event.id)}
						<li
							class="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
						>
							<span>{auditDescription(event)}</span><time
								class="shrink-0 text-xs text-muted-foreground"
								datetime={event.created_at}>{formatDate(event.created_at)}</time
							>
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
{/if}

<DestructiveConfirmDialog
	bind:open={destructiveOpen}
	title={destructiveTitle()}
	description={destructiveBody()}
	confirmLabel={destructiveAction?.kind === 'deactivate'
		? m.settings_member_deactivate()
		: destructiveAction?.kind === 'remove'
			? m.settings_member_remove()
			: m.settings_revoke()}
	onConfirm={confirmDestructiveAction}
/>
