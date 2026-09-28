<script lang="ts">
	/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters -- The inspector renders arbitrary source and node-output JSON, preserving each value's actual type instead of imposing a node schema. */
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import Choice from './choice.svelte';
	import { m } from '$lib/paraglide/messages';
	let {
		label,
		value,
		empty = m.workflows_no_output(),
		draggable = false,
		status = '',
		error = ''
	}: {
		label: string;
		value?: unknown;
		empty?: string;
		draggable?: boolean;
		status?: string;
		error?: string;
	} = $props();
	let mode = $state<'schema' | 'table' | 'json'>('schema');
	const fields = $derived.by(() => {
		const result: { path: string; value: unknown; type: string }[] = [];
		function visit(value: unknown, path: string, depth: number) {
			if (result.length >= 200 || !value || typeof value !== 'object' || depth >= 5) return;
			for (const [key, child] of Object.entries(value)) {
				if (result.length >= 200) break;
				const next = path ? `${path}.${key}` : key;
				result.push({
					path: next,
					value: child,
					type: Array.isArray(child) ? 'array' : child === null ? 'null' : typeof child
				});
				visit(child, next, depth + 1);
			}
		}
		visit(value, '', 0);
		return result;
	});
	let collection = $state('');
	const collections = $derived(fields.filter((field) => Array.isArray(field.value)));
	const selectedCollection = $derived(
		collections.find((field) => field.path === collection) ?? collections[0]
	);
	const rows = $derived.by(() => {
		const data = collection === '$root' ? value : (selectedCollection?.value ?? value);
		const items = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
		return items.map((item) => (item && typeof item === 'object' ? item : { value: item }));
	});
	const columns = $derived(
		[
			...new Set(
				rows.slice(0, 50).flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : []))
			)
		].slice(0, 12)
	);
	function display(value: unknown) {
		return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
	}
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col" aria-label={label}>
	{@render toolbar()}
	{#if mode === 'table' && collections.length}<div class="border-b px-3 py-2">
			<Choice
				value={collection || selectedCollection?.path || '$root'}
				label={m.workflows_items()}
				options={[
					{ value: '$root', label: m.workflows_output() },
					...collections.map((field) => ({ value: field.path, label: field.path }))
				]}
				onchange={(path) => (collection = path)}
			/>
		</div>{/if}
	<div class="min-h-0 flex-1 overflow-auto p-3">
		{#if error}<InlineNotice tone="error" message={error} class="mb-3" />{/if}
		{#if value === undefined || value === null}<p
				class="mx-auto max-w-60 py-12 text-center text-sm leading-6 text-muted-foreground"
			>
				{empty}
			</p>
		{:else if mode === 'json'}<pre
				class="font-mono text-xs leading-6 break-all whitespace-pre-wrap">{JSON.stringify(
					value,
					null,
					2
				)}</pre>
		{:else if mode === 'table' && columns.length}{@render tableView()}
		{:else if fields.length}{@render schemaView()}
		{:else}<pre class="text-xs break-all whitespace-pre-wrap">{display(value)}</pre>{/if}
	</div>
</section>

{#snippet tableView()}
	<div class="overflow-auto">
		<table class="w-full border-collapse text-left text-xs">
			<thead
				><tr
					>{#each columns as column}<th class="border bg-muted px-2 py-2 font-medium">{column}</th
						>{/each}</tr
				></thead
			><tbody
				>{#each rows.slice(0, 50) as row}<tr
						>{#each columns as column}<td class="max-w-64 border px-2 py-2 align-top break-words"
								>{row && typeof row === 'object' ? display(Reflect.get(row, column)) : ''}</td
							>{/each}</tr
					>{/each}</tbody
			>
		</table>
	</div>
{/snippet}

{#snippet schemaView()}
	<div class="space-y-2">
		{#each fields as field}<div
				role="group"
				class="rounded-md px-2 py-2 hover:bg-muted"
				{draggable}
				ondragstart={(event) => {
					event.dataTransfer?.setData('application/openpost-workflow-reference', field.path);
					event.dataTransfer?.setData('text/plain', `{{${field.path}}}`);
				}}
			>
				<div class="flex items-baseline gap-2">
					<code class="min-w-0 text-xs font-medium break-all">{field.path}</code><span
						class="shrink-0 text-[10px] text-muted-foreground">{field.type}</span
					>
				</div>
				{#if field.value === null || typeof field.value !== 'object'}<p
						class="mt-1 line-clamp-4 text-xs leading-5 break-words text-muted-foreground"
					>
						{display(field.value)}
					</p>{/if}
			</div>{/each}
	</div>
{/snippet}

{#snippet toolbar()}
	<header class="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
		<div class="flex items-center gap-2">
			<h2 class="text-sm font-medium">{label}</h2>
			{#if status}<span class="text-xs text-muted-foreground" role="status">{status}</span>{/if}
		</div>
		<div class="flex" aria-label={label}>
			{#each ['schema', 'table', 'json'] as tab}<Button
					size="sm"
					variant={mode === tab ? 'secondary' : 'ghost'}
					aria-pressed={mode === tab}
					onclick={() => (mode = tab as typeof mode)}
					>{tab === 'schema'
						? m.workflows_schema()
						: tab === 'table'
							? m.workflows_table()
							: m.workflows_json()}</Button
				>{/each}
		</div>
	</header>
{/snippet}
