<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import EmptyState from '$lib/components/empty-state.svelte';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { AIOpportunity, AIOpportunityGridCopy } from './ai-workspace-types';

	interface Props {
		opportunities: AIOpportunity[];
		selectedId?: string;
		copy: AIOpportunityGridCopy;
		loading?: boolean;
		loadingMessage?: string;
		disabled?: boolean;
		onSelect: (opportunity: AIOpportunity) => void;
	}

	let {
		opportunities,
		selectedId = '',
		copy,
		loading = false,
		loadingMessage = '',
		disabled = false,
		onSelect
	}: Props = $props();

	const uid = $props.id();

	function selectOpportunity(id: string): void {
		const opportunity = opportunities.find((candidate) => candidate.id === id);
		if (opportunity && opportunity.id !== selectedId) onSelect(opportunity);
	}
</script>

<section class="space-y-4" aria-labelledby={`${uid}-heading`}>
	<div class="space-y-1">
		<h2 id={`${uid}-heading`} class="text-base font-semibold tracking-tight">
			{copy.heading}
		</h2>
		<p class="max-w-3xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
	</div>

	{#if loading && opportunities.length === 0}
		<div role="status" aria-live="polite">
			<p class="mb-3 text-sm text-muted-foreground">{loadingMessage || copy.loading}</p>
			<div class="grid gap-3 md:grid-cols-2">
				{#each Array(4) as _, index (index)}
					<div class="rounded-lg border p-4">
						<Skeleton class="h-4 w-2/3" />
						<Skeleton class="mt-3 h-3 w-full" />
						<Skeleton class="mt-2 h-3 w-4/5" />
						<Skeleton class="mt-5 h-8 w-full" />
					</div>
				{/each}
			</div>
		</div>
	{:else if opportunities.length === 0}
		<EmptyState
			icon={LightbulbIcon}
			title={copy.emptyTitle}
			description={copy.emptyDescription}
			variant="muted"
		/>
	{:else}
		<RadioGroup.Root
			class="grid gap-3 md:grid-cols-2"
			value={selectedId}
			onValueChange={selectOpportunity}
			{disabled}
			aria-labelledby={`${uid}-heading`}
			data-testid="ai-opportunity-grid"
		>
			{#each opportunities as opportunity, index (opportunity.id)}
				{@const selected = opportunity.id === selectedId}
				<RadioGroup.Item
					id={`${uid}-opportunity-${index}`}
					class="peer sr-only"
					value={opportunity.id}
					{disabled}
					aria-label={opportunity.title}
				/>
				<label
					for={`${uid}-opportunity-${index}`}
					class={`group relative block min-h-44 cursor-pointer rounded-lg border bg-card p-4 text-left transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:outline-none peer-disabled:pointer-events-none peer-disabled:opacity-50 hover:border-foreground/25 hover:bg-muted/15 ${selected ? 'border-primary bg-primary/3' : ''}`}
				>
					<div class="flex items-start gap-3">
						<div class="min-w-0 flex-1">
							<h3 class="text-sm leading-5 font-semibold">{opportunity.title}</h3>
							<p class="mt-1.5 text-sm leading-6 text-muted-foreground">
								{opportunity.premise}
							</p>
						</div>
						{#if selected}
							<span
								class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
								aria-hidden="true"
							>
								<CheckIcon class="size-3.5" />
								<span class="sr-only">{copy.selected}</span>
							</span>
						{/if}
					</div>

					{#if opportunity.whyItFits}
						<div class="mt-3 border-t pt-3">
							<p class="text-xs font-medium text-foreground">{copy.whyItFits}</p>
							<p class="mt-1 text-xs leading-5 text-muted-foreground">
								{opportunity.whyItFits}
							</p>
						</div>
					{/if}

					{#if opportunity.objective || opportunity.mediaRecommendation}
						<dl class="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-2">
							{#if opportunity.objective}
								<div>
									<dt class="text-muted-foreground">{copy.bestFor}</dt>
									<dd class="mt-0.5 font-medium">{opportunity.objective}</dd>
								</div>
							{/if}
							<div>
								<dt class="text-muted-foreground">{copy.media}</dt>
								<dd class="mt-0.5 font-medium">
									{opportunity.mediaRecommendation || copy.noMedia}
								</dd>
							</div>
						</dl>
					{/if}
				</label>
			{/each}
		</RadioGroup.Root>
	{/if}
</section>
