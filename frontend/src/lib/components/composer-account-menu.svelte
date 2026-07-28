<script lang="ts">
	import { tick } from 'svelte';
	import type { SocialAccount } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Popover from '$lib/components/ui/popover';
	import { cn, getPlatformKey, getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import ChevronDownIcon from 'lucide-svelte/icons/chevron-down';
	import EllipsisIcon from 'lucide-svelte/icons/ellipsis';
	import Link2Icon from 'lucide-svelte/icons/link-2';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import RotateCcwIcon from 'lucide-svelte/icons/rotate-ccw';
	import Settings2Icon from 'lucide-svelte/icons/settings-2';
	import TriangleAlertIcon from 'lucide-svelte/icons/triangle-alert';
	import RiCheckLine from 'remixicon-svelte/icons/check-line';
	import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
	import PlatformIcon from './platform-icon.svelte';

	type PendingCustomChange = {
		account: SocialAccount;
		action: 'deselect' | 'reset';
	};

	interface Props {
		accounts: SocialAccount[];
		selectedAccountIds: string[];
		compatibleAccountIds?: string[];
		customAccountIds?: string[];
		settingsAccountIds?: string[];
		accountSummaries?: Record<string, string>;
		accountIssues?: Record<string, string[]>;
		warningAccountIds?: string[];
		activeAccountId?: string | null;
		triggerLabel?: string;
		triggerClass?: string;
		triggerVariant?: 'ghost' | 'outline';
		description?: string;
		onToggle: (account: SocialAccount) => void;
		onSelectAll: () => void;
		onClearAll: () => void;
		onEditShared?: () => void;
		onCustomize?: (account: SocialAccount) => void;
		onReset?: (account: SocialAccount) => void;
		onSettings?: (account: SocialAccount) => void;
	}

	let {
		accounts,
		selectedAccountIds,
		compatibleAccountIds,
		customAccountIds = [],
		settingsAccountIds = [],
		accountSummaries = {},
		accountIssues = {},
		warningAccountIds = [],
		activeAccountId = null,
		triggerLabel = m.compose_target_accounts(),
		triggerClass = '',
		triggerVariant = 'ghost',
		description = '',
		onToggle,
		onSelectAll,
		onClearAll,
		onEditShared,
		onCustomize,
		onReset,
		onSettings
	}: Props = $props();

	let open = $state(false);
	let confirmOpen = $state(false);
	let pendingCustomChange = $state<PendingCustomChange | null>(null);
	const compatibleIds = $derived(
		new Set(compatibleAccountIds ?? accounts.map((account) => account.id))
	);
	const customIds = $derived(new Set(customAccountIds));
	const settingsIds = $derived(new Set(settingsAccountIds));
	const warningIds = $derived(new Set(warningAccountIds));
	const activeAccountIsCustom = $derived(
		activeAccountId !== null && customIds.has(activeAccountId)
	);
	const selectedAccounts = $derived(
		accounts.filter((account) => selectedAccountIds.includes(account.id))
	);
	const visibleAccounts = $derived(selectedAccounts.slice(0, 3));
	const hiddenAccountCount = $derived(
		Math.max(0, selectedAccounts.length - visibleAccounts.length)
	);
	const selectedSummary = $derived.by(() => {
		if (selectedAccounts.length === 0) return m.compose_no_accounts();
		if (selectedAccounts.length === compatibleIds.size) return m.compose_all_accounts();
		return m.compose_account_count({ count: selectedAccounts.length });
	});

	function accountLabel(account: SocialAccount): string {
		const username = account.account_username?.replace(/^@/, '');
		return `${getPlatformName(account.platform)}${username ? ` @${username}` : ''}`;
	}

	function accountUsername(account: SocialAccount): string {
		const username = account.account_username?.replace(/^@/, '');
		return username ? `@${username}` : '';
	}

	function editShared() {
		onEditShared?.();
		open = false;
	}

	function customize(account: SocialAccount) {
		onCustomize?.(account);
		open = false;
	}

	async function editSettings(account: SocialAccount) {
		open = false;
		await tick();
		onSettings?.(account);
	}

	function requestCustomChange(account: SocialAccount, action: PendingCustomChange['action']) {
		pendingCustomChange = { account, action };
		open = false;
		confirmOpen = true;
	}

	function protectCustomDeselect(event: MouseEvent, account: SocialAccount) {
		if (selectedAccountIds.includes(account.id) && customIds.has(account.id)) {
			event.preventDefault();
			requestCustomChange(account, 'deselect');
		}
	}

	async function confirmCustomChange() {
		const pending = pendingCustomChange;
		if (!pending) return;

		if (pending.action === 'reset') {
			await onReset?.(pending.account);
		} else {
			await onToggle(pending.account);
		}
		pendingCustomChange = null;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant={triggerVariant}
				size="sm"
				class={cn('h-11 shrink-0 gap-2 px-2.5 text-xs text-muted-foreground sm:h-9', triggerClass)}
				aria-label={`${triggerLabel}: ${selectedSummary}${activeAccountIsCustom ? `; ${m.compose_custom_state()}` : ''}`}
				data-testid="composer-account-control"
			>
				{#if selectedAccounts.length > 0}
					<span class="flex items-center gap-1.5" aria-hidden="true">
						{#each visibleAccounts as account (account.id)}
							<span
								class="flex size-4 items-center justify-center text-foreground"
								data-testid="composer-account-icon"
							>
								<PlatformIcon platform={getPlatformKey(account.platform)} class="size-4" />
							</span>
						{/each}
						{#if hiddenAccountCount > 0}
							<span
								class="font-mono text-xs font-medium text-muted-foreground tabular-nums"
								aria-hidden="true"
							>
								+{hiddenAccountCount}
							</span>
						{/if}
					</span>
				{:else}
					<span>{m.common_none()}</span>
				{/if}
				{#if activeAccountIsCustom}
					<span
						class="flex size-5 items-center justify-center rounded-sm bg-primary/10 text-primary"
						title={m.compose_custom_state()}
						data-testid="composer-active-custom-indicator"
					>
						<PencilIcon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">{m.compose_custom_state()}</span>
					</span>
				{/if}
				<ChevronDownIcon class="size-3.5" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>

	<Popover.Content class="w-76 max-w-[calc(100vw-1rem)] p-1.5" align="start">
		<div class="flex min-h-11 items-center justify-between gap-3 px-2">
			<div class="min-w-0">
				<p class="text-sm font-medium">{m.compose_publish_to()}</p>
				{#if description}
					<p class="truncate text-xs leading-4 text-muted-foreground">{description}</p>
				{/if}
			</div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="h-11 shrink-0 px-2 text-xs text-muted-foreground sm:h-8"
				onclick={selectedAccounts.length === compatibleIds.size ? onClearAll : onSelectAll}
			>
				{selectedAccounts.length === compatibleIds.size ? m.compose_clear() : m.common_all()}
			</Button>
		</div>

		<div class="border-t pt-1" role="group" aria-label={m.compose_publish_to()}>
			{#each accounts as account (account.id)}
				{@const compatible = compatibleIds.has(account.id)}
				{@const selected = selectedAccountIds.includes(account.id)}
				{@const custom = customIds.has(account.id)}
				<div
					class={cn(
						'group flex min-h-12 items-center rounded-md transition-colors hover:bg-accent/70',
						activeAccountId === account.id && 'bg-accent/70'
					)}
					data-testid="composer-account-row"
				>
					<label
						for={`composer-account-${account.id}`}
						class={cn(
							'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring',
							!compatible && !selected && 'cursor-not-allowed opacity-45'
						)}
						data-testid="composer-account-toggle"
					>
						<span
							class="flex size-5 items-center justify-center text-foreground"
							aria-hidden="true"
						>
							<PlatformIcon platform={getPlatformKey(account.platform)} class="size-5" />
						</span>
						<span class="min-w-0 flex-1 leading-tight">
							<span class="flex min-w-0 items-center gap-2">
								<span class="truncate font-medium">{getPlatformName(account.platform)}</span>
								{#if warningIds.has(account.id)}
									<TriangleAlertIcon
										class="size-3.5 shrink-0 text-amber-600 dark:text-amber-300"
										aria-label={m.compose_check_before_publishing()}
									/>
								{/if}
								{#if custom}
									<span
										class="flex size-4 shrink-0 items-center justify-center text-primary"
										title={m.compose_custom_state()}
										data-testid="composer-account-custom-indicator"
									>
										<PencilIcon class="size-3" aria-hidden="true" />
										<span class="sr-only">{m.compose_custom_state()}</span>
									</span>
								{/if}
							</span>
							<span class="flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
								{#if accountUsername(account)}
									<span class="truncate">{accountUsername(account)}</span>
									<span aria-hidden="true">·</span>
								{/if}
								<span class="truncate"
									>{accountSummaries[account.id] ?? getPlatformName(account.platform)}</span
								>
							</span>
							{#if selected && accountIssues[account.id]?.length > 0}
								<ul class="mt-1 space-y-0.5 text-xs leading-4 text-amber-700 dark:text-amber-300">
									{#each accountIssues[account.id] as issue (issue)}
										<li class="flex gap-1.5">
											<span aria-hidden="true">•</span>
											<span>{issue}</span>
										</li>
									{/each}
								</ul>
							{/if}
						</span>
						<Checkbox
							id={`composer-account-${account.id}`}
							checked={selected}
							disabled={!compatible && !selected}
							onclick={(event) => protectCustomDeselect(event, account)}
							onCheckedChange={() => onToggle(account)}
						/>
					</label>

					{#if selected && onSettings && settingsIds.has(account.id)}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-11 shrink-0 text-muted-foreground"
							aria-label={`${m.compose_platform_settings()}: ${accountLabel(account)}`}
							data-testid="composer-account-settings"
							onclick={() => editSettings(account)}
						>
							<Settings2Icon class="size-4" />
						</Button>
					{/if}

					{#if compatible && selected && onCustomize}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										type="button"
										variant="ghost"
										size="icon"
										class="size-11 shrink-0 text-muted-foreground"
										aria-label={`${m.sidebar_more()}: ${accountLabel(account)}`}
										data-testid="composer-account-actions"
									>
										<EllipsisIcon class="size-4" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-52" align="end">
								<DropdownMenu.Item
									class="min-h-11"
									onclick={() => customize(account)}
									data-testid="composer-account-customize"
								>
									<PencilIcon class="size-4" />
									{custom
										? m.compose_edit_account_version({ account: accountLabel(account) })
										: m.compose_unsync()}
								</DropdownMenu.Item>
								{#if custom && onReset}
									<DropdownMenu.Item
										class="min-h-11"
										onclick={() => requestCustomChange(account, 'reset')}
										data-testid="composer-account-reset"
									>
										<RotateCcwIcon class="size-4" />
										{m.compose_sync_back()}
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			{/each}
		</div>

		{#if onEditShared}
			<div class="mt-1 border-t pt-1">
				<button
					type="button"
					class={cn(
						'flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
						activeAccountId === null && 'bg-accent/70 text-foreground'
					)}
					onclick={editShared}
					aria-pressed={activeAccountId === null}
					data-testid="composer-shared-content"
				>
					<Link2Icon class="size-4" aria-hidden="true" />
					<span class="flex-1">{m.compose_shared_content()}</span>
					{#if activeAccountId === null}<RiCheckLine class="size-4" aria-hidden="true" />{/if}
				</button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>

<DestructiveConfirmDialog
	bind:open={confirmOpen}
	title={pendingCustomChange?.action === 'deselect'
		? m.compose_remove_custom_account_title({
				account: pendingCustomChange ? accountLabel(pendingCustomChange.account) : ''
			})
		: m.compose_reset_custom_title({
				account: pendingCustomChange ? accountLabel(pendingCustomChange.account) : ''
			})}
	description={pendingCustomChange?.action === 'deselect'
		? m.compose_remove_custom_account_body()
		: m.compose_reset_custom_body()}
	confirmLabel={pendingCustomChange?.action === 'deselect'
		? m.compose_remove_custom_account_confirm()
		: m.compose_reset_custom_confirm()}
	onConfirm={confirmCustomChange}
/>
