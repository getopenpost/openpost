<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '$lib/components/ui/button';
	import type { PostBuilderCopy, PostBuilderStarterIdea } from '$lib/post-builder';

	interface Props {
		copy: PostBuilderCopy;
		starterIdeas?: PostBuilderStarterIdea[];
		disabled?: boolean;
		onSelectStarter?: (idea: PostBuilderStarterIdea) => void;
		onLoadMoreStarterIdeas?: () => void;
	}

	let {
		copy,
		starterIdeas = [],
		disabled = false,
		onSelectStarter,
		onLoadMoreStarterIdeas
	}: Props = $props();
</script>

<aside class="space-y-3 lg:sticky lg:top-5 lg:self-start" aria-label={copy.builderHelpLabel}>
	<section class="rounded-lg border bg-card p-4" aria-labelledby="post-builder-will-heading">
		<h2 id="post-builder-will-heading" class="text-sm font-semibold">{copy.whatHappensHeading}</h2>
		<ol class="mt-3 space-y-3">
			{#each copy.whatHappensSteps as step, index (step)}
				<li class="flex items-start gap-3">
					<span
						class="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/35 bg-primary/5 text-xs font-semibold text-primary"
					>
						{index + 1}
					</span>
					<p class="pt-1 text-xs leading-5 font-medium">{step}</p>
				</li>
			{/each}
		</ol>
	</section>

	{#if starterIdeas.length > 0}
		<section
			class="rounded-lg border bg-card p-4"
			aria-labelledby="post-builder-inspiration-heading"
		>
			<div class="flex items-start gap-2.5">
				<LightbulbIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
				<div>
					<h2 id="post-builder-inspiration-heading" class="text-sm font-semibold">
						{copy.inspirationHeading}
					</h2>
					<p class="mt-1 text-xs leading-5 text-muted-foreground">{copy.inspirationDescription}</p>
				</div>
			</div>

			<div class="mt-3 space-y-2">
				{#each starterIdeas.slice(0, 4) as idea (idea.id)}
					<Button
						type="button"
						variant="ghost"
						class="h-auto min-h-11 w-full justify-start border border-border bg-background px-3 py-2 text-left text-xs leading-5 whitespace-normal hover:border-primary/50 hover:bg-primary/[0.03]"
						disabled={disabled || !onSelectStarter}
						onclick={() => onSelectStarter?.(idea)}
					>
						{idea.text}
					</Button>
				{/each}
			</div>

			{#if onLoadMoreStarterIdeas}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="mt-2 w-full text-muted-foreground"
					{disabled}
					onclick={onLoadMoreStarterIdeas}
				>
					<RotateCcwIcon class="size-3.5" />
					{copy.loadMoreIdeas}
				</Button>
			{/if}
		</section>
	{/if}
</aside>
