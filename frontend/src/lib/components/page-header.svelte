<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { Skeleton } from '$lib/components/ui/skeleton';

	interface Props {
		title: string;
		icon?: ConstructorOfATypedSvelteComponent;
		eyebrow?: string;
		description?: string;
		meta?: Snippet;
		actions?: Snippet;
		loading?: boolean;
		loadingActionCount?: number;
		compactOnMobile?: boolean;
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
		loadingActionCount = 2,
		compactOnMobile = false,
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
	data-testid="page-header"
	class={cn(
		'page-header flex min-w-0 flex-col gap-4',
		compactOnMobile && 'gap-2 sm:gap-4',
		className
	)}
>
	<div class={cn('min-w-0', compactOnMobile && 'compact-page-header-title')}>
		{#if eyebrow}
			<div class="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
				{#if Icon}
					<Icon class="size-4 shrink-0" />
				{/if}
				<span>{eyebrow}</span>
			</div>
		{/if}
		<h1 class="flex items-center gap-2.5 text-xl leading-7 font-semibold tracking-tight">
			{#if Icon && !eyebrow}
				<Icon class="size-5 shrink-0 text-primary" />
			{/if}
			<span class="min-w-0 break-words">{title}</span>
		</h1>
		{#if description}
			<p class="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
		{/if}
		{#if meta}
			<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
				{@render meta()}
			</div>
		{/if}
	</div>

	{#if actions}
		<div
			data-slot="page-header-actions"
			class={cn(
				'page-header-actions flex w-full shrink-0 flex-wrap items-center gap-2',
				compactOnMobile && 'justify-end'
			)}
		>
			{#if loading}
				{#each loadingActionKeys as key, index (key)}
					<Skeleton class={index === 0 ? 'h-9 w-32' : 'h-9 w-24'} />
				{/each}
			{:else}
				{@render actions()}
			{/if}
		</div>
	{/if}
</header>

<style>
	.compact-page-header-title {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}

	@container (min-width: 44rem) {
		.compact-page-header-title {
			position: static;
			width: auto;
			height: auto;
			padding: 0;
			margin: 0;
			overflow: visible;
			clip: auto;
			white-space: normal;
			border-width: 0;
		}

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
