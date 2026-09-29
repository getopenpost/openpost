<script lang="ts">
	import type { WorkflowData, Step, Value, Connection } from './api';
	import { stepFields, type Reference } from './fields';
	import Field from './field.svelte';
	import Choice from './choice.svelte';
	import CurlImport from './curl-import.svelte';
	import { Label } from '$lib/components/ui/label';
	import Destinations from './destinations.svelte';
	import type { SocialAccount } from '@openpost/query-catalog';
	import { m } from '$lib/paraglide/messages';
	let {
		step,
		workspaceID,
		references,
		accounts,
		connections = [],
		oninput,
		oninputs,
		readonly = false,
		data = {}
	}: {
		step: Step;
		workspaceID: string;
		readonly?: boolean;
		data?: WorkflowData;
		oninputs: (inputs: Record<string, Value>) => void;
		accounts: SocialAccount[];
		references: Reference[];
		connections?: Connection[];
		oninput: (key: string, value: Value) => void;
	} = $props();
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
	{#if step.kind === 'create_draft' || step.kind === 'build_draft'}<Destinations
			{workspaceID}
			{accounts}
			inputs={step.inputs ?? {}}
			{readonly}
			onchange={oninputs}
		/>{/if}
</div>
