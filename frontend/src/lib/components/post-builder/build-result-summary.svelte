<script lang="ts">
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import type {
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
		onReset?: () => void;
		onMediaAction?: (item: PostBuilderMediaPlanItem) => void;
	}

	let {
		result,
		copy,
		committing = false,
		mediaActionId = '',
		onCommit,
		onReset,
		onMediaAction
	}: Props = $props();

	function destinationStatusClass(
		status: PostBuilderResult['destinationDecisions'][number]['status']
	): string {
		if (status === 'included') return 'text-emerald-700 dark:text-emerald-300';
		if (status === 'needs_review') return 'text-amber-700 dark:text-amber-300';
		return 'text-muted-foreground';
	}

	function mediaActionLabel(item: PostBuilderMediaPlanItem): string {
		if (item.action === 'meme') return copy.makeMeme;
		if (item.action === 'video_editor') {
			return item.treatment === 'edit_existing_video' ? copy.editVideo : copy.createVideo;
		}
		return item.treatment === 'annotate_source' ? copy.annotateSource : copy.createVisual;
	}

	function planTerm(value: string | undefined): string | undefined {
		return value?.trim().replaceAll('_', ' ') || undefined;
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
								{#if decision.preview}
									<p class="mt-1 line-clamp-2 text-sm leading-5 break-words">
										{decision.preview}
									</p>
								{/if}
								{#if decision.formatLabel || decision.objective || decision.archetype}
									<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
										{[
											decision.formatLabel,
											planTerm(decision.objective),
											planTerm(decision.archetype)
										]
											.filter(Boolean)
											.join(' · ')}
									</p>
								{/if}
								{#if decision.reason}
									<p class="mt-1 text-xs leading-5 text-muted-foreground">{decision.reason}</p>
								{/if}
								{#if decision.mediaTreatment}
									<p class="mt-1 text-xs leading-5 text-muted-foreground">
										<span class="font-medium text-foreground">{copy.mediaPlan}:</span>
										{planTerm(decision.mediaTreatment)}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if result.mediaPlan?.length}
			<div class="border-t pt-4">
				<h3 class="text-sm font-semibold">{copy.mediaPlan}</h3>
				<ul class="mt-2 divide-y rounded-md border text-xs leading-5">
					{#each result.mediaPlan as item (item.id)}
						<li class="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
							<span class="min-w-0">
								<span class="text-foreground"
									>{item.platform ? `${item.platform}: ` : ''}{item.label}</span
								>
								{#if item.sourceLabel}
									<span class="mt-0.5 block text-[11px] text-muted-foreground"
										>{item.sourceLabel}</span
									>
								{/if}
							</span>
							{#if item.action && onMediaAction}
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="h-11 shrink-0 self-start px-2 text-xs md:h-8"
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

	<div class="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end sm:p-5">
		{#if onReset}
			<Button type="button" variant="ghost" disabled={committing} onclick={onReset}>
				{copy.buildAnother}
			</Button>
		{/if}
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
