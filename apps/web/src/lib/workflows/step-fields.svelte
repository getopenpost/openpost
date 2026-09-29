<script lang="ts">
	import { z } from 'zod';
	import type { WorkflowData, Step, Value, Connection } from './api';
	import { stepFields, type Reference } from './fields';
	import Field from './field.svelte';
	import Choice from './choice.svelte';
	import CurlImport from './curl-import.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import type { SocialAccount } from '@openpost/query-catalog';
	import { m } from '$lib/paraglide/messages';
	let {
		step,
		references,
		accounts,
		connections = [],
		oninput,
		oninputs,
		readonly = false,
		data = {}
	}: {
		step: Step;
		readonly?: boolean;
		data?: WorkflowData;
		oninputs: (inputs: Record<string, Value>) => void;
		accounts: SocialAccount[];
		references: Reference[];
		connections?: Connection[];
		oninput: (key: string, value: Value) => void;
	} = $props();
	const selectedAccounts = $derived(
		z.array(z.string()).catch([]).parse(step.inputs?.account_ids?.literal)
	);
</script>

<div class="space-y-5">
	{#if step.kind === 'http_request'}<CurlImport onimport={oninputs} />
		<div class="space-y-2">
			<Label for="request-connection">{m.workflows_connection()}</Label><Choice
				id="request-connection"
				value={String(step.inputs?.connection_id?.literal || 'none')}
				label={m.workflows_connection()}
				options={[
					{ value: 'none', label: m.workflows_no_auth() },
					...connections
						.filter((connection) => connection.kind !== 'github')
						.map((connection) => ({ value: connection.id, label: connection.name }))
				]}
				onchange={(id) => oninput('connection_id', { literal: id === 'none' ? '' : id })}
			/><a href="/workflows/connections" class="text-xs underline underline-offset-4"
				>{m.workflows_manage_connections()}</a
			>
		</div>
		<p class="text-xs leading-5 text-muted-foreground">{m.workflows_safe_request()}</p>{/if}
	{#each stepFields(step.kind, step.inputs) as field (field.key)}<Field
			{readonly}
			{data}
			id={`workflow-${field.key}`}
			{...field}
			value={step.inputs?.[field.key]}
			references={field.code ? [] : references}
			onchange={(value) => oninput(field.key, value)}
		/>{/each}
	{#if step.kind === 'code'}<p class="text-xs leading-5 text-muted-foreground">
			{m.workflows_code_hint()}
		</p>{/if}
	{#if step.kind === 'create_draft' || step.kind === 'build_draft'}{@render destinations()}{/if}
</div>

{#snippet destinations()}
	<fieldset class="space-y-1">
		<legend class="mb-2 text-sm font-medium">{m.workflows_destinations()}</legend
		>{#each accounts as account (account.id)}<label
				class="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted"
				><Checkbox
					checked={selectedAccounts.includes(account.id)}
					onCheckedChange={(checked) =>
						oninput('account_ids', {
							literal: checked
								? [...selectedAccounts, account.id]
								: selectedAccounts.filter((id) => id !== account.id)
						})}
				/><SocialAccountIdentity
					name={account.account_username || account.platform}
					platform={account.platform}
					avatarUrl={account.account_avatar_url}
				/></label
			>{/each}{#if !accounts.length}<p class="text-sm text-muted-foreground">
				{m.workflows_no_accounts()}
			</p>{/if}
	</fieldset>
{/snippet}
