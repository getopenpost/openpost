<script lang="ts">
	import { ArrowRight, CheckCircle2, ExternalLink } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { changelogEntries, githubUrl, siteUrl } from '../_marketing';
</script>

<svelte:head>
	<title>OpenPost changelog</title>
	<meta
		name="description"
		content="Recent OpenPost changes to account security, the composer, responsive app experience, provider publishing, CLI, and MCP."
	/>
	<link rel="canonical" href={`${siteUrl}/changelog`} />
</svelte:head>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="max-w-4xl">
			<p class="section-label">Changelog</p>
			<h1 class="marketing-title mt-5">What changed, in plain language.</h1>
			<p class="marketing-copy mt-6">
				Read the product-level changes here. The repository changelog remains the complete record
				for releases, fixes, and migration notes.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={`${githubUrl}/blob/main/CHANGELOG.md`} size="lg">
					Full changelog
					<ExternalLink data-icon="inline-end" />
				</Button>
				<Button href={`${githubUrl}/releases`} variant="outline" size="lg">All releases</Button>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="reading-shell">
		<div class="divide-y border-y">
			{#each changelogEntries as entry (entry.title)}
				<article class="py-10">
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						<time datetime={entry.date} class="font-mono text-sm text-primary">{entry.date}</time>
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{entry.category}
						</p>
					</div>
					<h2 class="mt-4 text-2xl leading-tight font-semibold">
						{entry.title}
					</h2>
					<p class="mt-4 leading-7 text-muted-foreground">{entry.detail}</p>
					<ul class="mt-6 space-y-3">
						{#each entry.highlights as highlight (highlight)}
							<li class="flex gap-2 text-sm leading-6 text-muted-foreground">
								<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />
								<span>{highlight}</span>
							</li>
						{/each}
					</ul>
					<a
						href={entry.href}
						target="_blank"
						rel="noreferrer"
						class="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary"
					>
						View source record <ArrowRight class="size-4" />
					</a>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="border-t bg-muted/20 py-12">
	<div class="marketing-shell flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
		<div>
			<h2 class="text-xl font-semibold">Need every migration, fix, and release note?</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				The repository changelog is the authoritative technical record.
			</p>
		</div>
		<Button href={`${githubUrl}/blob/main/CHANGELOG.md`} variant="outline">
			Open on GitHub
			<ExternalLink data-icon="inline-end" />
		</Button>
	</div>
</section>
