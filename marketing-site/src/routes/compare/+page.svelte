<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowRight, Waypoints } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { comparisons, managedSignupUrl, selfHostingDocsUrl } from '../_marketing';

	const evidenceReview = comparisons[0];

	function formatDate(value: string) {
		return new Intl.DateTimeFormat('en', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${value}T00:00:00Z`));
	}
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[1fr_20rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="section-label">Compare</p>
				<h1 class="marketing-title mt-5">Choose the tool that fits your work.</h1>
				<p class="mt-5 text-sm font-medium text-foreground">
					This page is for founders and teams comparing social publishing tools.
				</p>
				<p class="marketing-copy mt-6">
					OpenPost lets you write once, tailor each account version, review it, and schedule it.
					Other products may offer stronger writing, customer care, social listening, or
					large-company controls. These guides show the differences.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">Try OpenPost</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-host OpenPost</Button>
				</div>
			</div>
			<div class="border-l pl-6">
				<Waypoints class="size-5 text-primary" />
				<p class="mt-4 font-semibold">Reviewed {formatDate(evidenceReview.reviewedAt)}</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Each factual claim links to an official pricing, product, API, or help page. Recheck by {formatDate(
						evidenceReview.reviewDueAt
					)}.
				</p>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[18rem_1fr]">
			<div>
				<p class="section-label">Product guides</p>
				<h2 class="mt-4 text-3xl font-semibold text-balance">Start with what you need most.</h2>
				<p class="mt-4 leading-7 text-muted-foreground">
					Every guide states where the other product is a better fit. Plans and features can change
					after the review date.
				</p>
			</div>
			<div class="divide-y border-y">
				{#each comparisons as comparison (comparison.slug)}
					<a
						href={resolve(`/compare/${comparison.slug}`)}
						class="group grid gap-3 py-6 transition sm:grid-cols-[minmax(11rem,0.55fr)_1.45fr_auto] sm:items-center"
					>
						<div>
							<h3 class="font-semibold">OpenPost vs {comparison.name}</h3>
							<p class="mt-1 text-xs text-primary">{comparison.category}</p>
						</div>
						<p class="text-sm leading-6 text-muted-foreground">
							{comparison.bestFor}
						</p>
						<p class="font-mono text-xs text-muted-foreground">
							Reviewed {formatDate(comparison.reviewedAt)} · Recheck by {formatDate(
								comparison.reviewDueAt
							)}
						</p>
						<ArrowRight
							class="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
						/>
					</a>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad border-t bg-muted/20">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[0.65fr_1.35fr]">
		<div>
			<p class="section-label">Method</p>
			<h2 class="mt-4 text-3xl font-semibold text-balance">Check the facts, then choose.</h2>
			<p class="mt-6 text-sm text-muted-foreground">No affiliate links.</p>
		</div>
		<div class="grid gap-5 sm:grid-cols-3">
			<div>
				<p class="font-semibold">Official sources</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					We use official pricing, docs, help centers, and source code.
				</p>
			</div>
			<div>
				<p class="font-semibold">Unknown stays unknown</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					We do not guess about reliability, support quality, or private limits.
				</p>
			</div>
			<div>
				<p class="font-semibold">Dated reviews</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Every guide shows its review date so you know when to check the linked source again.
				</p>
			</div>
		</div>
	</div>
</section>
