<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import * as Select from '$lib/components/ui/select';
	import type { VoiceProfile, VoiceProfileAccount, VoiceProfilesCopy } from '$lib/voice-profiles';

	interface Props {
		accounts: VoiceProfileAccount[];
		profiles: VoiceProfile[];
		assignments: Record<string, string>;
		copy: VoiceProfilesCopy;
		busyAccountId?: string;
		loading?: boolean;
		disabled?: boolean;
		onAssign: (account: VoiceProfileAccount, profileId: string) => void;
	}

	let {
		accounts,
		profiles,
		assignments,
		copy,
		busyAccountId = '',
		loading = false,
		disabled = false,
		onAssign
	}: Props = $props();

	const defaultProfile = $derived(profiles.find((profile) => profile.isDefault) ?? null);
</script>

<section class="space-y-4" aria-labelledby="voice-account-assignments-heading">
	<SectionHeader
		title={copy.accountsHeading}
		description={copy.accountsDescription}
		icon={UsersIcon}
		headingLevel={2}
	/>
	{#if loading}
		<div
			class="flex min-h-16 items-center gap-2 rounded-lg border px-4 text-sm text-muted-foreground"
			role="status"
			aria-live="polite"
		>
			<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
			{copy.accountsLoading}
		</div>
	{:else if accounts.length === 0}
		<p class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
			{copy.noAccounts}
		</p>
	{:else}
		<div class="divide-y rounded-lg border bg-card">
			{#each accounts.filter((account) => account.active !== false) as account (account.id)}
				<div
					class="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)] sm:items-center"
				>
					<div class="flex min-w-0 items-center gap-2.5">
						<span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
							<PlatformIcon platform={account.platform} class="size-4" />
						</span>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{account.label}</p>
							{#if account.handle}<p class="truncate text-xs text-muted-foreground">
									{account.handle}
								</p>{/if}
						</div>
					</div>
					<Select.Root
						type="single"
						value={assignments[account.id] ?? defaultProfile?.id ?? ''}
						disabled={disabled || busyAccountId === account.id || profiles.length === 0}
						onValueChange={(profileId) => profileId && onAssign(account, profileId)}
					>
						<Select.Trigger
							aria-label={copy.accountVoiceLabel(account.label)}
							class="w-full text-sm data-[size=default]:h-11 md:data-[size=default]:h-9"
						>
							{#if busyAccountId === account.id}
								{copy.saving}
							{:else}
								{@const selected = profiles.find(
									(profile) => profile.id === assignments[account.id]
								)}
								{selected?.isDefault
									? copy.workspaceDefaultOption(selected.name)
									: (selected?.name ?? defaultProfile?.name ?? copy.profilesHeading)}
							{/if}
						</Select.Trigger>
						<Select.Content>
							{#each profiles as profile (profile.id)}
								<Select.Item value={profile.id}>
									{profile.isDefault ? copy.workspaceDefaultOption(profile.name) : profile.name}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/each}
		</div>
	{/if}
</section>
