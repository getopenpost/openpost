<script lang="ts">
	import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-svelte';
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
	<div class="mx-auto max-w-7xl px-4 pt-14 pb-8 sm:px-6 sm:pt-20 sm:pb-10 lg:px-8">
		<a
			href="/tools"
			class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground md:min-h-0"
		>
			<ArrowLeft class="size-4" />
			All free tools
		</a>
		<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
			<div>
				<p class="eyebrow">{eyebrow}</p>
				<h1 class="mt-3 max-w-4xl text-4xl leading-tight font-semibold text-balance sm:text-6xl">
					{title}
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{description}</p>
				<p class="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
					<LockKeyhole class="size-4 text-primary" />
					{privacyNote}
				</p>
			</div>
			<Button href={appUrl} variant="outline" size="lg" class="w-fit">
				Open OpenPost
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
	</div>

	<div class="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
		{@render children()}
	</div>
</section>
