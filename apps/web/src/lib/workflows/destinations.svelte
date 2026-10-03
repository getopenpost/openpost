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
	import { builderDestinationIssue } from './validation';
	import { m } from '$lib/paraglide/messages';

	let {
		workspaceID,
		accounts,
		inputs,
		readonly = false,
		required = false,
		onchange
	}: {
		workspaceID: string;
		accounts: SocialAccount[];
		inputs: Record<string, Value>;
		readonly?: boolean;
		required?: boolean;
		onchange: (inputs: Record<string, Value>) => void;
	} = $props();
	const uid = $props.id();
	const issue = $derived(required ? builderDestinationIssue(inputs) : '');
	const sets = createQuery(() => workspaceSocialSetsQueryOptions(queryAPI, workspaceID));
	const capabilities = createQuery(() => capabilityCatalogQueryOptions(queryAPI));
	// Subscribe to both reads before short-circuiting their combined state.
	const reads = $derived({
		sets: { data: sets.data, pending: sets.isPending, error: sets.error },
		capabilities: {
			data: capabilities.data,
			pending: capabilities.isPending,
			error: capabilities.error
		}
	});
	const setID = $derived(z.string().catch('').parse(inputs.social_set_id?.literal));
	const selectedSet = $derived(reads.sets.data?.find((set) => set.id === setID));
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

<fieldset class="min-w-0 space-y-3" aria-describedby={issue ? `${uid}-error` : undefined}>
	<legend class="mb-2 text-sm font-medium"
		>{m.workflows_destinations()}{#if required}<span aria-hidden="true" class="text-destructive">
				*</span
			>{/if}</legend
	>
	{#if issue}<p id={`${uid}-error`} role="status" class="text-xs text-destructive">{issue}</p>{/if}
	{#if reads.capabilities.data && reads.sets.data}<SocialSetControl
			workspaceId={workspaceID}
			{accounts}
			capabilities={reads.capabilities.data.capabilities ?? []}
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
	{#if setID && !reads.sets.pending && !reads.sets.error && !selectedSet}
		<InlineNotice tone="error" message={m.workflows_set_missing()} />
	{:else if setID}
		<p class="text-xs leading-5 text-muted-foreground">{m.workflows_set_help()}</p>
	{/if}
	{#if reads.capabilities.pending || reads.sets.pending}<p
			role="status"
			class="text-xs text-muted-foreground"
		>
			{m.common_loading()}
		</p>{/if}
	{#if reads.capabilities.error || reads.sets.error}<InlineNotice
			tone="error"
			message={String(reads.capabilities.error || reads.sets.error)}
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
