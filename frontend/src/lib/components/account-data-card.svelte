<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import DeleteAccountDialog from '$lib/components/delete-account-dialog.svelte';
	import DownloadIcon from 'lucide-svelte/icons/download';
	import KeyRoundIcon from 'lucide-svelte/icons/key-round';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import TrashIcon from 'lucide-svelte/icons/trash';
	import { client, type AccountDeletionImpact } from '$lib/api/client';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		email: string;
	}

	let { email }: Props = $props();
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordBusy = $state(false);
	let exportPassword = $state('');
	let exportBusy = $state(false);
	let deletionBusy = $state(false);
	let deletionOpen = $state(false);
	let deletionImpact = $state<AccountDeletionImpact | null>(null);
	let notice = $state('');
	let noticeTone = $state<'success' | 'error'>('success');

	function showError(message: string) {
		noticeTone = 'error';
		notice = message;
	}

	function showSuccess(message: string) {
		noticeTone = 'success';
		notice = message;
	}

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		notice = '';
		if (newPassword.length < 12) {
			showError(m.auth_register_password_short());
			return;
		}
		if (newPassword !== confirmPassword) {
			showError(m.auth_register_password_mismatch());
			return;
		}

		passwordBusy = true;
		const { data, error } = await client.POST('/auth/password', {
			body: { current_password: currentPassword, new_password: newPassword }
		});
		passwordBusy = false;
		if (error || !data) {
			showError(error?.detail ?? m.auth_login_failed());
			return;
		}
		currentPassword = '';
		newPassword = '';
		confirmPassword = '';
		showSuccess(m.settings_change_password_success({ count: data.revoked_sessions }));
	}

	async function exportData(event: SubmitEvent) {
		event.preventDefault();
		notice = '';
		exportBusy = true;
		const { data, error } = await client.POST('/auth/account/export', {
			body: { current_password: exportPassword }
		});
		exportBusy = false;
		if (error || !data) {
			showError(error?.detail ?? m.auth_login_failed());
			return;
		}

		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `openpost-account-export-${data.generated_at.slice(0, 10)}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
		exportPassword = '';
		showSuccess(m.settings_export_success());
	}

	async function reviewDeletion() {
		notice = '';
		deletionBusy = true;
		const { data, error } = await client.GET('/auth/account/deletion-impact');
		deletionBusy = false;
		if (error || !data) {
			showError(error?.detail ?? m.auth_login_failed());
			return;
		}
		deletionImpact = data;
		deletionOpen = true;
	}

	async function deleted() {
		await goto(resolve('/account-deleted' as '/'));
		auth.clearLocal();
		workspaceCtx.reset();
		localStorage.removeItem('oauth_workspace_id');
		localStorage.removeItem('oauth_mastodon_server');
		localStorage.removeItem('oauth_mastodon_instance_url');
	}
</script>

<div class="rounded-lg border p-4">
	<div class="mb-4">
		<h3 class="font-medium">{m.settings_account_data()}</h3>
		<p class="mt-1 text-sm text-muted-foreground">{m.settings_account_data_body()}</p>
	</div>

	{#if notice}
		<InlineNotice tone={noticeTone} message={notice} class="mb-4" />
	{/if}

	<div class="grid gap-4 xl:grid-cols-3">
		<form onsubmit={changePassword} class="space-y-3 rounded-md border p-3">
			<div>
				<h4 class="flex items-center gap-2 text-sm font-medium">
					<KeyRoundIcon class="size-4 text-muted-foreground" />
					{m.settings_change_password()}
				</h4>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">
					{m.settings_change_password_body()}
				</p>
			</div>
			<div class="space-y-2">
				<Label for="account-current-password">{m.settings_current_password()}</Label>
				<Input
					id="account-current-password"
					type="password"
					bind:value={currentPassword}
					autocomplete="current-password"
					required
				/>
			</div>
			<div class="space-y-2">
				<Label for="account-new-password">{m.settings_new_password()}</Label>
				<Input
					id="account-new-password"
					type="password"
					bind:value={newPassword}
					autocomplete="new-password"
					minlength={12}
					required
				/>
			</div>
			<div class="space-y-2">
				<Label for="account-confirm-password">{m.settings_confirm_new_password()}</Label>
				<Input
					id="account-confirm-password"
					type="password"
					bind:value={confirmPassword}
					autocomplete="new-password"
					minlength={12}
					required
				/>
			</div>
			<Button type="submit" class="w-full gap-2" disabled={passwordBusy}>
				{#if passwordBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
				{passwordBusy ? m.settings_change_password_loading() : m.settings_change_password_submit()}
			</Button>
		</form>

		<form onsubmit={exportData} class="space-y-3 rounded-md border p-3">
			<div>
				<h4 class="flex items-center gap-2 text-sm font-medium">
					<DownloadIcon class="size-4 text-muted-foreground" />
					{m.settings_export_data()}
				</h4>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">
					{m.settings_export_data_body()}
				</p>
			</div>
			<div class="space-y-2">
				<Label for="export-password">{m.settings_export_password()}</Label>
				<Input
					id="export-password"
					type="password"
					bind:value={exportPassword}
					autocomplete="current-password"
					required
				/>
			</div>
			<Button type="submit" variant="outline" class="w-full gap-2" disabled={exportBusy}>
				{#if exportBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
				{exportBusy ? m.settings_export_loading() : m.settings_export_submit()}
			</Button>
		</form>

		<div class="space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
			<div>
				<h4 class="flex items-center gap-2 text-sm font-medium text-destructive">
					<TrashIcon class="size-4" />
					{m.settings_delete_account()}
				</h4>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">
					{m.settings_delete_account_body()}
				</p>
			</div>
			<Button
				type="button"
				variant="destructive"
				class="w-full gap-2"
				disabled={deletionBusy}
				onclick={reviewDeletion}
			>
				{#if deletionBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
				{deletionBusy ? m.settings_delete_loading() : m.settings_delete_review()}
			</Button>
		</div>
	</div>
</div>

{#if deletionImpact}
	<DeleteAccountDialog
		bind:open={deletionOpen}
		{email}
		impact={deletionImpact}
		onDeleted={deleted}
	/>
{/if}
