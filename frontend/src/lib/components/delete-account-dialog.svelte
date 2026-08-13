<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { client, type AccountDeletionImpact } from '$lib/api/client';
	import { acquireReauthGrant } from '$lib/auth/reauth';
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
	let confirmEmail = $state('');
	let currentPassword = $state('');
	let error = $state('');
	let pending = $state(false);

	const blockers = $derived(impact.blockers ?? []);
	const ownershipTransfers = $derived(impact.ownership_transfers ?? []);
	const instanceAdminTransfer = $derived(impact.instance_admin_transfer);
	const canDelete = $derived(
		!pending &&
			blockers.length === 0 &&
			confirmEmail.trim().toLowerCase() === email.trim().toLowerCase() &&
			(hasPassword ? currentPassword.length > 0 : Boolean(reauthProviderID || hasPasskey))
	);

	function close() {
		if (pending) return;
		open = false;
		error = '';
		confirmEmail = '';
		currentPassword = '';
	}

	async function deleteAccount() {
		if (!canDelete) return;
		pending = true;
		error = '';
		const grant = hasPassword
			? ''
			: await acquireReauthGrant('account.delete', {
					providerID: reauthProviderID,
					hasPasskey
				}).catch((cause: Error) => {
					error = cause.message;
					return undefined;
				});
		if (grant === null || grant === undefined) {
			pending = false;
			return;
		}
		const { data, error: responseError } = await client.DELETE('/auth/account', {
			body: {
				confirm_email: confirmEmail.trim(),
				current_password: currentPassword,
				reauth_grant: grant || undefined
			}
		});
		if (responseError || !data?.deleted) {
			error = responseError?.detail ?? m.auth_login_failed();
			pending = false;
			return;
		}
		await onDeleted();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content aria-busy={pending} showCloseButton={false} class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.settings_delete_dialog_title()}</Dialog.Title>
			<Dialog.Description>{m.settings_delete_dialog_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<p class="rounded-md border bg-muted/30 p-3 text-sm leading-6">
				{m.settings_delete_impact({
					workspaces: impact.workspaces,
					accounts: impact.social_accounts,
					posts: impact.posts,
					publications: impact.publications,
					media: impact.media
				})}
			</p>

			{#if blockers.length > 0}
				<InlineNotice tone="warning">
					<p class="font-medium">{m.settings_delete_blockers()}</p>
					<ul class="mt-1 list-disc space-y-1 pl-5">
						{#each blockers as blocker (blocker.code + (blocker.organization_id ?? ''))}
							<li>{blocker.message}</li>
						{/each}
					</ul>
				</InlineNotice>
			{/if}

			{#if ownershipTransfers.length > 0}
				<InlineNotice tone="info">
					<p class="font-medium">{m.settings_delete_transfers()}</p>
					<ul class="mt-1 list-disc space-y-1 pl-5">
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

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			<div class="space-y-2">
				<Label for="delete-confirm-email">{m.settings_delete_confirm_email()}</Label>
				<Input
					id="delete-confirm-email"
					type="email"
					bind:value={confirmEmail}
					autocomplete="off"
					placeholder={m.settings_delete_confirm_email_placeholder({ email })}
					disabled={pending || blockers.length > 0}
				/>
			</div>

			{#if hasPassword}
				<div class="space-y-2">
					<Label for="delete-current-password">{m.settings_delete_password()}</Label>
					<Input
						id="delete-current-password"
						type="password"
						bind:value={currentPassword}
						autocomplete="current-password"
						disabled={pending || blockers.length > 0}
					/>
				</div>
			{:else}
				<InlineNotice tone="info" message={m.settings_step_up_body()} />
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" class="w-full sm:w-auto" disabled={pending} onclick={close}>
				{m.common_cancel()}
			</Button>
			<Button
				variant="destructive"
				class="w-full gap-2 sm:w-auto"
				disabled={!canDelete}
				onclick={deleteAccount}
			>
				{#if pending}<LoaderIcon class="size-4 animate-spin" />{/if}
				{pending ? m.settings_delete_deleting() : m.settings_delete_submit()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
