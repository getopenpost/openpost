<script lang="ts">
	import { ProtectedIcon } from '$lib/themes/icons';
	import type { AIGenerationPhase, AIGenerationProgressCopy } from './ai-workspace-types';

	interface Props {
		phases: AIGenerationPhase[];
		copy: AIGenerationProgressCopy;
		message?: string;
		active?: boolean;
	}

	let { phases, copy, message = '', active = false }: Props = $props();

	const uid = $props.id();
	const activePhase = $derived(phases.find((phase) => phase.status === 'active'));
	const progressAnnouncement = $derived(
		message || activePhase?.label || (active ? copy.description : copy.heading)
	);
</script>

<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
	{progressAnnouncement}
</span>

<section
	class="mx-auto w-full max-w-2xl py-4 sm:py-8"
	aria-labelledby={`${uid}-heading`}
	aria-busy={active}
	data-testid="ai-generation-progress"
>
	<div class="space-y-1 text-center">
		{#if active}
			<ProtectedIcon
				icon="loading"
				class="mx-auto mb-3 size-5 animate-spin text-primary motion-reduce:animate-none"
			/>
		{/if}
		<h2 id={`${uid}-heading`} class="text-base font-semibold tracking-tight">
			{copy.heading}
		</h2>
		<p class="text-sm leading-6 text-muted-foreground">
			{message || copy.description}
		</p>
	</div>

	<ol class="mt-6 divide-y rounded-lg border bg-card">
		{#each phases as phase (phase.id)}
			<li
				class={`group flex min-h-14 items-center gap-3 px-4 py-3 text-sm transition-[background-color,color] duration-200 motion-reduce:transition-none ${phase.status === 'active' ? 'bg-muted/20' : ''}`}
				class:text-muted-foreground={phase.status === 'pending'}
				aria-current={phase.status === 'active' ? 'step' : undefined}
			>
				<span
					class={`flex size-6 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,transform] duration-200 motion-reduce:transition-none ${phase.status === 'complete' ? 'phase-complete' : ''}`}
					class:border-primary={phase.status !== 'pending'}
					class:bg-primary={phase.status === 'complete'}
					class:text-primary-foreground={phase.status === 'complete'}
					class:text-primary={phase.status === 'active'}
					aria-hidden="true"
				>
					{#if phase.status === 'complete'}
						<ProtectedIcon icon="success" class="size-3.5" />
					{:else if phase.status === 'active'}
						<span class="size-2 rounded-full bg-primary"></span>
					{/if}
				</span>
				<span class:font-medium={phase.status === 'active'}>{phase.label}</span>
			</li>
		{/each}
	</ol>
</section>

<style>
	.phase-complete {
		animation: phase-settle 260ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	@media (prefers-reduced-motion: reduce) {
		.phase-complete {
			animation: none;
		}
	}
	@keyframes phase-settle {
		0% {
			transform: scale(0.82);
		}
		70% {
			transform: scale(1.06);
		}
		100% {
			transform: scale(1);
		}
	}
</style>
