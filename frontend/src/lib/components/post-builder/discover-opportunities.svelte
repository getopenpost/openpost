<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import type {
		PostBuilderCopy,
		PostBuilderOpportunity,
		PostBuilderOpportunityAngle
	} from '$lib/post-builder';

	interface Props {
		opportunities: PostBuilderOpportunity[];
		selectedOpportunityId?: string;
		selectedOpportunityAngleId?: string;
		copy: PostBuilderCopy;
		loading?: boolean;
		error?: string;
		hasMore?: boolean;
		disabled?: boolean;
		onSelect: (opportunity: PostBuilderOpportunity) => void;
		onSelectAngle?: (
			opportunity: PostBuilderOpportunity,
			angle: PostBuilderOpportunityAngle
		) => void;
		onRefresh?: () => void;
		onLoadMore?: () => void;
	}

	let {
		opportunities,
		selectedOpportunityId = '',
		selectedOpportunityAngleId = '',
		copy,
		loading = false,
		error = '',
		hasMore = false,
		disabled = false,
		onSelect,
		onSelectAngle,
		onRefresh,
		onLoadMore
	}: Props = $props();
</script>

<section aria-labelledby="post-builder-discover-heading" class="space-y-4">
	<div class="space-y-1">
		<h2 id="post-builder-discover-heading" class="text-base font-semibold tracking-tight">
			{copy.discoverHeading}
		</h2>
		<p class="max-w-2xl text-sm leading-6 text-muted-foreground">{copy.discoverDescription}</p>
	</div>

	{#if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				{#if onRefresh}
					<Button type="button" variant="ghost" size="sm" onclick={onRefresh}>
						<RotateCcwIcon class="size-3.5" />
						{copy.refreshDiscover}
					</Button>
				{/if}
			{/snippet}
		</InlineNotice>
	{/if}

	{#if loading && opportunities.length === 0}
		<div class="space-y-3" role="status" aria-label={copy.loadingOpportunities}>
			{#each Array(3) as _}
				<div class="rounded-lg border p-4">
					<Skeleton class="h-4 w-2/3" />
					<Skeleton class="mt-3 h-3 w-full" />
					<Skeleton class="mt-2 h-3 w-4/5" />
					<Skeleton class="mt-4 h-8 w-36" />
				</div>
			{/each}
		</div>
	{:else if opportunities.length === 0}
		<EmptyState
			icon={LightbulbIcon}
			title={copy.discoverEmptyTitle}
			description={copy.discoverEmptyDescription}
			actionLabel={onRefresh ? copy.refreshDiscover : undefined}
			onAction={onRefresh}
			variant="muted"
		/>
	{:else}
		<div class="space-y-3" data-testid="post-builder-opportunities">
			{#each opportunities as opportunity (opportunity.id)}
				{@const selected = opportunity.id === selectedOpportunityId}
				<article
					class={`rounded-lg border bg-card p-4 transition-colors ${selected ? 'border-primary bg-primary/[0.03]' : ''}`}
					aria-current={selected ? 'true' : undefined}
				>
					<div class="flex items-start gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<h3 class="text-sm leading-5 font-semibold">{opportunity.title}</h3>
								{#if opportunity.sourceURL && opportunity.sourceLabel}
									<a
										href={opportunity.sourceURL}
										target="_blank"
										rel="noreferrer"
										class="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
									>
										{opportunity.sourceLabel}
										<ExternalLinkIcon class="size-3" />
									</a>
								{/if}
							</div>
							<p class="mt-1.5 text-sm leading-6 text-muted-foreground">{opportunity.summary}</p>
						</div>
						{#if selected}
							<span
								class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
								aria-label={copy.selectedOpportunity}
							>
								<CheckIcon class="size-4" />
							</span>
						{/if}
					</div>

					{#if opportunity.whyRelevant}
						<div class="mt-3 border-t pt-3">
							<p class="text-xs font-medium text-foreground">{copy.whyThisFits}</p>
							<p class="mt-1 text-xs leading-5 text-muted-foreground">{opportunity.whyRelevant}</p>
						</div>
					{/if}

					{#if opportunity.angles?.length || opportunity.treatments?.length}
						<div class="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
							{#if opportunity.angles?.length}
								<div>
									<p class="text-xs font-medium">{copy.possibleAngles}</p>
									<div class="mt-1.5 flex flex-wrap gap-1.5">
										{#each opportunity.angles.slice(0, 3) as angle (angle.id)}
											{@const angleSelected = selected && angle.id === selectedOpportunityAngleId}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class={`h-auto min-h-8 border border-border px-2 py-1 text-left text-xs leading-4 whitespace-normal text-muted-foreground hover:border-primary/50 hover:text-foreground ${angleSelected ? 'border-primary bg-primary/10 text-primary' : ''}`}
												disabled={disabled || !onSelectAngle}
												onclick={() => onSelectAngle?.(opportunity, angle)}
												aria-label={`${angleSelected ? copy.selectedAngle : copy.chooseAngle}: ${angle.label}`}
											>
												{angle.label}
											</Button>
										{/each}
									</div>
								</div>
							{/if}
							{#if opportunity.treatments?.length}
								<div>
									<p class="text-xs font-medium">{copy.recommendedTreatment}</p>
									<ul class="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
										{#each opportunity.treatments.slice(0, 3) as treatment (`${treatment.platform}:${treatment.label}`)}
											<li>
												<span class="font-medium text-foreground">{treatment.platform}:</span>
												{treatment.label}
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}

					<div class="mt-4 flex justify-end">
						<Button
							type="button"
							variant={selected ? 'secondary' : 'outline'}
							size="sm"
							{disabled}
							onclick={() => onSelect(opportunity)}
						>
							{selected ? copy.selectedOpportunity : copy.selectOpportunity}
							{#if !selected}<ArrowRightIcon class="size-3.5" />{/if}
						</Button>
					</div>
				</article>
			{/each}
		</div>

		{#if hasMore && onLoadMore}
			<div class="flex justify-center pt-1">
				<Button type="button" variant="ghost" size="sm" disabled={loading} onclick={onLoadMore}>
					{copy.loadMoreOpportunities}
				</Button>
			</div>
		{/if}
	{/if}
</section>
