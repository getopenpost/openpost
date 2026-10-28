<script lang="ts" generics="T extends { id: string }">
	import type { Snippet } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import { matchesAccountSearch } from './search';

	let {
		accounts,
		searchText,
		children,
		query = $bindable(''),
		showSearch = true,
		bounded = true,
		columns = 'auto',
		emptyLabel = m.compose_no_accounts()
	}: {
		accounts: T[];
		searchText: (account: T) => string;
		children: Snippet<[T]>;
		query?: string;
		showSearch?: boolean;
		bounded?: boolean;
		columns?: 'auto' | 'single';
		emptyLabel?: string;
	} = $props();

	const visibleAccounts = $derived(
		accounts.filter((account) => matchesAccountSearch(searchText(account), query))
	);
</script>

<div
	class="account-picker-list min-w-0 space-y-2"
	class:bounded
	class:single-column={columns === 'single'}
>
	{#if showSearch && (accounts.length >= 8 || query)}
		<Input
			type="search"
			bind:value={query}
			aria-label={m.account_picker_search()}
			placeholder={m.account_picker_search()}
		/>
	{/if}
	<div class="account-picker-results">
		<div class="account-picker-grid">
			{#each visibleAccounts as account (account.id)}
				{@render children(account)}
			{:else}
				<p class="col-span-full px-2 py-3 text-sm text-muted-foreground" role="status">
					{query.trim() ? m.account_picker_no_matches() : emptyLabel}
				</p>
			{/each}
		</div>
	</div>
</div>

<style>
	.account-picker-list {
		container-type: inline-size;
	}
	.account-picker-results {
		min-width: 0;
	}
	.bounded .account-picker-results {
		max-height: min(24rem, 55dvh);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.account-picker-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem 0.75rem;
	}
	@container (min-width: 28rem) {
		.account-picker-list:not(.single-column) .account-picker-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
