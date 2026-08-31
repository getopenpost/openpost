<script lang="ts">
	import { onMount } from 'svelte';
	import { client, type SocialAccount } from '$lib/api/client';
	import {
		invalidateWorkspaceSocialSets,
		loadWorkspaceSocialSets
	} from '$lib/api/performance-cache';
	import type { components } from '$lib/api/types';
	import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import InlineNotice from './inline-notice.svelte';
	import SocialAccountAvatar from './social-account-avatar.svelte';
	import SocialAccountIdentity from './social-account-identity.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';

	type SocialSet = components['schemas']['SocialSetResponse'];
	type SocialSetAccountInput = components['schemas']['SocialSetAccountInput'];

	interface Props {
		workspaceId: string;
		accounts: SocialAccount[];
		selectedAccountIds?: string[];
		customAccountIds?: string[];
		accountIssues?: Record<string, string[]>;
		selectedSetId?: string;
		disabled?: boolean;
		autoApplyDefault?: boolean;
		onApply: (set: SocialSet | null) => void;
		onToggle?: (account: SocialAccount) => void;
		onSelectAll?: () => void;
		onClearAll?: () => void;
	}

	let {
		workspaceId,
		accounts,
		selectedAccountIds = [],
		customAccountIds = [],
		accountIssues = {},
		selectedSetId = $bindable(''),
		disabled = false,
		autoApplyDefault = false,
		onApply,
		onToggle,
		onSelectAll,
		onClearAll
	}: Props = $props();

	let sets = $state<SocialSet[]>([]);
	let loading = $state(false);
	let error = $state('');
	let manageOpen = $state(false);
	let editorId = $state('');
	let editorName = $state('');
	let editorDefault = $state(false);
	let editorAccountIds = $state<string[]>([]);
	let saving = $state(false);
	let deleting = $state(false);
	let deleteOpen = $state(false);
	let loadedWorkspaceId = '';
	let pickerOpen = $state(false);
	let pendingCustomAccount = $state<SocialAccount | null>(null);
	let customAccountConfirmOpen = $state(false);

	const selectedAccounts = $derived(
		selectedAccountIds
			.map((id) => accounts.find((account) => account.id === id))
			.filter((account): account is SocialAccount => Boolean(account))
	);
	const selectedSet = $derived(sets.find((set) => set.id === selectedSetId) ?? null);
	const destinationLabel = $derived(
		selectedSet?.name ||
			(selectedAccountIds.length > 0 ? m.social_set_custom_selection() : m.social_set_select())
	);
	const destinationAccessibleValue = $derived.by(() => {
		if (selectedSet) return selectedSet.name;
		if (selectedAccounts.length === 0) return m.social_set_select();
		return selectedAccounts
			.map((account) => `${accountLabel(account)}, ${getPlatformName(account.platform)}`)
			.join('; ');
	});

	onMount(() => {
		if (workspaceId) void loadSets();
	});

	$effect(() => {
		if (workspaceId && workspaceId !== loadedWorkspaceId) void loadSets();
	});

	async function loadSets(force = false) {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace) return;
		loadedWorkspaceId = requestedWorkspace;
		loading = true;
		error = '';
		try {
			sets = await loadWorkspaceSocialSets(requestedWorkspace, force);
		} catch (cause) {
			if (workspaceId !== requestedWorkspace) return;
			error = cause instanceof Error && cause.message ? cause.message : m.social_set_load_failed();
			return;
		} finally {
			if (workspaceId === requestedWorkspace) loading = false;
		}
		if (workspaceId !== requestedWorkspace) return;
		if (selectedSetId) {
			// The publication already owns a destination snapshot. Loading the
			// reusable set must never replace that snapshot with current membership.
			return;
		}
		if (autoApplyDefault) {
			const defaultSet = sets.find((set) => set.is_default) ?? null;
			if (defaultSet) {
				selectedSetId = defaultSet.id;
				onApply(defaultSet);
			}
		}
	}

	function selectSet(id: string) {
		selectedSetId = id;
		onApply(sets.find((set) => set.id === id) ?? null);
		pickerOpen = false;
	}

	function startNewSet() {
		editorId = '';
		editorName = '';
		editorDefault = sets.length === 0;
		editorAccountIds = accounts.map((account) => account.id);
	}

	function startEditing(set: SocialSet) {
		editorId = set.id;
		editorName = set.name;
		editorDefault = set.is_default;
		editorAccountIds = (set.accounts ?? []).map((account) => account.social_account_id);
	}

	function toggleEditorAccount(accountId: string) {
		editorAccountIds = editorAccountIds.includes(accountId)
			? editorAccountIds.filter((id) => id !== accountId)
			: [...editorAccountIds, accountId];
	}

	function editorAccounts(): SocialSetAccountInput[] {
		return editorAccountIds.map((accountId) => ({ social_account_id: accountId }));
	}

	async function saveSet() {
		if (!editorName.trim() || saving) return;
		const creating = !editorId;
		saving = true;
		error = '';
		try {
			if (editorId) {
				const { error: saveError } = await client.PUT('/social-sets/{id}', {
					params: { path: { id: editorId } },
					body: {
						name: editorName.trim(),
						is_default: editorDefault,
						accounts: editorAccounts()
					}
				});
				if (saveError) throw new Error(saveError.detail || m.social_set_save_failed());
			} else {
				const { data, error: saveError } = await client.POST('/social-sets', {
					body: {
						workspace_id: workspaceId,
						name: editorName.trim(),
						is_default: editorDefault,
						accounts: editorAccounts()
					}
				});
				if (saveError) throw new Error(saveError.detail || m.social_set_save_failed());
				editorId = data.id;
				selectedSetId = data.id;
			}
			invalidateWorkspaceSocialSets(workspaceId);
			await loadSets(true);
			const saved = sets.find((set) => set.id === editorId) ?? null;
			if (creating && saved) onApply(saved);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.social_set_save_failed();
		} finally {
			saving = false;
		}
	}

	async function deleteSet(): Promise<DestructiveActionOutcome> {
		if (!editorId || deleting) return { ok: false };
		deleting = true;
		error = '';
		try {
			const { error: deleteError } = await client.DELETE('/social-sets/{id}', {
				params: { path: { id: editorId }, query: { confirm: true } }
			});
			if (deleteError) throw new Error(deleteError.detail || m.social_set_delete_failed());
			if (selectedSetId === editorId) {
				selectedSetId = '';
				onApply(null);
			}
			deleteOpen = false;
			startNewSet();
			invalidateWorkspaceSocialSets(workspaceId);
			await loadSets(true);
			return { ok: true };
		} catch (cause) {
			return {
				ok: false,
				message: cause instanceof Error ? cause.message : m.social_set_delete_failed()
			};
		} finally {
			deleting = false;
		}
	}

	function accountLabel(account: SocialAccount) {
		return (
			formatSocialAccountName(account.account_username, account.platform) ||
			account.slug ||
			account.account_id ||
			getPlatformName(account.platform)
		);
	}

	function handleManageOpenChange(next: boolean) {
		manageOpen = next;
		if (!next) return;
		if (selectedSetId) {
			const selected = sets.find((set) => set.id === selectedSetId);
			if (selected) {
				startEditing(selected);
				return;
			}
		}
		startNewSet();
	}

	function requestAccountToggle(account: SocialAccount) {
		if (selectedAccountIds.includes(account.id) && customAccountIds.includes(account.id)) {
			pendingCustomAccount = account;
			pickerOpen = false;
			customAccountConfirmOpen = true;
			return;
		}
		onToggle?.(account);
	}

	function confirmCustomAccountRemoval(): DestructiveActionOutcome {
		if (!pendingCustomAccount) return { ok: false };
		onToggle?.(pendingCustomAccount);
		pendingCustomAccount = null;
		return { ok: true };
	}
