<script lang="ts">
	import type { MentionCandidate } from '@openpost/platform-text/mentions';
	import type { UiMessages } from '../messages.js';
	let {
		state,
		id,
		m
	}: {
		id: string;
		m: UiMessages;
		state: {
			items: MentionCandidate[];
			selected: number;
			error: string;
			loading: boolean;
			hint: string;
			create?: () => void;
			choose: (index: number) => void;
			retry: () => void;
		};
	} = $props();
</script>

<div
	class="mention-list max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
	aria-label={m.editor_mentions()}
>
	<div {id} role="listbox" aria-label={m.editor_mentions()} aria-busy={state.loading}>
		{#each state.items as item, index (item.target.id)}
			<button
				id={`${id}-${index}`}
				type="button"
				role="option"
				aria-selected={index === state.selected}
				class="flex min-h-11 w-full flex-col rounded-sm px-3 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-accent"
				data-active={index === state.selected}
				onpointerdown={(event) => event.preventDefault()}
				onclick={() => state.choose(index)}
			>
				<span class="w-full truncate font-medium">{item.label}</span>
				{#if item.detail}<span class="w-full truncate text-xs text-muted-foreground"
						>{item.detail}</span
					>{/if}
			</button>
		{/each}
		{#if state.create}
			<button id={`${id}-${state.items.length}`} type="button" role="option"
				aria-selected={state.selected === state.items.length}
				class="flex min-h-11 w-full items-center rounded-sm px-3 py-2 text-start text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-accent"
				data-active={state.selected === state.items.length}
				onpointerdown={(event) => event.preventDefault()} onclick={state.create}>{m.editor_add_mention()}</button>
		{/if}
	</div>
	{#if state.loading}<p class="px-3 py-2 text-sm text-muted-foreground" role="status">
			{m.editor_searching()}
		</p>
	{:else if state.error}<p class="px-3 py-2 text-sm" role="status">{state.error}</p>
		<button
			type="button"
			class="min-h-11 rounded-sm px-3 text-sm underline focus-visible:ring-2 focus-visible:ring-ring"
			onclick={state.retry}>{m.editor_retry()}</button
		>
	{:else if state.hint}<p class="px-3 py-2 text-sm text-muted-foreground" role="status">{state.hint}</p>
	{:else if !state.items.length && !state.create}<p class="px-3 py-2 text-sm text-muted-foreground" role="status">
			{m.editor_no_matches()}
		</p>{/if}
</div>
