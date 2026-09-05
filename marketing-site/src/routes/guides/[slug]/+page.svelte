<script lang="ts">
	import { resolve } from '$app/paths';
	import { marketingGuides } from '@openpost/social-images';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<article class="section-pad">
	<div class="marketing-shell">
		<div class="max-w-4xl">
			<a
				href={resolve('/guides')}
				class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-primary"
				>← All buying guides</a
			>
			<h1 class="marketing-title mt-5">{data.guide.question}</h1>
			<p class="mt-6 text-sm text-muted-foreground">
				By OpenPost · Reviewed <time datetime="2026-09-05">5 September 2026</time>
			</p>
			<p class="marketing-copy mt-7">{data.guide.answer}</p>
			<p class="mt-6 max-w-3xl text-sm leading-6 text-muted-foreground">
				We build OpenPost. This is our buying guidance, not an independent ranking. Competitor
				descriptions come from the linked sources.
			</p>
		</div>
		<div class="mt-12 grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
			<div class="max-w-3xl min-w-0">
				<aside class="border-y py-6" aria-label="OpenPost Hosted readiness">
					<h2 class="text-base font-semibold">Check Hosted readiness first</h2>
					<p class="mt-3 leading-7 text-muted-foreground">
						No posting option has passed OpenPost's final live check on Hosted yet. A listed
						integration does not prove it is ready for real accounts. Check your destination before
						relying on OpenPost for a launch.
					</p>
					<a
						href="https://docs.openpo.st/operations/provider-launch-matrix"
						class="focus-ring mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary"
						>Read current provider readiness →</a
					>
				</aside>
				{#each data.guide.sections as section, i (section.title)}
					<section id={`section-${i}`} class="mt-10 scroll-mt-28">
						<h2 class="text-2xl font-semibold tracking-tight">
							{section.title}
						</h2>
						<p class="mt-4 leading-7 text-muted-foreground">{section.text}</p>
						{#if section.items}
							<ul class="mt-4 list-disc space-y-3 pl-5 leading-7 text-muted-foreground">
								{#each section.items as item (item)}<li>{item}</li>{/each}
							</ul>
						{/if}
					</section>
				{/each}
				<section class="mt-10 border-t pt-7" aria-labelledby="sources-title">
					<h2 id="sources-title" class="text-xl font-semibold">Sources</h2>
					<ul class="mt-3">
						{#each data.guide.sources as source (source.href)}
							<li>
								<a
									href={source.href}
									class="focus-ring inline-flex min-h-11 items-center rounded-md py-2 text-primary underline underline-offset-4"
									>{source.label}</a
								>
							</li>
						{/each}
					</ul>
				</section>
				<div class="mt-8">
					<Button href={data.guide.next.href} size="lg">{data.guide.next.label}</Button>
				</div>
			</div>
			<nav
				aria-label="More buying guides"
				class="self-start border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"
			>
				<h2 class="text-sm font-semibold">More buying guides</h2>
				<ul class="mt-4 space-y-3">
					{#each marketingGuides.filter((guide) => guide.slug !== data.guide.slug) as guide (guide.slug)}
						<li>
							<a
								href={resolve('/guides/[slug]', { slug: guide.slug })}
								class="focus-ring flex min-h-11 items-center rounded-md py-2 text-sm leading-6 text-muted-foreground hover:text-primary"
								>{guide.question}</a
							>
						</li>
					{/each}
				</ul>
			</nav>
		</div>
	</div>
</article>
