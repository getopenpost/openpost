<script lang="ts">
	import { z } from 'zod';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import type { Value } from './api';
	import Choice from './choice.svelte';
	import { m } from '$lib/paraglide/messages';
	let {
		id,
		label,
		value,
		onchange,
		references = [],
		multiline = false,
		numeric = false,
		placeholder = ''
	}: {
		id: string;
		label: string;
		value?: Value;
		onchange: (value: Value) => void;
		references?: { value: string; label: string }[];
		multiline?: boolean;
		numeric?: boolean;
		placeholder?: string;
	} = $props();
	const scalarSchema = z.union([z.string(), z.number(), z.boolean()]).catch('');
	const text = $derived(String(scalarSchema.parse(value?.literal)));
	const mode = $derived(value?.reference || 'literal');
	function write(next: string) {
		onchange({ literal: numeric && next !== '' ? Number(next) : next });
	}
</script>

<div class="space-y-2">
	<Label for={id}>{label}</Label>
	{#if references.length}
		<Choice
			value={mode}
			options={[{ value: 'literal', label: m.workflows_custom_value() }, ...references]}
			label={m.workflows_value_source({ field: label })}
			onchange={(next) => onchange(next === 'literal' ? { literal: '' } : { reference: next })}
		/>
	{/if}
	{#if !value?.reference}
		{#if multiline}<Textarea
				{id}
				value={text}
				{placeholder}
				rows={5}
				oninput={(event) => write(event.currentTarget.value)}
			/>
		{:else}<Input
				{id}
				type={numeric ? 'number' : 'text'}
				value={text}
				{placeholder}
				oninput={(event) => write(event.currentTarget.value)}
			/>{/if}
		{#if multiline && references.length}<Choice
				value="insert"
				label={m.workflows_insert_field()}
				options={[{ value: 'insert', label: m.workflows_insert_field() }, ...references]}
				onchange={(next) => {
					if (next !== 'insert') write(`${text}{{${next}}}`);
				}}
			/>{/if}
	{:else}<p class="text-xs break-all text-muted-foreground">{value.reference}</p>{/if}
</div>
