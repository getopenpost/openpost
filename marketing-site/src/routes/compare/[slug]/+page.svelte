<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Scale } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		comparisons,
		getComparison,
		managedSignupUrl,
		selfHostingDocsUrl,
		siteUrl
	} from '../../_marketing';

	const slug = $derived(page.params.slug ?? '');
	const comparison = $derived.by(() => {
		const found = getComparison(slug);
		if (!found) error(404, 'Comparison not found');
		return found;
	});
	const otherComparisons = $derived(comparisons.filter((item) => item.slug !== comparison.slug).slice(0, 3));
</script>

<svelte:head>
	<title>OpenPost vs {comparison.name}: an honest comparison</title>
	<meta name="description" content={`${comparison.verdict} Facts reviewed ${comparison.reviewedAt}.`} />
	<link rel="canonical" href={`${siteUrl}/compare/${comparison.slug}`} />
</svelte:head>

<section class="border-b py-14 sm:py-18 lg:py-24">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<a href="/compare" class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
			<ArrowLeft class="size-4" />
			All comparisons
		</a>
		<div class="mt-10 grid gap-10 lg:grid-cols-[1fr_24rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="eyebrow">{comparison.category}</p>
				<h1 class="mt-4 text-4xl leading-[1.03] font-semibold text-balance sm:text-6xl">
					OpenPost vs {comparison.name}
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{comparison.openPostAngle}</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">Try the managed app</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-host OpenPost</Button>
				</div>
			</div>
			<aside class="rounded-xl border bg-card p-6">
				<Scale class="size-5 text-primary" />
				<p class="mt-4 text-sm font-semibold">Bottom line</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">{comparison.verdict}</p>
				<p class="mt-5 border-t pt-4 font-mono text-xs text-muted-foreground">Reviewed {comparison.reviewedAt}</p>
			</aside>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
		<article class="rounded-xl border bg-card p-6 sm:p-8">
			<p class="eyebrow">Choose OpenPost when</p>
			<h2 class="mt-4 text-2xl font-semibold">The agent boundary and publishing state should stay inspectable.</h2>
			<ul class="mt-6 space-y-4">
				{#each comparison.chooseOpenPost as item (item)}
					<li class="flex gap-3 text-sm leading-6 text-muted-foreground">
						<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" />
						<span>{item}</span>
					</li>
				{/each}
			</ul>
		</article>
		<article class="rounded-xl border bg-muted/25 p-6 sm:p-8">
			<p class="eyebrow">Choose {comparison.name} when</p>
			<h2 class="mt-4 text-2xl font-semibold">{comparison.bestFor}</h2>
			<ul class="mt-6 space-y-4">
				{#each comparison.chooseThem as item (item)}
					<li class="flex gap-3 text-sm leading-6 text-muted-foreground">
						<ArrowRight class="mt-0.5 size-4 shrink-0" />
						<span>{item}</span>
					</li>
				{/each}
			</ul>
		</article>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="max-w-3xl">
			<p class="eyebrow">Side by side</p>
			<h2 class="mt-4 text-3xl leading-tight font-semibold text-balance sm:text-5xl">
				Compare the product areas that change the decision.
			</h2>
		</div>
		<div class="mt-10 overflow-x-auto rounded-xl border bg-card">
			<table class="w-full min-w-[48rem] border-collapse text-left">
				<thead class="border-b bg-background/70 text-sm">
					<tr>
						<th class="px-5 py-4 font-semibold" scope="col">Area</th>
						<th class="px-5 py-4 font-semibold" scope="col">OpenPost</th>
						<th class="px-5 py-4 font-semibold" scope="col">{comparison.name}</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each comparison.rows as row (row.area)}
						<tr>
							<th class="px-5 py-5 align-top font-medium" scope="row">{row.area}</th>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground">{row.openpost}</td>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground">{row.competitor}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
		<div>
			<p class="eyebrow">Pricing model</p>
			<h2 class="mt-4 text-3xl font-semibold text-balance">Compare what the price scales with.</h2>
		</div>
		<div>
			<p class="text-lg leading-8 text-muted-foreground">{comparison.pricing}</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href="/pricing">OpenPost plans</Button>
				{#each comparison.sources.slice(0, 1) as source (source.href)}
					<Button href={source.href} target="_blank" rel="noreferrer" variant="outline">
						{comparison.name} source
						<ExternalLink data-icon="inline-end" />
					</Button>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.7fr_1.3fr] lg:px-8">
		<div>
			<p class="eyebrow">Sources</p>
			<h2 class="mt-4 text-3xl font-semibold text-balance">Check the current product pages.</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				No affiliate links. Competitor facts were reviewed on {comparison.reviewedAt}; prices and features can change.
			</p>
		</div>
		<ul class="divide-y rounded-xl border bg-card">
			{#each comparison.sources as source (source.href)}
				<li>
					<a href={source.href} target="_blank" rel="noreferrer" class="group flex items-center justify-between gap-4 p-5 hover:bg-muted/25">
						<span class="font-medium">{source.label}</span>
						<ExternalLink class="size-4 text-muted-foreground group-hover:text-foreground" />
					</a>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
			<div>
				<p class="eyebrow">Keep comparing</p>
				<h2 class="mt-4 text-3xl font-semibold text-balance">Other tools worth checking</h2>
			</div>
			<a href="/compare" class="inline-flex items-center gap-2 text-sm font-medium text-primary">
				All comparisons <ArrowRight class="size-4" />
			</a>
		</div>
		<div class="mt-8 grid gap-4 md:grid-cols-3">
			{#each otherComparisons as item (item.slug)}
				<a href={`/compare/${item.slug}`} class="rounded-xl border bg-card p-5 transition hover:bg-muted/25">
					<p class="text-xs text-primary">{item.category}</p>
					<h3 class="mt-2 font-semibold">OpenPost vs {item.name}</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">{item.bestFor}</p>
				</a>
			{/each}
		</div>
	</div>
</section>
