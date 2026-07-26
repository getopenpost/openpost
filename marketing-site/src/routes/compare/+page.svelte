<script lang="ts">
	import { ArrowRight, Bot, Building2, Feather, Server, Waypoints } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		comparisons,
		managedSignupUrl,
		selfHostingDocsUrl,
		siteUrl
	} from '../_marketing';

	const routes = [
		{
			title: 'I want the strongest writing experience',
			detail: 'Start with Typefully, then compare the publishing and ownership model.',
			href: '/compare/typefully',
			icon: Feather
		},
		{
			title: 'I need analytics, inbox, or listening',
			detail: 'Start with Buffer or Hootsuite for analytics, engagement, and listening.',
			href: '/compare/hootsuite',
			icon: Building2
		},
		{
			title: 'I want agent-assisted publishing with a smaller runtime',
			detail: 'Postiz is the broader AI suite; OpenPost focuses on human-reviewed publishing and a visible queue.',
			href: '/compare/postiz',
			icon: Bot
		},
		{
			title: 'Self-hosting is the main requirement',
			detail: 'Compare OpenPost’s compact server with Mixpost’s Laravel-first product.',
			href: '/compare/mixpost',
			icon: Server
		}
	] as const;
</script>

<svelte:head>
	<title>Compare OpenPost with social scheduling tools</title>
	<meta
		name="description"
		content="Compare OpenPost with Buffer, Hootsuite, Typefully, Postiz, Post Bridge, and Mixpost using current official product sources."
	/>
	<link rel="canonical" href={`${siteUrl}/compare`} />
</svelte:head>

<section class="border-b py-14 sm:py-18 lg:py-24">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="eyebrow">Compare</p>
				<h1 class="mt-4 text-4xl leading-[1.03] font-semibold text-balance sm:text-6xl">
					Compare the publishing model, not just the platform count.
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
					OpenPost sits between AI agents and social accounts with revocable workspace access,
					destination renditions, human review, and a visible queue. Some alternatives are better
					at writing, analytics, engagement, network breadth, or enterprise governance. These guides say so.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">Try the managed app</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-host OpenPost</Button>
				</div>
			</div>
			<div class="rounded-xl border bg-card p-6">
				<Waypoints class="size-5 text-primary" />
				<p class="mt-4 font-semibold">Reviewed 22 July 2026</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Competitor facts link to official pricing, product, API, or help pages. Plans and features can change after review.
				</p>
			</div>
		</div>
	</div>
</section>

<section class="section-pad border-b">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="max-w-3xl">
			<p class="eyebrow">Start with the hard requirement</p>
			<h2 class="mt-4 text-3xl leading-tight font-semibold text-balance sm:text-5xl">
				A short path to the relevant comparison.
			</h2>
		</div>
		<div class="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-2">
			{#each routes as route (route.title)}
				{@const Icon = route.icon}
				<a href={route.href} class="group bg-card p-6 transition hover:bg-muted/25">
					<div class="flex items-start justify-between gap-5">
						<Icon class="size-5 text-primary" />
						<ArrowRight class="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
					</div>
					<h3 class="mt-5 text-lg font-semibold">{route.title}</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">{route.detail}</p>
				</a>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[15rem_1fr]">
			<div>
				<p class="eyebrow">All comparisons</p>
				<h2 class="mt-4 text-3xl font-semibold text-balance">Six different product choices</h2>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					Each page records that product’s current strengths, product model, and tradeoffs.
				</p>
			</div>
			<div class="divide-y rounded-xl border bg-card">
				{#each comparisons as comparison, index (comparison.slug)}
					<a
						href={`/compare/${comparison.slug}`}
						class="group grid gap-4 p-5 transition hover:bg-muted/25 sm:grid-cols-[2.5rem_minmax(10rem,0.55fr)_1.45fr_auto] sm:items-center"
					>
						<span class="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
						<div>
							<h3 class="font-semibold">OpenPost vs {comparison.name}</h3>
							<p class="mt-1 text-xs text-primary">{comparison.category}</p>
						</div>
						<p class="text-sm leading-6 text-muted-foreground">{comparison.bestFor}</p>
						<ArrowRight class="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
					</a>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad border-t bg-muted/20">
	<div class="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.65fr_1.35fr] lg:px-8">
		<div>
			<p class="eyebrow">Method</p>
			<h2 class="mt-4 text-3xl font-semibold text-balance">Facts first, fit second.</h2>
		</div>
		<div class="grid gap-5 sm:grid-cols-3">
			<div>
				<p class="font-semibold">Official sources</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">Pricing, docs, help centers, and source repositories—not affiliate summaries.</p>
			</div>
			<div>
				<p class="font-semibold">Unknown stays unknown</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">We avoid unsupported claims about reliability, support quality, or unpublished limits.</p>
			</div>
			<div>
				<p class="font-semibold">Dated reviews</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">Every guide shows its review date so you know when to check the linked source again.</p>
			</div>
		</div>
	</div>
</section>
