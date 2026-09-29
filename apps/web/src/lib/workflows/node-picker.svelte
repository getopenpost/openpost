<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { recipes } from './recipes';
	import { actionCatalog, sourceLabel } from './catalog';
	import type { Step, Source } from './api';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let {
		onrecipe,
		onadd,
		onsource,
		onclose
	}: {
		onrecipe: (id: string) => void;
		onadd: (kind: Step['kind']) => void;
		onsource: (kind: Source['kind']) => void;
		onclose: () => void;
	} = $props();
	let search = $state(''),
		group = $state('all');
	let input = $state<HTMLInputElement | null>(null);
	let open = $state(true);
	function category(kind: Step['kind']) {
		if (['ai_text', 'ai_decision', 'build_draft'].includes(kind)) return 'ai';
		if (['approval', 'wait', 'condition'].includes(kind)) return 'flow';
		if (['create_draft', 'schedule', 'reply', 'metrics'].includes(kind)) return 'content';
		if (['http_request', 'code', 'read_feed'].includes(kind)) return 'tools';
		return 'data';
	}
	const groups = $derived([
		{ id: 'all', label: m.workflows_all_nodes() },
		{ id: 'recipes', label: m.workflows_recipes() },
		{ id: 'triggers', label: m.workflows_triggers_group() },
		{ id: 'content', label: m.workflows_content_group() },
		{ id: 'ai', label: m.workflows_ai_group() },
		{ id: 'flow', label: m.workflows_flow_group() },
		{ id: 'data', label: m.workflows_data_group() },
		{ id: 'tools', label: m.workflows_tools_group() }
	]);
	const entries = $derived(
		actionCatalog().filter(
			(item) =>
				(group === 'all' || category(item.kind) === group) &&
				`${item.label} ${item.description}`.toLowerCase().includes(search.toLowerCase())
		)
	);
	const recipeEntries = $derived(
		recipes().filter((item) =>
			`${item.label} ${item.description}`.toLowerCase().includes(search.toLowerCase())
		)
	);
	const sources = $derived(
		(
			[
				'manual',
				'interval',
				'github_release',
				'rss',
				'publication_created',
				'rendition_published',
				'rendition_failed'
			] satisfies Source['kind'][]
		).filter((kind) => sourceLabel(kind).toLowerCase().includes(search.toLowerCase()))
	);
</script>

<Sheet.Root
	bind:open
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Sheet.Content
		showCloseButton={false}
		class="gap-0 bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-[380px]"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			input?.focus();
		}}
	>
		<Sheet.Description class="sr-only">{m.workflows_add_after()}</Sheet.Description>
		<aside class="flex h-full min-h-0 flex-col" aria-label={m.workflows_choose_next()}>
			<div class="flex items-center justify-between px-4 py-3">
				<Sheet.Title class="text-sm font-semibold">{m.workflows_choose_next()}</Sheet.Title>
				<Button variant="ghost" size="icon-sm" aria-label={m.common_close()} onclick={onclose}
					><ThemeIcon role="close" class="size-4" /></Button
				>
			</div>
			<div class="px-4 pb-3">
				<Input
					bind:ref={input}
					bind:value={search}
					placeholder={m.workflows_search_nodes()}
					aria-label={m.workflows_search_nodes()}
				/>
			</div>
			<div class="flex flex-wrap gap-1 border-b px-3 pb-3">
				{#each groups as entry}<Button
						size="sm"
						variant={group === entry.id ? 'secondary' : 'ghost'}
						onclick={() => (group = entry.id)}>{entry.label}</Button
					>{/each}
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto p-2">
				{#if group === 'recipes'}
					{#each recipeEntries as entry}
						<button
							type="button"
							class="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => onrecipe(entry.id)}
						>
							<ThemeIcon role="repeat" class="mt-1 size-5 shrink-0" /><span
								><span class="block text-sm font-medium">{entry.label}</span><span
									class="mt-1 block text-xs leading-5 text-muted-foreground"
									>{entry.description}</span
								></span
							>
						</button>
					{/each}
					{#if !recipeEntries.length}<p class="p-4 text-sm text-muted-foreground">
							{m.workflows_no_match()}
						</p>{/if}
				{:else if group === 'triggers'}{#each sources as kind}<button
							type="button"
							class="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => onsource(kind)}
							><ThemeIcon
								role={kind === 'github_release' ? 'github' : 'download'}
								class="size-5"
							/>{sourceLabel(kind)}</button
						>{/each}
				{:else}{#each entries as entry}<button
							type="button"
							class="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
							onclick={() => onadd(entry.kind)}
							><span
								class="mt-1 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"
								><ThemeIcon role={entry.icon} class="size-4" /></span
							><span
								><span class="block text-sm font-medium">{entry.label}</span><span
									class="mt-1 block text-xs leading-5 text-muted-foreground"
									>{entry.description}</span
								></span
							></button
						>{/each}{#if !entries.length}<p class="p-4 text-sm text-muted-foreground">
							{m.workflows_no_match()}
						</p>{/if}{/if}
			</div>
		</aside>
	</Sheet.Content>
</Sheet.Root>
