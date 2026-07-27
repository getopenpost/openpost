<script lang="ts">
	import { ArrowRight } from 'lucide-svelte';
	import PageHero from '../_components/PageHero.svelte';
	import { siteUrl, tools } from '../_marketing';

	const outcomes: Record<string, string> = {
		'multi-platform-character-counter': 'Compare 9 limits',
		'post-preview-generator': 'Preview 6 layouts',
		'thread-splitter': 'Split without losing text',
		'fediverse-handle-checker': 'Syntax + optional live check',
		'linkedin-text-formatter': 'Readable plain-text structure',
		'best-time-to-post-calculator': 'Local schedule + CSV export'
	};
</script>

<svelte:head>
	<title>Free social media tools - OpenPost</title>
	<meta
		name="description"
		content="Free browser-based social media tools for counting characters, previewing posts, splitting threads, checking handles, formatting LinkedIn copy, and planning a weekly cadence."
	/>
	<link rel="canonical" href={`${siteUrl}/tools`} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Free social media tools - OpenPost" />
	<meta
		property="og:description"
		content="Practical browser-based tools for writing, checking, previewing, and planning social posts."
	/>
	<meta property="og:url" content={`${siteUrl}/tools`} />
	<meta property="og:image" content={`${siteUrl}/assets/brand/og-image.png`} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<PageHero
	eyebrow="Free tools"
	title="Write, check, and plan a better social post."
	description="Count, preview, split, validate, format, and plan in your browser. Each tool does one job and works without an account."
	secondaryHref="/pricing"
	secondaryLabel="Compare plans"
/>

<section class="section-pad">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="mb-8 max-w-2xl">
			<h2 class="text-2xl font-semibold sm:text-3xl">Choose the job you need to finish</h2>
			<p class="mt-3 leading-7 text-muted-foreground">
				Drafts stay in your browser. The handle checker makes a network request only when you ask
				for a live result.
			</p>
		</div>
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
		{#each tools as tool (tool.slug)}
			{@const Icon = tool.icon}
			<a
				href={`/tools/${tool.slug}`}
				class="group flex min-h-64 flex-col rounded-xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
			>
				<div class="flex items-start justify-between gap-4">
					<div class="flex size-10 items-center justify-center rounded-xl border bg-background">
						<Icon class="size-5 text-primary" />
					</div>
					<ArrowRight class="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
				</div>
				<h2 class="mt-5 font-semibold">{tool.name}</h2>
				<p class="mt-3 text-sm leading-6 text-muted-foreground">{tool.description}</p>
				<p class="mt-auto pt-5 text-sm font-medium text-primary">{outcomes[tool.slug] ?? 'Try the tool'}</p>
			</a>
		{/each}
		</div>
	</div>
</section>
