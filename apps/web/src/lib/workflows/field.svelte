<script lang="ts">
	/* oxlint-disable anti-slop/no-runtime-typeof -- Workflow literals are user-authored JSON; distinguish text from structured values for editing and previews. */
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { Value, WorkflowData } from './api';
	import type { Reference } from './fields';
	import Choice from './choice.svelte';
	import TokenEditor from './token-editor.svelte';
	import { fieldIssue, resolveDisplay } from './validation';
	import { m } from '$lib/paraglide/messages';
	let {
		id,
		label,
		value,
		onchange,
		references = [],
		multiline = false,
		numeric = false,
		preserveReferenceType = false,
		min,
		max,
		placeholder = '',
		required = false,
		code = false,
		json = false,
		options,
		readonly = false,
		data = {}
	}: {
		id: string;
		label: string;
		readonly?: boolean;
		data?: WorkflowData;
		value?: Value;
		onchange: (value: Value) => void;
		references?: Reference[];
		multiline?: boolean;
		numeric?: boolean;
		preserveReferenceType?: boolean;
		min?: number;
		max?: number;
		placeholder?: string;
		required?: boolean;
		code?: boolean;
		json?: boolean;
		options?: { value: string; label: string }[];
	} = $props();

	const text = $derived(
		value?.reference
			? `{{${value.reference}}}`
			: json
				? typeof value?.literal === 'string'
					? value.literal
					: JSON.stringify(value?.literal ?? {}, null, 2)
				: String(value?.literal ?? '')
	);
	const issue = $derived(
		fieldIssue(
			{ key: id.replace('workflow-', ''), label, required, code, json, numeric, min, max },
			value,
			references
		)
	);

	const resolved = $derived.by(() => {
		if (code) return undefined;
		if (value?.reference) return resolveDisplay(value.reference, data);
		if (!text.includes('{{')) return undefined;
		return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}/g, (_token, ref: string) => {
			const value = resolveDisplay(ref, data);
			return value === undefined
				? m.workflows_value_unavailable()
				: typeof value === 'object'
					? JSON.stringify(value)
					: String(value);
		});
	});
	function write(next: string) {
		const reference = !code && next.trim().match(/^\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}$/)?.[1];
		if (reference && (json || numeric || preserveReferenceType)) {
			onchange({ reference });
			return;
		}
		onchange({
			literal: numeric && next !== '' && Number.isFinite(Number(next)) ? Number(next) : next
		});
	}
</script>

<div class="space-y-2" data-workflow-field={id}>
	<div class="flex items-center justify-between gap-2">
		<Label for={id}
			>{label}{#if required}<span aria-hidden="true" class="text-destructive"> *</span>{/if}</Label
		>
	</div>
	{@render literalEditor()}
	{@render resolvedPreview()}
	{#if issue}<p id={`${id}-error`} class="text-xs text-destructive" role="status">{issue}</p>{/if}
</div>

{#snippet literalEditor()}
	{#if options}<Choice {id} value={text} {options} {label} onchange={write} />
	{:else if !numeric || references.length}<TokenEditor
			{id}
			{label}
			value={text}
			{readonly}
			{references}
			{code}
			multiline={multiline || json}
			{placeholder}
			invalid={Boolean(issue)}
			onchange={write}
		/>
	{:else}<Input
			{id}
			{min}
			{max}
			type={numeric ? 'number' : 'text'}
			value={text}
			{placeholder}
			aria-invalid={Boolean(issue)}
			aria-describedby={issue ? `${id}-error` : undefined}
			oninput={(event) => write(event.currentTarget.value)}
		/>{/if}
{/snippet}

{#snippet resolvedPreview()}
	{#if resolved !== undefined}<div class="rounded-md bg-muted/50 p-2 text-xs">
			<span class="text-muted-foreground">{m.workflows_resolved_value()}</span>
			<pre class="mt-1 max-h-28 overflow-auto font-sans whitespace-pre-wrap">{typeof resolved ===
				'object'
					? JSON.stringify(resolved, null, 2)
					: String(resolved)}</pre>
		</div>{/if}
{/snippet}
