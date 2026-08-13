<script lang="ts">
	import { ArrowLeft, ArrowRight, LockKeyhole } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { appUrl } from '../../_marketing';

	interface Props {
		eyebrow?: string;
		title: string;
		description: string;
		privacyNote?: string;
		children: Snippet;
	}

	let {
		eyebrow = 'Free tool',
		title,
		description,
		privacyNote = 'Your draft stays in this browser. Nothing is uploaded.',
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
				{privacyNote}
			</p>
		</div>
	</div>

	<div class="marketing-shell pb-14 sm:pb-20">
		{@render children()}
	</div>

	<div class="border-t bg-muted/25">
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
