<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import type { AIGenerationPhase, AIGenerationProgressCopy } from './ai-workspace-types';

	interface Props {
		phases: AIGenerationPhase[];
		copy: AIGenerationProgressCopy;
		message?: string;
		active?: boolean;
	}

	let { phases, copy, message = '', active = false }: Props = $props();

	const uid = $props.id();
</script>

<section
	class="mx-auto w-full max-w-2xl py-4 sm:py-8"
	aria-labelledby={`${uid}-heading`}
	aria-live="polite"
	aria-busy={active}
	data-testid="ai-generation-progress"
>
	<div class="space-y-1 text-center">
		{#if active}
			<LoaderIcon
				class="mx-auto mb-3 size-5 animate-spin text-primary motion-reduce:animate-none"
				aria-hidden="true"
			/>
		{/if}
		<h2 id={`${uid}-heading`} class="text-base font-semibold tracking-tight">
			{copy.heading}
		</h2>
		<p class="text-sm leading-6 text-muted-foreground">{message || copy.description}</p>
	</div>

	<ol class="mt-6 divide-y rounded-lg border bg-card">
		{#each phases as phase (phase.id)}
			<li
				class={`flex min-h-14 items-center gap-3 px-4 py-3 text-sm ${phase.status === 'active' ? 'bg-muted/20' : ''}`}
				class:text-muted-foreground={phase.status === 'pending'}
				aria-current={phase.status === 'active' ? 'step' : undefined}
			>
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full border"
					class:border-primary={phase.status !== 'pending'}
					class:bg-primary={phase.status === 'complete'}
					class:text-primary-foreground={phase.status === 'complete'}
					class:text-primary={phase.status === 'active'}
					aria-hidden="true"
				>
					{#if phase.status === 'complete'}
						<CheckIcon class="size-3.5" />
					{:else if phase.status === 'active'}
						<span class="size-2 rounded-full bg-primary"></span>
					{/if}
				</span>
				<span class:font-medium={phase.status === 'active'}>{phase.label}</span>
			</li>
		{/each}
	</ol>
</section>
