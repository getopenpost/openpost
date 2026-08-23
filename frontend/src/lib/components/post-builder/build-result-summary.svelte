<script lang="ts">
	import AlertCircleIcon from '@lucide/svelte/icons/circle-alert';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import type {
		PostBuilderClaim,
		PostBuilderCopy,
		PostBuilderMediaPlanItem,
		PostBuilderResult
	} from '$lib/post-builder';

	interface Props {
		result: PostBuilderResult;
		copy: PostBuilderCopy;
		committing?: boolean;
		mediaActionId?: string;
		onCommit: () => void;
		onMediaAction?: (item: PostBuilderMediaPlanItem) => void;
	}

	let {
		result,
		copy,
		committing = false,
		mediaActionId = '',
		onCommit,
		onMediaAction
	}: Props = $props();

	const claimsNeedingReview = $derived(
		(result.claims ?? []).filter((claim) => claim.status !== 'verified')
	);

	function claimLabel(claim: PostBuilderClaim): string {
		if (claim.status === 'verified') return copy.verified;
		if (claim.status === 'unsupported') return copy.unsupported;
		return copy.needsReview;
	}

	function destinationStatusClass(
		status: PostBuilderResult['destinationDecisions'][number]['status']
	): string {
		if (status === 'included') return 'text-emerald-700 dark:text-emerald-300';
		if (status === 'needs_review') return 'text-amber-700 dark:text-amber-300';
		return 'text-muted-foreground';
	}

	function mediaActionLabel(item: PostBuilderMediaPlanItem): string {
		return item.action === 'meme' ? copy.makeMeme : copy.createVisual;
	}
</script>

<section
	class="rounded-lg border bg-card"
	aria-labelledby="post-builder-result-heading"
	data-testid="post-builder-result"
>
	<div class="flex items-start gap-3 border-b p-4 sm:p-5">
		<span
			class="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
		>
			<CheckCircleIcon class="size-5" aria-hidden="true" />
		</span>
		<div class="min-w-0 flex-1">
			<h2 id="post-builder-result-heading" class="text-base font-semibold tracking-tight">
				{copy.resultHeading}
			</h2>
			<p class="mt-1 text-sm leading-5 text-muted-foreground">{copy.resultDescription}</p>
		</div>
	</div>

	<div class="space-y-5 p-4 sm:p-5">
		<div>
			<p class="text-xs font-medium text-muted-foreground">{copy.coreThesis}</p>
			<p class="mt-1 max-w-3xl text-sm leading-6 font-medium">{result.thesis}</p>
		</div>

		{#if result.angle || result.goal || result.audience || result.voiceLabel}
			<dl class="grid gap-x-5 gap-y-3 border-t pt-4 sm:grid-cols-2">
				{#if result.angle}
					<div>
						<dt class="text-xs text-muted-foreground">{copy.angle}</dt>
						<dd class="mt-0.5 text-sm font-medium">{result.angle}</dd>
					</div>
				{/if}
				{#if result.goal}
					<div>
						<dt class="text-xs text-muted-foreground">{copy.goal}</dt>
						<dd class="mt-0.5 text-sm font-medium">{result.goal}</dd>
					</div>
				{/if}
				{#if result.audience}
					<div>
						<dt class="text-xs text-muted-foreground">{copy.audience}</dt>
						<dd class="mt-0.5 text-sm font-medium">{result.audience}</dd>
					</div>
				{/if}
				{#if result.voiceLabel}
					<div>
						<dt class="text-xs text-muted-foreground">{copy.voiceUsed}</dt>
						<dd class="mt-0.5 text-sm font-medium">{result.voiceLabel}</dd>
					</div>
				{/if}
			</dl>
		{/if}

		{#if result.destinationDecisions.length > 0}
			<div class="border-t pt-4">
				<h3 class="text-sm font-semibold">{copy.destinationPlan}</h3>
				<ul class="mt-2 divide-y rounded-md border" aria-label={copy.destinationPlan}>
					{#each result.destinationDecisions as decision (`${decision.accountId}:${decision.status}`)}
						<li class="flex items-start gap-2.5 px-3 py-2.5">
							<span
								class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted"
							>
								<PlatformIcon platform={decision.platform} class="size-4" />
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
									<p class="text-sm font-medium">{decision.accountLabel}</p>
									<span class={`text-xs ${destinationStatusClass(decision.status)}`}>
										{decision.status === 'included'
											? copy.included
											: decision.status === 'skipped'
												? copy.skipped
												: copy.needsReview}
									</span>
								</div>
								{#if decision.formatLabel || decision.reason || decision.mediaTreatment}
									<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
										{[decision.formatLabel, decision.reason, decision.mediaTreatment]
											.filter(Boolean)
											.join(' · ')}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="grid gap-5 border-t pt-4 md:grid-cols-2">
			<div>
				<h3 class="flex items-center gap-2 text-sm font-semibold">
					<AlertCircleIcon class="size-4 text-muted-foreground" aria-hidden="true" />
					{copy.claimReview}
				</h3>
				{#if claimsNeedingReview.length === 0}
					<p class="mt-2 flex items-center gap-2 text-xs leading-5 text-muted-foreground">
						<CheckIcon class="size-3.5 text-emerald-700 dark:text-emerald-300" />
						{copy.noClaimsNeedReview}
					</p>
				{:else}
					<ul class="mt-2 space-y-2">
						{#each claimsNeedingReview as claim (claim.id)}
							<li class="text-xs leading-5">
								<p>{claim.text}</p>
								<p
									class="text-muted-foreground"
									class:text-destructive={claim.status === 'unsupported'}
								>
									{claimLabel(claim)}{claim.sourceLabel ? ` · ${claim.sourceLabel}` : ''}
								</p>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if result.mediaPlan?.length}
				<div>
					<h3 class="text-sm font-semibold">{copy.mediaPlan}</h3>
					<ul class="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
						{#each result.mediaPlan as item (item.id)}
							<li class="flex items-start justify-between gap-3">
								<span class="min-w-0">
									{item.platform ? `${item.platform}: ` : ''}{item.label}
								</span>
								{#if item.action && onMediaAction}
									<Button
										type="button"
										variant="outline"
										size="sm"
										class="h-7 shrink-0 px-2 text-xs"
										disabled={committing}
										onclick={() => onMediaAction?.(item)}
									>
										{#if mediaActionId === item.id}
											<LoaderIcon class="size-3.5 animate-spin motion-reduce:animate-none" />
											{copy.preparingMedia}
										{:else}
											{mediaActionLabel(item)}
										{/if}
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</div>

	<div class="flex justify-end border-t p-4 sm:p-5">
		<Button type="button" size="lg" disabled={committing} onclick={onCommit}>
			{#if committing}
				<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
				{copy.openingComposer}
			{:else}
				{copy.reviewInComposer}
			{/if}
		</Button>
	</div>
</section>
