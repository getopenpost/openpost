<script lang="ts">
	import { ArrowLeft, ArrowRight, LockKeyhole } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { appUrl } from '../../_marketing';

	interface Props {
		eyebrow?: string;
		title: string;
		description: string;
		audience: string;
		inputs: readonly string[];
		outputs: readonly string[];
		limits: readonly string[];
		privacyBehavior: string;
		nextStep: string;
		children: Snippet;
	}

	let {
		eyebrow = 'Free tool',
		title,
		description,
		audience,
		inputs,
		outputs,
		limits,
		privacyBehavior,
		nextStep,
		children
	}: Props = $props();
</script>

<section class="border-b">
	<div class="marketing-shell py-8 sm:py-10">
		<a
			href="/tools"
			class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			All free tools
		</a>
		<div class="mt-4 max-w-4xl">
			<p class="section-label">{eyebrow}</p>
			<h1
				class="mt-3 text-3xl leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-5xl"
			>
				{title}
			</h1>
			<p class="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
				{description}
			</p>
			<p class="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
				<LockKeyhole class="size-4 text-primary" />
				{privacyBehavior}
			</p>
		</div>
	</div>

	<div
		class="marketing-shell grid gap-6 pb-10 sm:grid-cols-2 lg:grid-cols-3"
		data-agent-include="tool-explanation"
	>
		<section>
			<h2 class="text-lg font-semibold">Who this is for</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">{audience}</p>
		</section>
		<section>
			<h2 class="text-lg font-semibold">Inputs</h2>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
				{#each inputs as input (input)}<li>{input}</li>{/each}
			</ul>
		</section>
		<section>
			<h2 class="text-lg font-semibold">Outputs</h2>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
				{#each outputs as output (output)}<li>{output}</li>{/each}
			</ul>
		</section>
		<section>
			<h2 class="text-lg font-semibold">Limits</h2>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
				{#each limits as limit (limit)}<li>{limit}</li>{/each}
			</ul>
		</section>
		<section>
			<h2 class="text-lg font-semibold">Privacy</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">{privacyBehavior}</p>
		</section>
		<section>
			<h2 class="text-lg font-semibold">Next step</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">{nextStep}</p>
		</section>
	</div>

	<div class="marketing-shell pb-14 sm:pb-20" data-agent-exclude="interactive-tool">
		{@render children()}
	</div>

	<div class="border-t bg-muted/25" data-agent-exclude="application-cta">
		<div
			class="marketing-shell flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<h2 class="font-semibold">Ready to schedule the result?</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					Open the full composer when you want accounts, media, and delivery in one place.
				</p>
			</div>
			<Button href={appUrl} variant="outline">
				Open OpenPost
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
	</div>
</section>
