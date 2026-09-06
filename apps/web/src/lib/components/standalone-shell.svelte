<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Logo from '$lib/components/Logo.svelte';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		description?: string;
		icon?: Snippet;
		children?: Snippet;
		maxWidth?: 'md' | 'lg';
		logoHref?: string | null;
		loading?: boolean;
		loadingLabel?: string;
		class?: string;
	}

	let {
		title,
		description,
		icon,
		children,
		maxWidth = 'md',
		logoHref = null,
		loading = false,
		loadingLabel = 'Loading',
		class: className
	}: Props = $props();

	const widthClass = $derived(maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md');
</script>

<main
	data-slot="standalone-shell"
	class="grid w-full place-items-center px-4 sm:px-6"
	style="min-height: 100dvh; padding-top: max(3rem, calc(env(safe-area-inset-top) + 1.5rem)); padding-bottom: max(3rem, calc(env(safe-area-inset-bottom) + 1.5rem));"
>
	<div class={cn('flex w-full flex-col items-center gap-6', widthClass, className)}>
		{#if logoHref}
			<a
				href={resolve(logoHref as '/')}
				class="inline-flex size-16 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
				aria-label="OpenPost"
			>
				<Logo width={64} height={50} decorative />
			</a>
		{:else}
			<div class="flex size-16 items-center justify-center" aria-hidden="true">
				<Logo width={64} height={50} decorative />
			</div>
		{/if}

		<Card class="w-full gap-0 py-0">
			<CardHeader class="gap-2 px-5 pt-6 pb-4 text-center sm:px-6">
				{#if icon}
					<div
						class="mx-auto mb-1 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary"
						aria-hidden="true"
					>
						{@render icon()}
					</div>
				{/if}
				<h1 class="text-lg/6 font-semibold tracking-tight">{title}</h1>
				{#if description}
					<CardDescription class="mx-auto max-w-[48ch] text-sm/relaxed">
						{description}
					</CardDescription>
				{/if}
			</CardHeader>

			{#if loading || children}
				<CardContent class="px-5 pb-6 sm:px-6">
					{#if loading}
						<div
							data-slot="standalone-loading"
							class="space-y-3"
							role="status"
							aria-live="polite"
							aria-busy="true"
						>
							<Skeleton class="h-14 w-full rounded-md" />
							<Skeleton class="h-4 w-4/5" />
							<Skeleton class="h-10 w-full rounded-md" />
							<span class="sr-only">{loadingLabel}</span>
						</div>
					{:else}
						{@render children?.()}
					{/if}
				</CardContent>
			{/if}
		</Card>
	</div>
</main>
