<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import DeleteAccountDialog from '$lib/components/delete-account-dialog.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { client, type AccountDeletionImpact } from '$lib/api/client';
	import { acquireReauthGrant } from '$lib/auth/reauth';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';

	interface Props {
		email: string;
		hasPassword: boolean;
		reauthProviderID?: string;
		hasPasskey?: boolean;
	}

	let { email, hasPassword, reauthProviderID = '', hasPasskey = false }: Props = $props();
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordBusy = $state(false);
	let exportPassword = $state('');
	const unsavedChanges = getOptionalUnsavedChanges();
	const dirty = $derived(
		Boolean(currentPassword || newPassword || confirmPassword || exportPassword)
	);

	$effect(() => {
		unsavedChanges?.set('account-data-settings', dirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('account-data-settings');
	});
	let exportBusy = $state(false);
	let deletionBusy = $state(false);
	let deletionOpen = $state(false);
	let deletionImpact = $state<AccountDeletionImpact | null>(null);
	let notice = $state('');
	let noticeTone = $state<'success' | 'error'>('success');
	let passwordOpen = $state(false);
	let exportOpen = $state(false);

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
		const grant = hasPassword
			? ''
			: await acquireReauthGrant('security.password.change', {
					providerID: reauthProviderID,
					hasPasskey
				}).catch((error: Error) => {
					showError(error.message);
					return undefined;
				});
		if (grant === null || grant === undefined) {
			passwordBusy = false;
			return;
		}
		const { data, error } = await client.POST('/auth/password', {
			body: {
				current_password: currentPassword,
				new_password: newPassword,
				reauth_grant: grant || undefined
			}
		});
		passwordBusy = false;
		if (error || !data) {
			showError(error?.detail ?? m.auth_login_failed());
			return;
		}
		currentPassword = '';
		newPassword = '';
		confirmPassword = '';
		passwordOpen = false;
		showSuccess(m.settings_change_password_success({ count: data.revoked_sessions }));
	}

	async function exportData(event: SubmitEvent) {
		event.preventDefault();
		notice = '';
		exportBusy = true;
		const grant = hasPassword
			? ''
			: await acquireReauthGrant('account.export', {
					providerID: reauthProviderID,
					hasPasskey
				}).catch((error: Error) => {
					showError(error.message);
					return undefined;
				});
		if (grant === null || grant === undefined) {
			exportBusy = false;
			return;
		}
		const { data, error } = await client.POST('/auth/account/export', {
			body: {
				current_password: exportPassword,
				reauth_grant: grant || undefined
			}
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
		exportOpen = false;
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

<section class="overflow-hidden rounded-lg border">
	<div class="p-4">
		<h3 class="font-medium">{m.settings_account_data()}</h3>
		<p class="mt-1 text-sm text-muted-foreground">{m.settings_account_data_body()}</p>
	</div>

	{#if notice}
		<div class="px-4 pb-4">
			<InlineNotice tone={noticeTone} message={notice} />
		</div>
	{/if}

	<div class="divide-y border-t">
		<Collapsible.Root bind:open={passwordOpen}>
			<Collapsible.Trigger
				class="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
			>
				<KeyRoundIcon class="size-4 shrink-0 text-muted-foreground" />
				<span class="min-w-0 flex-1">
					<span class="block text-sm font-medium">
						{hasPassword ? m.settings_change_password() : m.settings_set_password()}
					</span>
					<span class="mt-0.5 block text-xs leading-5 text-muted-foreground">
						{m.settings_change_password_body()}
					</span>
				</span>
				<ChevronDownIcon
					class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
				/>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<form
					onsubmit={changePassword}
					class="grid gap-3 border-t bg-muted/10 p-4 sm:grid-cols-2 xl:grid-cols-3"
				>
					{#if hasPassword}
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
					{:else}
						<p class="self-end text-sm text-muted-foreground">{m.settings_step_up_body()}</p>
					{/if}
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
					<div class="sm:col-span-2 xl:col-span-3">
						<Button type="submit" disabled={passwordBusy}>
							{#if passwordBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
							{passwordBusy
								? m.settings_change_password_loading()
								: m.settings_change_password_submit()}
						</Button>
					</div>
				</form>
			</Collapsible.Content>
		</Collapsible.Root>

		<Collapsible.Root bind:open={exportOpen}>
			<Collapsible.Trigger
				class="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
			>
				<DownloadIcon class="size-4 shrink-0 text-muted-foreground" />
				<span class="min-w-0 flex-1">
					<span class="block text-sm font-medium">{m.settings_export_data()}</span>
					<span class="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
						{m.settings_export_data_body()}
					</span>
				</span>
				<ChevronDownIcon
					class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
				/>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<form
					onsubmit={exportData}
					class="grid gap-3 border-t bg-muted/10 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
				>
					{#if hasPassword}
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
					{:else}
						<p class="self-end text-sm text-muted-foreground">{m.settings_step_up_body()}</p>
					{/if}
					<Button type="submit" variant="outline" disabled={exportBusy}>
						{#if exportBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
						{exportBusy ? m.settings_export_loading() : m.settings_export_submit()}
					</Button>
				</form>
			</Collapsible.Content>
		</Collapsible.Root>

		<div class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="min-w-0">
				<h4 class="flex items-center gap-2 text-sm font-medium text-destructive">
					<TrashIcon class="size-4" />
					{m.settings_delete_account()}
				</h4>
				<p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
					{m.settings_delete_account_body()}
				</p>
			</div>
			<Button
				type="button"
				variant="destructive"
				class="shrink-0"
				disabled={deletionBusy}
				onclick={reviewDeletion}
			>
				{#if deletionBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
				{deletionBusy ? m.settings_delete_loading() : m.settings_delete_review()}
			</Button>
		</div>
	</div>
</section>

{#if deletionImpact}
	<DeleteAccountDialog
		bind:open={deletionOpen}
		{email}
		impact={deletionImpact}
		{hasPassword}
		{reauthProviderID}
		{hasPasskey}
		onDeleted={deleted}
	/>
{/if}
