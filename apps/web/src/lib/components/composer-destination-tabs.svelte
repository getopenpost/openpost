<script lang="ts">
	import { tick } from 'svelte';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { m } from '$lib/paraglide/messages';
	import { getPlatformName } from '$lib/utils';
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
	let tabsElement: HTMLElement | undefined = $state();

	const activeTabIsCustom = $derived.by(() => {
		const account = accounts.find((account) => account.id === activeAccountId);
		return account ? isCustomFor(account) : false;
	});

	function activate(value: string) {
		onActivate(value === 'all' ? null : value);
	}

	$effect(() => {
		const accountId = activeAccountId;
		const custom = activeTabIsCustom;
		if (!tabsElement) return;
		void tick().then(() => {
			if (activeAccountId !== accountId || activeTabIsCustom !== custom) return;
			const tabs = tabsElement;
			const selected = tabs?.querySelector<HTMLElement>('[data-active="true"]');
			if (!tabs || !selected) return;
			const tabBounds = selected.getBoundingClientRect();
			const viewport = tabs.getBoundingClientRect();
			if (tabBounds.left < viewport.left) tabs.scrollLeft += tabBounds.left - viewport.left;
			else if (tabBounds.right > viewport.right)
				tabs.scrollLeft += tabBounds.right - viewport.right;
		});
	});
</script>

<Tabs value={activeAccountId ?? 'all'} onValueChange={activate} class="flex min-w-0 flex-1">
	<TabsList
		bind:ref={tabsElement}
		class="destination-tabs-scrollbar w-full min-w-0 justify-start gap-1 overflow-x-auto"
		aria-label={m.compose_destination_tabs()}
	>
		<TabsTrigger id="composer-destination-all" value="all" class="max-w-full shrink-0 grow-0 px-3">
			{m.compose_all_channels()}
		</TabsTrigger>
		{#each accounts as account (account.id)}
			{@const issueCount = issueCountFor(account)}
			{@const custom = isCustomFor(account)}
			<TabsTrigger
				id="composer-destination-{account.id}"
				value={account.id}
				class="max-w-full shrink-0 grow-0 gap-1.5 px-3"
				aria-label={custom
					? `${accountLabel(account)}, ${getPlatformName(account.platform)}, ${m.compose_custom_state()}`
					: `${accountLabel(account)}, ${getPlatformName(account.platform)}`}
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
					></span>
				{/if}
				{#if issueCount > 0}
					<span class="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
						>{issueCount}</span
					>
				{/if}
			</TabsTrigger>
		{/each}
	</TabsList>
</Tabs>
