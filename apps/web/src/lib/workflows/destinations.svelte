<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { z } from 'zod';
	import {
		capabilityCatalogQueryOptions,
		workspaceSocialSetsQueryOptions,
		type SocialAccount
	} from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import SocialSetControl from '$lib/components/social-set-control.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { Value } from './api';
	import { m } from '$lib/paraglide/messages';

	let {
		workspaceID,
		accounts,
		inputs,
		readonly = false,
		onchange
	}: {
		workspaceID: string;
		accounts: SocialAccount[];
		inputs: Record<string, Value>;
		readonly?: boolean;
		onchange: (inputs: Record<string, Value>) => void;
	} = $props();
	const sets = createQuery(() => workspaceSocialSetsQueryOptions(queryAPI, workspaceID));
	const capabilities = createQuery(() => capabilityCatalogQueryOptions(queryAPI));
	const setID = $derived(z.string().catch('').parse(inputs.social_set_id?.literal));
	const selectedSet = $derived(sets.data?.find((set) => set.id === setID));
	const explicitAccounts = $derived(
		z.array(z.string()).catch([]).parse(inputs.account_ids?.literal)
	);
	const selectedAccounts = $derived(
		explicitAccounts.length
			? explicitAccounts
			: (selectedSet?.accounts ?? []).map((account) => account.social_account_id)
	);

	function selectAccounts(ids: string[]) {
		onchange({ social_set_id: { literal: '' }, account_ids: { literal: ids } });
	}
</script>

<fieldset class="min-w-0 space-y-3">
	<legend class="mb-2 text-sm font-medium">{m.workflows_destinations()}</legend>
	{#if capabilities.data && sets.data}<SocialSetControl
			workspaceId={workspaceID}
			{accounts}
			capabilities={capabilities.data.capabilities ?? []}
			selectedAccountIds={selectedAccounts}
			selectedSetId={setID}
			disabled={readonly}
			onApply={(set) =>
				onchange({ social_set_id: { literal: set?.id ?? '' }, account_ids: { literal: [] } })}
			onToggle={(account) =>
				selectAccounts(
					selectedAccounts.includes(account.id)
						? selectedAccounts.filter((id) => id !== account.id)
						: [...selectedAccounts, account.id]
				)}
			onSelectAll={() => selectAccounts(accounts.map((account) => account.id))}
			onClearAll={() => selectAccounts([])}
		/>{/if}
	{#if setID && !sets.isPending && !sets.error && !selectedSet}
		<InlineNotice tone="error" message={m.workflows_set_missing()} />
	{:else if setID}
		<p class="text-xs leading-5 text-muted-foreground">{m.workflows_set_help()}</p>
	{/if}
	{#if capabilities.isPending || sets.isPending}<p
			role="status"
			class="text-xs text-muted-foreground"
		>
			{m.common_loading()}
		</p>{/if}
	{#if capabilities.error || sets.error}<InlineNotice
			tone="error"
			message={String(capabilities.error || sets.error)}
		>
			{#snippet actions()}<Button
					variant="outline"
					size="sm"
					onclick={() => {
						void capabilities.refetch();
						void sets.refetch();
					}}>{m.common_retry()}</Button
				>{/snippet}
		</InlineNotice>{/if}
	{#if !accounts.length}<p class="text-sm text-muted-foreground">
			{m.workflows_no_accounts()}
		</p>{/if}
</fieldset>
