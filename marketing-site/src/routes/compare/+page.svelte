<script lang="ts">
	import { ArrowRight, Waypoints } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { comparisons, managedSignupUrl, selfHostingDocsUrl, siteUrl } from '../_marketing';
</script>

<svelte:head>
	<title>Compare OpenPost with social scheduling tools</title>
	<meta
		name="description"
		content="Compare OpenPost with Buffer, Hootsuite, Typefully, Postiz, Post Bridge, and Mixpost using current official product sources."
	/>
	<link rel="canonical" href={`${siteUrl}/compare`} />
</svelte:head>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[1fr_20rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="section-label">Compare</p>
				<h1 class="marketing-title mt-5">Choose the workflow you actually need.</h1>
				<p class="marketing-copy mt-6">
					OpenPost is built for drafting once, adapting by destination, reviewing the final result,
					and publishing from a visible queue. Other products lead in writing, social care,
					listening, or enterprise governance. These guides make that tradeoff clear.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">Try the managed app</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-host OpenPost</Button>
				</div>
			</div>
			<div class="border-l pl-6">
				<Waypoints class="size-5 text-primary" />
				<p class="mt-4 font-semibold">Reviewed 26 July 2026</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Each factual claim links to an official pricing, product, API, or help page.
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
				<h2 class="mt-4 text-3xl font-semibold text-balance">Start with your hard requirement.</h2>
				<p class="mt-4 leading-7 text-muted-foreground">
					Every guide states where the other product is a better fit. Plans and features can change
					after the review date.
				</p>
			</div>
			<div class="divide-y border-y">
				{#each comparisons as comparison (comparison.slug)}
					<a
						href={`/compare/${comparison.slug}`}
						class="group grid gap-3 py-6 transition sm:grid-cols-[minmax(11rem,0.55fr)_1.45fr_auto] sm:items-center"
					>
						<div>
							<h3 class="font-semibold">OpenPost vs {comparison.name}</h3>
							<p class="mt-1 text-xs text-primary">{comparison.category}</p>
						</div>
						<p class="text-sm leading-6 text-muted-foreground">
							{comparison.bestFor}
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
			<h2 class="mt-4 text-3xl font-semibold text-balance">Facts first, fit second.</h2>
			<p class="mt-6 text-sm text-muted-foreground">No affiliate links.</p>
		</div>
		<div class="grid gap-5 sm:grid-cols-3">
			<div>
				<p class="font-semibold">Official sources</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Pricing, docs, help centers, and source repositories—not affiliate summaries.
				</p>
			</div>
			<div>
				<p class="font-semibold">Unknown stays unknown</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					We avoid unsupported claims about reliability, support quality, or unpublished limits.
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
