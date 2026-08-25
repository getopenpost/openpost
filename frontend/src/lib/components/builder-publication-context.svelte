<script lang="ts">
	import type { BuilderContext } from '$lib/composer/builder-context';
	import { m } from '$lib/paraglide/messages';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	let {
		context,
		goal = '',
		audience = ''
	}: {
		context: BuilderContext;
		goal?: string;
		audience?: string;
	} = $props();

	let open = $state(false);
	const reviewCount = $derived(context.reviewFlags.length);
	const voiceNames = $derived.by(() => [
		...new Set(context.voices.map((voice) => voice.name).filter(Boolean))
	]);

	function humanize(value: string): string {
		const words = value
			.replace(/^[^.]+\./, '')
			.replaceAll('_', ' ')
			.trim();
		return words ? `${words[0].toUpperCase()}${words.slice(1)}` : '';
	}

	function platformLabel(platform: string): string {
		if (platform.toLowerCase() === 'x') return 'X';
		if (platform.toLowerCase() === 'linkedin') return 'LinkedIn';
		if (platform.toLowerCase() === 'bluesky') return 'Bluesky';
		if (platform.toLowerCase() === 'mastodon') return 'Mastodon';
		if (platform.toLowerCase() === 'threads') return 'Threads';
		return humanize(platform);
	}

	function voiceFor(accountId: string): string {
		return context.voices.find((voice) => voice.accountId === accountId)?.name ?? '';
	}
</script>

<Collapsible.Root
	bind:open
	class="shrink-0 border-b bg-card/80 supports-[backdrop-filter]:bg-card/70 supports-[backdrop-filter]:backdrop-blur"
	data-testid="builder-publication-context"
>
	<div class="mx-auto w-full max-w-[1600px] px-3 sm:px-4">
		<Collapsible.Trigger
			class="group flex min-h-14 w-full items-center gap-3 rounded-md py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
		>
			<span
				class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary"
			>
				<SparklesIcon class="size-4" />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-semibold">{m.post_builder_context_heading()}</span>
				<span class="block truncate text-xs text-muted-foreground">
					{context.thesis || m.post_builder_context_description()}
				</span>
			</span>
			{#if reviewCount > 0}
				<span
					class="hidden items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-800 sm:flex dark:text-amber-300"
				>
					<CircleAlertIcon class="size-3.5" />
					{m.post_builder_context_review_count({ count: reviewCount })}
				</span>
			{/if}
			<ChevronDownIcon
				class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
			/>
		</Collapsible.Trigger>

		<Collapsible.Content>
			<div class="grid gap-5 border-t py-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
				<section class="space-y-3" aria-labelledby="builder-direction-heading">
					<h3
						id="builder-direction-heading"
						class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
					>
						{m.post_builder_direction()}
					</h3>
					<dl class="grid gap-2 text-sm">
						{#if context.thesis}
							<div>
								<dt class="text-xs text-muted-foreground">{m.post_builder_core_thesis()}</dt>
								<dd class="mt-0.5 leading-5 font-medium">{context.thesis}</dd>
							</div>
						{/if}
						{#if context.angle}
							<div>
								<dt class="text-xs text-muted-foreground">{m.post_builder_angle()}</dt>
								<dd class="mt-0.5 leading-5">{context.angle}</dd>
							</div>
						{/if}
						<div class="flex flex-wrap gap-x-5 gap-y-2">
							{#if goal}
								<div>
									<dt class="text-xs text-muted-foreground">{m.post_builder_goal()}</dt>
									<dd>{goal}</dd>
								</div>
							{/if}
							{#if audience}
								<div>
									<dt class="text-xs text-muted-foreground">{m.post_builder_audience()}</dt>
									<dd>{audience}</dd>
								</div>
							{/if}
							{#if context.route}
								<div>
									<dt class="text-xs text-muted-foreground">{m.post_builder_context_route()}</dt>
									<dd>{humanize(context.route)}</dd>
								</div>
							{/if}
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">{m.post_builder_voice()}</dt>
							<dd>
								{voiceNames.length > 0 ? voiceNames.join(', ') : m.post_builder_voice_defaults()}
							</dd>
						</div>
					</dl>
					{#if context.media.treatment && context.media.treatment !== 'none'}
						<div class="rounded-lg border bg-muted/20 p-3 text-sm">
							<p class="text-xs font-medium text-muted-foreground">{m.post_builder_media_plan()}</p>
							<p class="mt-1 font-medium">{humanize(context.media.treatment)}</p>
							{#if context.media.brief}
								<p class="mt-1 leading-5 text-muted-foreground">{context.media.brief}</p>
							{/if}
						</div>
					{/if}
				</section>

				<div class="space-y-5">
					<section class="space-y-2" aria-labelledby="builder-destinations-heading">
						<h3
							id="builder-destinations-heading"
							class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
						>
							{m.post_builder_destination_plan()}
						</h3>
						<div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
							{#each context.destinations as destination (destination.accountId)}
								<div class="rounded-lg border bg-background/70 p-3">
									<div class="flex items-start justify-between gap-2">
										<p class="font-medium">{platformLabel(destination.platform)}</p>
										<span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
											{humanize(destination.outputProfile)}
										</span>
									</div>
									{#if destination.objective || destination.archetype}
										<p class="mt-1 text-xs leading-5 text-muted-foreground">
											{[destination.objective, destination.archetype]
												.filter(Boolean)
												.map(humanize)
												.join(' · ')}
										</p>
									{/if}
									{#if voiceFor(destination.accountId)}
										<p class="mt-1 text-xs text-muted-foreground">
											{m.post_builder_voice()}: {voiceFor(destination.accountId)}
										</p>
									{/if}
									{#if destination.media.treatment && destination.media.treatment !== 'none'}
										<p class="mt-2 border-t pt-2 text-xs leading-5">
											<span class="font-medium">{humanize(destination.media.treatment)}</span>
											{#if destination.media.brief}: {destination.media.brief}{/if}
										</p>
									{/if}
								</div>
							{/each}
							{#each context.skipped as destination (destination.accountId)}
								<div class="rounded-lg border border-dashed bg-muted/15 p-3 text-muted-foreground">
									<div class="flex items-center justify-between gap-2">
										<p class="text-sm font-medium">{platformLabel(destination.platform)}</p>
										<span class="text-[11px] font-medium uppercase">{m.post_builder_skipped()}</span
										>
									</div>
									{#if destination.reason}<p class="mt-1 text-xs leading-5">
											{destination.reason}
										</p>{/if}
								</div>
							{/each}
						</div>
					</section>

					{#if context.reviewFlags.length > 0}
						<section class="space-y-2" aria-labelledby="builder-review-heading">
							<h3
								id="builder-review-heading"
								class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
							>
								{m.post_builder_context_review_notes()}
							</h3>
							<div class="grid gap-2 sm:grid-cols-2">
								{#each context.reviewFlags as flag, index (`${flag.field}-${index}`)}
									<div class="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
										<p class="text-xs font-medium text-amber-800 dark:text-amber-300">
											{humanize(flag.field)}
										</p>
										<p class="mt-1 text-sm leading-5">{flag.message}</p>
									</div>
								{/each}
							</div>
						</section>
					{/if}
				</div>
			</div>
		</Collapsible.Content>
	</div>
</Collapsible.Root>
