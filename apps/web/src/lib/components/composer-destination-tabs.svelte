<script lang="ts">
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { SocialAccount } from '$lib/api/client';

	interface Props {
		accounts: SocialAccount[];
		activeAccountId: string | null;
		onActivate: (accountId: string | null) => void;
		accountLabel: (account: SocialAccount) => string;
		issueCountFor: (account: SocialAccount) => number;
		isCustomFor: (account: SocialAccount) => boolean;
	}

	let { accounts, activeAccountId, onActivate, accountLabel, issueCountFor, isCustomFor }: Props =
		$props();
</script>

<div
	class="destination-tabs-scrollbar flex gap-1 overflow-x-auto border-b pb-px"
	role="tablist"
	aria-label={m.compose_destination_tabs()}
>
	<button
		type="button"
		role="tab"
		aria-selected={!activeAccountId}
		class="min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
		class:border-foreground={!activeAccountId}
		class:border-transparent={Boolean(activeAccountId)}
		class:text-muted-foreground={Boolean(activeAccountId)}
		onclick={() => onActivate(null)}
	>
		{m.compose_all_channels()}
	</button>
	{#each accounts as account (account.id)}
		{@const issueCount = issueCountFor(account)}
		{@const custom = isCustomFor(account)}
		<button
			id="composer-destination-{account.id}"
			type="button"
			role="tab"
			aria-selected={activeAccountId === account.id}
			aria-label={custom
				? `${accountLabel(account)}, ${m.compose_custom_state()}`
				: accountLabel(account)}
			class="flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
			class:border-foreground={activeAccountId === account.id}
			class:border-transparent={activeAccountId !== account.id}
			class:text-muted-foreground={activeAccountId !== account.id}
			onclick={() => onActivate(account.id)}
		>
			<SocialAccountIdentity
				class="max-w-52"
				name={accountLabel(account)}
				platform={account.platform}
				avatarUrl={account.account_avatar_url}
				size="sm"
				compactOnMobile
				showPlatform={false}
			/>
			{#if custom}
				<span
					class="size-1.5 shrink-0 rounded-full bg-primary"
					aria-hidden="true"
					title={m.compose_custom_state()}
					data-testid="composer-destination-custom"
				/>
			{/if}
			{#if issueCount > 0}
				<span class="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
					>{issueCount}</span
				>
			{/if}
		</button>
	{/each}
</div>
