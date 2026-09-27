<script lang="ts">
	import { z } from 'zod';
	import type { Step, Value } from './api';
	import Field from './field.svelte';
	import Choice from './choice.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import type { SocialAccount } from '@openpost/query-catalog';
	import { m } from '$lib/paraglide/messages';
	let {
		step,
		references,
		accounts,
		oninput,
		onname
	}: {
		step: Step;
		accounts: SocialAccount[];
		references: { value: string; label: string }[];
		oninput: (key: string, value: Value) => void;
		onname: (name: string) => void;
	} = $props();
	const accountIDsSchema = z.array(z.string()).catch([]);
	const selectedAccounts = $derived(accountIDsSchema.parse(step.inputs?.account_ids?.literal));
</script>

<div class="space-y-5">
	<div class="space-y-2">
		<Label for="workflow-step-name">{m.workflows_step_name()}</Label><Input
			id="workflow-step-name"
			value={step.name}
			oninput={(event) => onname(event.currentTarget.value)}
		/>
	</div>
	{#if step.kind === 'create_draft' || step.kind === 'build_draft'}
		<Field
			id="workflow-text"
			label={m.workflows_post_text()}
			value={step.inputs?.text}
			{references}
			multiline
			onchange={(value) => oninput('text', value)}
		/>
		{#if step.kind === 'build_draft'}<Field
				id="workflow-instructions"
				label={m.workflows_instructions()}
				value={step.inputs?.instructions}
				multiline
				onchange={(value) => oninput('instructions', value)}
			/>{/if}
		<fieldset class="space-y-2">
			<legend class="mb-2 text-sm font-medium">{m.workflows_destinations()}</legend>
			{#each accounts as account (account.id)}<label
					class="flex min-h-10 items-center gap-2 text-sm [@media(pointer:coarse)]:min-h-11"
					><Checkbox
						checked={selectedAccounts.includes(account.id)}
						onCheckedChange={(checked) =>
							oninput('account_ids', {
								literal: checked
									? [...selectedAccounts, account.id]
									: selectedAccounts.filter((id) => id !== account.id)
							})}
					/>{account.account_username || account.platform}</label
				>{/each}
			{#if accounts.length === 0}<p class="text-sm text-muted-foreground">
					{m.workflows_no_accounts()}
				</p>{/if}
		</fieldset>
	{:else if step.kind === 'approval' || step.kind === 'schedule'}
		<Field
			id="workflow-publication"
			label={m.workflows_post()}
			value={step.inputs?.publication_id}
			{references}
			onchange={(value) => oninput('publication_id', value)}
		/>
		{#if step.kind === 'schedule'}<Field
				id="workflow-revision"
				label={m.workflows_post_revision()}
				value={step.inputs?.revision}
				{references}
				numeric
				onchange={(value) => oninput('revision', value)}
			/><Field
				id="workflow-delay"
				label={m.workflows_minutes()}
				value={step.inputs?.minutes}
				numeric
				onchange={(value) => oninput('minutes', value)}
			/>{/if}
	{:else if step.kind === 'wait'}<Field
			id="workflow-delay"
			label={m.workflows_minutes()}
			value={step.inputs?.minutes}
			numeric
			onchange={(value) => oninput('minutes', value)}
		/>
	{:else if step.kind === 'condition'}
		<Field
			id="workflow-left"
			label={m.workflows_condition_value()}
			value={step.inputs?.left}
			{references}
			onchange={(value) => oninput('left', value)}
		/>
		<Choice
			value={String(step.inputs?.operator?.literal ?? 'equals')}
			label={m.workflows_operator()}
			options={[
				{ value: 'equals', label: m.workflows_equals() },
				{ value: 'not_equals', label: m.workflows_not_equals() },
				{ value: 'contains', label: m.workflows_contains() },
				{ value: 'at_least', label: m.workflows_at_least() },
				{ value: 'greater_than', label: m.workflows_greater_than() },
				{ value: 'less_than', label: m.workflows_less_than() }
			]}
			onchange={(value) => oninput('operator', { literal: value })}
		/>
		<Field
			id="workflow-right"
			label={m.workflows_compare_with()}
			value={step.inputs?.right}
			{references}
			onchange={(value) => oninput('right', value)}
		/>
	{:else if step.kind === 'reply' || step.kind === 'metrics'}
		<Field
			id="workflow-rendition"
			label={m.workflows_variant()}
			value={step.inputs?.rendition_id}
			{references}
			onchange={(value) => oninput('rendition_id', value)}
		/>
		{#if step.kind === 'reply'}<Field
				id="workflow-reply"
				label={m.workflows_reply_text()}
				value={step.inputs?.text}
				{references}
				multiline
				onchange={(value) => oninput('text', value)}
			/>
		{:else}<Field
				id="workflow-age"
				label={m.workflows_metric_age()}
				value={step.inputs?.max_age_minutes}
				numeric
				onchange={(value) => oninput('max_age_minutes', value)}
			/>{/if}
	{/if}
</div>