</script>

<div class="min-w-0" data-testid="social-set-control">
	<Popover.Root bind:open={pickerOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="outline"
					size="sm"
					class="h-11 max-w-[min(22rem,70vw)] gap-2 px-2.5 md:h-9"
					aria-label={`${m.compose_destinations()}: ${destinationAccessibleValue}`}
					disabled={disabled || loading}
					data-testid="composer-account-control"
				>
					<span class="isolate flex shrink-0 items-center -space-x-1" aria-hidden="true">
						{#each selectedAccounts.slice(0, 3) as account (account.id)}
							<SocialAccountAvatar
								name={accountLabel(account)}
								platform={account.platform}
								avatarUrl={account.account_avatar_url}
								size="sm"
								class="ring-1 ring-background"
								data-testid="composer-account-icon"
							/>
						{/each}
						{#if selectedAccounts.length > 3}
							<span class="z-10 ml-2 text-xs font-medium text-muted-foreground"
								>+{selectedAccounts.length - 3}</span
							>
						{/if}
					</span>
					<span class="min-w-0 truncate">{destinationLabel}</span>
					<ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-80 max-w-[calc(100vw-1rem)] p-1.5" align="start">
			<div class="flex min-h-11 items-center justify-between px-2">
				<div>
					<p class="text-sm font-medium">{m.compose_destinations()}</p>
					<p class="text-xs text-muted-foreground">{m.social_set_picker_body()}</p>
				</div>
				{#if onSelectAll && onClearAll}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="h-9 text-xs"
						onclick={selectedAccountIds.length === accounts.length ? onClearAll : onSelectAll}
					>
						{selectedAccountIds.length === accounts.length ? m.compose_clear() : m.common_all()}
					</Button>
				{/if}
			</div>

			{#if sets.length > 0}
				<div class="border-t py-1" role="group" aria-label={m.social_set_select()}>
					{#each sets as set (set.id)}
						<button
							type="button"
							class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"
							onclick={() => selectSet(set.id)}
						>
							<span class="min-w-0 flex-1 truncate">{set.name}</span>
							<span class="isolate flex shrink-0 items-center -space-x-1" aria-hidden="true">
								{#each (set.accounts ?? []).slice(0, 4) as membership (membership.social_account_id)}
									{@const account = accounts.find(
										(candidate) => candidate.id === membership.social_account_id
									)}
									{#if account}
										<SocialAccountAvatar
											name={accountLabel(account)}
											platform={account.platform}
											avatarUrl={account.account_avatar_url}
											size="sm"
											class="ring-1 ring-popover"
										/>
									{/if}
								{/each}
								{#if (set.accounts ?? []).length > 4}
									<span class="z-10 ml-2 text-xs font-medium text-muted-foreground"
										>+{(set.accounts ?? []).length - 4}</span
									>
								{/if}
							</span>
							{#if selectedSetId === set.id}<CheckIcon class="size-4" />{/if}
						</button>
					{/each}
				</div>
			{/if}

			<div class="border-t py-1" role="group" aria-label={m.social_set_accounts()}>
				{#each accounts as account (account.id)}
					{@const issues = accountIssues[account.id] ?? []}
					<label
						class="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
						data-testid="composer-account-row"
					>
						<div class="min-w-0 flex-1">
							<SocialAccountIdentity
								name={accountLabel(account)}
								platform={account.platform}
								avatarUrl={account.account_avatar_url}
								detail={issues.length ? m.compose_needs_attention() : ''}
							/>
							{#if issues.length}
								<ul class="mt-1 space-y-0.5 pl-10 text-xs leading-snug text-destructive">
									{#each issues as issue (issue)}
										<li>{issue}</li>
									{/each}
								</ul>
							{/if}
						</div>
						{#if customAccountIds.includes(account.id)}<PencilIcon
								class="size-3.5 text-primary"
								aria-label={m.compose_custom_state()}
							/>{/if}
						<Checkbox
							checked={selectedAccountIds.includes(account.id)}
							onCheckedChange={() => requestAccountToggle(account)}
						/>
					</label>
				{/each}
			</div>

			<button
				type="button"
				class="flex min-h-11 w-full items-center rounded-md border-t px-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				onclick={() => {
					pickerOpen = false;
					handleManageOpenChange(true);
				}}
			>
				{m.social_set_manage()}
			</button>
		</Popover.Content>
	</Popover.Root>

	<Dialog.Root bind:open={manageOpen} onOpenChange={handleManageOpenChange}>
		<Dialog.Content class="max-h-[min(44rem,90dvh)] overflow-y-auto sm:max-w-2xl">
			<Dialog.Header>
				<Dialog.Title>{m.social_set_manage()}</Dialog.Title>
				<Dialog.Description>{m.social_set_description()}</Dialog.Description>
			</Dialog.Header>

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			<div class="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
				<nav class="space-y-1" aria-label={m.social_set_manage()}>
					{#each sets as set (set.id)}
						<Button
							type="button"
							variant={editorId === set.id ? 'secondary' : 'ghost'}
							class="h-auto min-h-11 w-full justify-start px-3 py-2 text-left"
							onclick={() => startEditing(set)}
						>
							<span class="min-w-0 truncate">{set.name}</span>
							{#if set.is_default}
								<span class="ml-auto text-xs text-muted-foreground">{m.social_set_default()}</span>
							{/if}
						</Button>
					{/each}
					<Button type="button" variant="outline" class="mt-2 h-11 w-full" onclick={startNewSet}>
						{m.social_set_new()}
					</Button>
				</nav>

				<div class="min-w-0 space-y-5">
					<div class="space-y-2">
						<Label for="social-set-name">{m.social_set_name()}</Label>
						<Input id="social-set-name" bind:value={editorName} maxlength={80} />
					</div>
					<label class="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm">
						<Checkbox bind:checked={editorDefault} />
						<span>{m.social_set_use_default()}</span>
					</label>

					<fieldset class="space-y-2">
						<legend class="text-sm font-medium">{m.social_set_accounts()}</legend>
						{#each accounts as account (account.id)}
							<div class="rounded-md border px-3 py-2.5">
								<label class="flex min-h-11 items-center gap-3 text-sm">
									<Checkbox
										checked={editorAccountIds.includes(account.id)}
										onCheckedChange={() => toggleEditorAccount(account.id)}
									/>
									<SocialAccountIdentity
										class="min-w-0 flex-1"
										name={accountLabel(account)}
										platform={account.platform}
										avatarUrl={account.account_avatar_url}
									/>
								</label>
							</div>
						{/each}
					</fieldset>
				</div>
			</div>

			<Dialog.Footer class="gap-2 sm:justify-between">
				<div>
					{#if editorId}
						<Button
							type="button"
							variant="ghost"
							class="h-11 gap-2 text-destructive"
							onclick={() => (deleteOpen = true)}
						>
							<Trash2Icon class="size-4" />
							{m.common_delete()}
						</Button>
					{/if}
				</div>
				<Button
					type="button"
					class="h-11"
					disabled={!editorName.trim() || saving}
					onclick={saveSet}
				>
					{saving ? m.common_saving() : m.common_save()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>

<DestructiveConfirmDialog
	bind:open={customAccountConfirmOpen}
	title={m.compose_remove_custom_account_title({
		account: pendingCustomAccount ? accountLabel(pendingCustomAccount) : ''
	})}
	description={m.compose_remove_custom_account_body()}
	confirmLabel={m.compose_remove_custom_account_confirm()}
	onConfirm={confirmCustomAccountRemoval}
/>

<DestructiveConfirmDialog
	bind:open={deleteOpen}
	title={m.social_set_delete_title()}
	description={m.social_set_delete_description()}
	confirmLabel={m.common_delete()}
	onConfirm={deleteSet}
/>
