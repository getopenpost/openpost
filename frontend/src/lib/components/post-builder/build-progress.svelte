<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import {
		postBuilderRunProgress,
		type PostBuilderCopy,
		type PostBuilderRun
	} from '$lib/post-builder';

	interface Props {
		run: PostBuilderRun;
		copy: PostBuilderCopy;
		cancelling?: boolean;
		onCancel?: () => void;
	}

	let { run, copy, cancelling = false, onCancel }: Props = $props();

	const progress = $derived(postBuilderRunProgress(run));
	const steps = $derived(copy.whatHappensSteps);
	const currentStep = $derived(
		run.phase === 'queued' || run.phase === 'understanding'
			? 0
			: run.phase === 'planning'
				? 1
				: run.phase === 'drafting'
					? 2
					: 3
	);
</script>

<section
	class="rounded-lg border bg-muted/20 p-4 sm:p-5"
	aria-labelledby="post-builder-progress-heading"
	aria-live="polite"
	data-testid="post-builder-progress"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<LoaderIcon
					class="size-4 animate-spin text-primary motion-reduce:animate-none"
					aria-hidden="true"
				/>
				<h2 id="post-builder-progress-heading" class="text-sm font-semibold">
					{copy.buildProgressHeading}
				</h2>
			</div>
			<p class="mt-1 text-sm leading-5 text-muted-foreground">
				{run.message || steps[currentStep]}
			</p>
		</div>
		{#if onCancel && run.canCancel !== false}
			<Button type="button" variant="ghost" size="sm" disabled={cancelling} onclick={onCancel}>
				{cancelling ? `${copy.cancelBuild}…` : copy.cancelBuild}
			</Button>
		{/if}
	</div>

	<div class="mt-4">
		<div
			class="h-1.5 overflow-hidden rounded-full bg-muted"
			role="progressbar"
			aria-label={copy.buildProgressHeading}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={progress}
		>
			<div
				class="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
				style={`width: ${progress}%`}
			></div>
		</div>
		<p class="mt-1.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
			{progress}%
		</p>
	</div>

	<ol class="mt-4 grid gap-2 sm:grid-cols-2">
		{#each steps as step, index (step)}
			<li
				class="flex min-h-9 items-center gap-2 rounded-md px-2 text-xs"
				class:bg-background={index === currentStep}
				class:text-muted-foreground={index > currentStep}
			>
				<span
					class="flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium"
					class:border-primary={index <= currentStep}
					class:bg-primary={index < currentStep}
					class:text-primary-foreground={index < currentStep}
					class:text-primary={index === currentStep}
				>
					{#if index < currentStep}<CheckIcon class="size-3" />{:else}{index + 1}{/if}
				</span>
				<span class="leading-4">{step}</span>
			</li>
		{/each}
	</ol>
</section>
