<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';

	type LoadingLayout =
		'list' | 'grid' | 'gallery' | 'sections' | 'settings' | 'composer' | 'calendar';
	type LoadingVariant = 'profile' | 'form' | 'cards' | 'list';

	interface Props {
		layout?: LoadingLayout;
		variant?: LoadingVariant;
		label?: string;
		items?: number;
	}

	let {
		layout = 'list',
		variant = 'profile',
		label = 'Loading content',
		items = 4
	}: Props = $props();

	const itemKeys = $derived(Array.from({ length: items }, (_, index) => `loading-${index}`));
	const calendarDayKeys = Array.from({ length: 42 }, (_, index) => `calendar-${index}`);
</script>

<div
	data-slot="page-loading"
	data-testid="page-loading"
	data-layout={layout}
	data-variant={layout === 'settings' ? variant : undefined}
	class="min-w-0"
	role="status"
	aria-live="polite"
	aria-busy="true"
>
	<span class="sr-only">{label}</span>

	{#if layout === 'gallery'}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each itemKeys as key (key)}
				<div class="space-y-2">
					<Skeleton class="aspect-square rounded-lg" />
					<Skeleton class="h-3 w-3/4" />
					<Skeleton class="h-3 w-1/2" />
				</div>
			{/each}
		</div>
	{:else if layout === 'grid'}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each itemKeys as key (key)}
				<div class="flex min-h-28 flex-col gap-3 rounded-lg border p-4">
					<div class="flex items-center gap-3">
						<Skeleton class="size-10 shrink-0 rounded-lg" />
						<div class="min-w-0 flex-1 space-y-2">
							<Skeleton class="h-4 w-2/3" />
							<Skeleton class="h-3 w-5/6" />
						</div>
					</div>
					<Skeleton class="mt-auto h-3 w-1/2" />
				</div>
			{/each}
		</div>
	{:else if layout === 'sections'}
		<div class="flex flex-col gap-8">
			{#each ['primary', 'secondary'] as section (section)}
				<section class="flex flex-col gap-3">
					<Skeleton class="h-5 w-40" />
					<Skeleton class="h-4 w-64 max-w-full" />
					<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{#each itemKeys.slice(0, section === 'primary' ? 3 : 4) as key (`${section}-${key}`)}
							<div class="flex h-24 items-start gap-3 rounded-lg border p-4">
								<Skeleton class="size-10 shrink-0 rounded-lg" />
								<div class="min-w-0 flex-1 space-y-2">
									<Skeleton class="h-4 w-2/3" />
									<Skeleton class="h-3 w-5/6" />
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{:else if layout === 'settings'}
		<div class="grid min-w-0 items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
			<div class="space-y-2">
				<Skeleton class="h-10 w-full lg:hidden" />
				{#each itemKeys as key (key)}
					<Skeleton class="hidden h-9 w-full lg:block" />
				{/each}
			</div>
			<div class="flex min-w-0 flex-col gap-5">
				{#if variant === 'profile'}
					<div class="flex items-center gap-4">
						<Skeleton class="size-20 shrink-0 rounded-full" />
						<div class="min-w-0 flex-1 space-y-3">
							<Skeleton class="h-4 w-32" />
							<Skeleton class="h-9 w-full" />
						</div>
					</div>
					<Skeleton class="h-px w-full" />
					<div class="grid gap-4 sm:grid-cols-2">
						<Skeleton class="h-20" />
						<Skeleton class="h-20" />
					</div>
				{:else if variant === 'cards'}
					<Skeleton class="h-5 w-44" />
					<Skeleton class="h-4 w-64 max-w-full" />
					<div class="grid gap-3 sm:grid-cols-2">
						<Skeleton class="h-28 rounded-lg" />
						<Skeleton class="h-28 rounded-lg" />
					</div>
					<Skeleton class="mt-3 h-24 rounded-lg" />
				{:else if variant === 'list'}
					<Skeleton class="h-5 w-44" />
					<Skeleton class="h-4 w-64 max-w-full" />
					<div class="divide-y border-y">
						{#each itemKeys.slice(0, 3) as key (`setting-${key}`)}
							<div class="flex items-center gap-3 py-4">
								<Skeleton class="size-9 shrink-0 rounded-md" />
								<div class="min-w-0 flex-1 space-y-2">
									<Skeleton class="h-4 w-2/5" />
									<Skeleton class="h-3 w-4/5" />
								</div>
							</div>
						{/each}
					</div>
				{:else}
					{#each ['primary', 'secondary'] as section (section)}
						<div class="space-y-3">
							<Skeleton class="h-5 w-44" />
							<Skeleton class="h-4 w-64 max-w-full" />
							<div class="grid gap-4 sm:grid-cols-2">
								<Skeleton class="h-16 rounded-md" />
								<Skeleton class="h-16 rounded-md" />
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{:else if layout === 'composer'}
		<div class="flex min-h-[28rem] flex-col">
			<div class="flex items-center justify-between gap-3 border-b px-4 py-3">
				<Skeleton class="h-9 w-40" />
				<div class="flex gap-2">
					<Skeleton class="size-9" />
					<Skeleton class="h-9 w-24" />
				</div>
			</div>
			<div class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
				<Skeleton class="h-5 w-52" />
				<Skeleton class="min-h-64 flex-1 rounded-lg" />
				<Skeleton class="h-10 w-full" />
			</div>
		</div>
	{:else if layout === 'calendar'}
		<div class="space-y-4 xl:hidden">
			{#each itemKeys as key (key)}
				<div class="space-y-2">
					<Skeleton class="h-5 w-32" />
					<Skeleton class="h-20 rounded-lg" />
				</div>
			{/each}
		</div>
		<div
			class="calendar-loading-shell hidden grid-cols-7 grid-rows-6 overflow-hidden rounded-lg border xl:grid"
		>
			{#each calendarDayKeys as key (key)}
				<div class="min-h-0 border-r border-b p-1.5 last:border-r-0">
					<Skeleton class="size-5" />
					<div class="mt-1 space-y-1">
						<Skeleton class="h-6 w-full" />
						<Skeleton class="h-6 w-4/5" />
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="divide-y border-y">
			{#each itemKeys as key (key)}
				<div class="flex items-start gap-3 py-4 sm:gap-4">
					<Skeleton class="size-8 shrink-0 rounded-md" />
					<div class="min-w-0 flex-1 space-y-2">
						<Skeleton class="h-3 w-28" />
						<Skeleton class="h-4 w-full max-w-2xl" />
						<Skeleton class="h-3 w-2/5" />
					</div>
					<Skeleton class="h-8 w-20 shrink-0" />
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.calendar-loading-shell {
		height: 100%;
		min-height: 30rem;
		max-height: min(52rem, calc(100dvh - 16.5rem));
	}

	@media (min-width: 90rem) {
		.calendar-loading-shell {
			max-height: min(52rem, calc(100dvh - 10rem));
		}
	}
</style>
