<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import EmptyState from '$lib/components/empty-state.svelte';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { AIAngle, AIAngleGridCopy } from './ai-workspace-types';

	interface Props {
		angles: AIAngle[];
		selectedId?: string;
		copy: AIAngleGridCopy;
		loading?: boolean;
		disabled?: boolean;
		onSelect: (angle: AIAngle) => void;
	}

	let {
		angles,
		selectedId = '',
		copy,
		loading = false,
		disabled = false,
		onSelect
	}: Props = $props();

	const uid = $props.id();

	function selectAngle(id: string): void {
		const angle = angles.find((candidate) => candidate.id === id);
		if (angle && angle.id !== selectedId) onSelect(angle);
	}
</script>

<section class="space-y-4" aria-labelledby={`${uid}-heading`}>
	<div class="space-y-1">
		<h2 id={`${uid}-heading`} class="text-base font-semibold tracking-tight">{copy.heading}</h2>
		<p class="max-w-3xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
	</div>

	{#if loading && angles.length === 0}
		<div
			class="grid gap-3 md:grid-cols-2"
			role="status"
			aria-label={copy.loading}
			aria-live="polite"
		>
			{#each Array(5) as _, index (index)}
				<div class="rounded-lg border p-4 {index === 0 ? 'md:col-span-2' : ''}">
					<Skeleton class="h-4 w-2/5" />
					<Skeleton class="mt-3 h-3 w-full" />
					<Skeleton class="mt-2 h-3 w-4/5" />
					<Skeleton class="mt-5 h-10 w-full" />
				</div>
			{/each}
		</div>
	{:else if angles.length === 0}
		<EmptyState
			icon={SparklesIcon}
			title={copy.emptyTitle}
			description={copy.emptyDescription}
			variant="muted"
		/>
	{:else}
		<RadioGroup.Root
			class="grid gap-3 md:grid-cols-2"
			value={selectedId}
			onValueChange={selectAngle}
			{disabled}
			aria-labelledby={`${uid}-heading`}
			data-testid="ai-angle-grid"
		>
			{#each angles as angle, index (angle.id)}
				{@const selected = angle.id === selectedId}
				<RadioGroup.Item
					id={`${uid}-angle-${index}`}
					class="peer sr-only"
					value={angle.id}
					{disabled}
					aria-label={angle.title}
				/>
				<label
					for={`${uid}-angle-${index}`}
					class={`relative block cursor-pointer rounded-lg border bg-card p-4 text-left transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:outline-none peer-disabled:pointer-events-none peer-disabled:opacity-50 hover:border-foreground/25 hover:bg-muted/15 ${selected ? 'border-primary bg-primary/3' : ''} ${angle.preservesCurrentAngle ? 'md:col-span-2' : ''}`}
				>
					<div class="flex items-start gap-3">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<h3 class="text-sm leading-5 font-semibold">{angle.title}</h3>
								{#if angle.recommended}
									<span class="text-xs font-medium text-primary">{copy.recommended}</span>
								{/if}
							</div>
							<p class="mt-1.5 text-sm leading-6 text-muted-foreground">{angle.premise}</p>
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

					{#if angle.objective || angle.evidence || angle.mediaRecommendation}
						<dl class="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-3">
							{#if angle.objective}
								<div>
									<dt class="text-muted-foreground">{copy.bestFor}</dt>
									<dd class="mt-0.5 font-medium">{angle.objective}</dd>
								</div>
							{/if}
							{#if angle.evidence}
								<div>
									<dt class="text-muted-foreground">{copy.evidence}</dt>
									<dd class="mt-0.5 font-medium">{angle.evidence}</dd>
								</div>
							{/if}
							<div>
								<dt class="text-muted-foreground">{copy.media}</dt>
								<dd class="mt-0.5 font-medium">
									{angle.mediaRecommendation || copy.noMedia}
								</dd>
							</div>
						</dl>
					{/if}
				</label>
			{/each}
		</RadioGroup.Root>
	{/if}
</section>
