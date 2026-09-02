<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IconComponent } from '$lib/component-types';
	import { cn } from '$lib/utils';
	import { Skeleton } from '$lib/components/ui/skeleton';

	interface Props {
		title: string;
		icon?: IconComponent;
		eyebrow?: string;
		description?: string;
		meta?: Snippet;
		actions?: Snippet;
		loading?: boolean;
		loadingPlaceholderVisible?: boolean;
		loadingActionCount?: number;
		contentClass?: string;
		titleClass?: string;
		class?: string;
	}

	let {
		title,
		icon: Icon,
		eyebrow,
		description,
		meta,
		actions,
		loading = false,
		loadingPlaceholderVisible = true,
		loadingActionCount = 2,
		contentClass,
		titleClass,
		class: className
	}: Props = $props();

	const loadingActionKeys = $derived(
		Array.from(
			{ length: Math.max(0, Math.floor(loadingActionCount)) },
			(_, index) => `header-action-${index}`
		)
	);
</script>

<header
	data-slot="page-header"
	data-theme-header
	data-testid="page-header"
	class={cn('page-header flex min-w-0 flex-col', className)}
>
	<div class={cn('min-w-0', contentClass)}>
		{#if eyebrow}
			<div data-theme-type="label" class="mb-1 flex items-center gap-2 text-muted-foreground">
				{#if Icon}
					<Icon class="size-4 shrink-0" />
				{/if}
				<span>{eyebrow}</span>
			</div>
		{/if}
		<h1 data-theme-type="title" class="flex items-center gap-2.5">
			{#if Icon && !eyebrow}
				<Icon class="size-5 shrink-0 text-primary" />
			{/if}
			<span class={cn('min-w-0 break-words', titleClass)}>{title}</span>
		</h1>
		{#if description}
			<p data-theme-type="body" class="mt-1 max-w-2xl text-muted-foreground">{description}</p>
		{/if}
		{#if meta}
			<div
				data-theme-type="metadata"
				class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"
			>
				{@render meta()}
			</div>
		{/if}
	</div>

	{#if actions}
		<div
			data-slot="page-header-actions"
			class="page-header-actions flex w-full shrink-0 flex-wrap items-center gap-2"
		>
			{#if loading}
				{#each loadingActionKeys as key, index (key)}
					<Skeleton
						class={cn(
							index === 0 ? 'h-9 w-32' : 'h-9 w-24',
							!loadingPlaceholderVisible && 'invisible'
						)}
					/>
				{/each}
			{:else}
				{@render actions()}
			{/if}
		</div>
	{/if}
</header>

<style>
	@container (min-width: 44rem) {
		.page-header {
			flex-direction: row;
			align-items: flex-start;
			justify-content: space-between;
		}

		.page-header-actions {
			width: auto;
			justify-content: flex-end;
		}
	}
</style>
