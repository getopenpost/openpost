<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IconComponent } from '$lib/component-types';
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		description?: string;
		icon?: IconComponent;
		actions?: Snippet;
		headingLevel?: 2 | 3 | 4;
		class?: string;
	}

	let {
		title,
		description,
		icon: Icon,
		actions,
		headingLevel = 2,
		class: className
	}: Props = $props();
</script>

<header data-slot="section-header" class={cn('section-header flex flex-col gap-3', className)}>
	<div class="min-w-0">
		{#snippet headingContent()}
			{#if Icon}<Icon class="size-4.5 shrink-0 text-muted-foreground" />{/if}
			{title}
		{/snippet}
		{#if headingLevel === 3}
			<h3 class="flex items-center gap-2 text-base leading-6 font-semibold">
				{@render headingContent()}
			</h3>
		{:else if headingLevel === 4}
			<h4 class="flex items-center gap-2 text-base leading-6 font-semibold">
				{@render headingContent()}
			</h4>
		{:else}
			<h2 class="flex items-center gap-2 text-base leading-6 font-semibold">
				{@render headingContent()}
			</h2>
		{/if}
		{#if description}
			<p class="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="section-header-actions flex w-full shrink-0 flex-wrap items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	@container (min-width: 36rem) {
		.section-header {
			flex-direction: row;
			align-items: flex-start;
			justify-content: space-between;
		}

		.section-header-actions {
			width: auto;
			justify-content: flex-end;
		}
	}
</style>
