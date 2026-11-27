<script lang="ts">
	import { get } from 'svelte/store';
	import ReauthDeleteDialog from '$lib/components/reauth-delete-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { client, type AccountDeletionImpact } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		email: string;
		impact: AccountDeletionImpact;
		hasPassword: boolean;
		reauthProviderID?: string;
		hasPasskey?: boolean;
		onDeleted: () => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		email,
		impact,
		hasPassword,
		reauthProviderID = '',
		hasPasskey = false,
		onDeleted
	}: Props = $props();

	const blockers = $derived(impact.blockers ?? []);
	const ownershipTransfers = $derived(impact.ownership_transfers ?? []);
	const instanceAdminTransfer = $derived(impact.instance_admin_transfer);

	async function deleteAccount(payload: {
		confirmText: string;
		currentPassword: string;
		reauthGrant?: string;
	}): Promise<boolean | void> {
		const actorID = get(auth).user?.id ?? '';
		if (!actorID) return false;
		const isCurrentDialog = () => open && get(auth).user?.id === actorID;
		const { data, error: responseError } = await client.DELETE('/auth/account', {
			body: {
				confirm_email: payload.confirmText.trim(),
				current_password: payload.currentPassword,
				reauth_grant: payload.reauthGrant
			}
		});
		if (responseError || !data?.deleted) {
			if (isCurrentDialog()) {
				throw new Error(responseError?.detail ?? m.auth_login_failed());
			}
			return false;
		}
		if (get(auth).user?.id !== actorID) return false;
		if (!isCurrentDialog()) return false;
		// Navigate while the session is still recognized so the layout guard does not
		// redirect to /login before the destination page loads; local state is cleared
		// even if navigation fails because the server already deleted the account.
		try {
			await onDeleted();
		} finally {
			auth.clearLocal();
			localStorage.removeItem('oauth_workspace_id');
			localStorage.removeItem('oauth_mastodon_server');
			localStorage.removeItem('oauth_mastodon_instance_url');
		}
	}
</script>

<ReauthDeleteDialog
	bind:open
	entityID={email}
	title={m.settings_delete_dialog_title()}
	description={m.settings_delete_dialog_description()}
	confirmInputID="delete-confirm-email"
	confirmLabelFor={() => m.settings_delete_confirm_email()}
	confirmPlaceholder={m.settings_delete_confirm_email_placeholder({ email })}
	confirmMode="email"
	passwordInputID="delete-current-password"
	{hasPassword}
	reauthAction="account.delete"
	manageReauthCapabilities={false}
	{reauthProviderID}
	{hasPasskey}
	fallbackBlockers={blockers.map((blocker) => ({
		key: blocker.code + (blocker.organization_id ?? ''),
		message: blocker.message
	}))}
	fallbackExpectedConfirm={email}
	blockerTitle={m.settings_delete_blockers()}
	confirmButtonLabel={m.settings_delete_submit()}
	pendingButtonLabel={m.settings_delete_deleting()}
	fallbackPreviewError={m.auth_login_failed()}
	fallbackDeleteError={m.auth_login_failed()}
	onDelete={deleteAccount}
>
	{#snippet preview()}
		<p class="rounded-md border bg-muted/30 p-3 text-sm leading-6">
			{m.settings_delete_impact({
				workspaces: impact.workspaces,
				accounts: impact.social_accounts,
				publications: impact.publications,
				media: impact.media
			})}
		</p>
	{/snippet}
	{#snippet afterBlockers()}
		{#if ownershipTransfers.length > 0}
			<InlineNotice tone="info">
				<p class="font-medium">{m.settings_delete_transfers()}</p>
				<ul class="mt-1 list-disc space-y-1 ps-5">
					{#each ownershipTransfers as transfer (transfer.organization_id)}
						<li>
							{m.settings_delete_transfer_item({
								organization: transfer.organization_name,
								email: transfer.successor_email
							})}
						</li>
					{/each}
				</ul>
			</InlineNotice>
		{/if}

		{#if instanceAdminTransfer}
			<InlineNotice
				tone="info"
				message={m.settings_delete_admin_transfer({
					email: instanceAdminTransfer.successor_email
				})}
			/>
		{/if}
	{/snippet}
</ReauthDeleteDialog>
