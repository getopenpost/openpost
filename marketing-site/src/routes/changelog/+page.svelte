<script lang="ts">
	import { ArrowRight, CheckCircle2, ExternalLink, GitCommit, History } from 'lucide-svelte';
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

<section class="border-b py-14 sm:py-18 lg:py-24">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="eyebrow">Changelog</p>
				<h1 class="mt-4 text-4xl leading-[1.03] font-semibold text-balance sm:text-6xl">
					What changed in OpenPost—and why it matters.
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
					A readable summary of recent product work. The repository changelog keeps the complete release-by-release record, including fixes and migration details.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={`${githubUrl}/blob/main/CHANGELOG.md`} size="lg">
						Full changelog
						<ExternalLink data-icon="inline-end" />
					</Button>
					<Button href={`${githubUrl}/releases`} variant="outline" size="lg">All releases</Button>
				</div>
			</div>
			<div class="rounded-xl border bg-card p-6">
				<History class="size-5 text-primary" />
				<p class="mt-4 font-semibold">Latest tagged release</p>
				<a href={`${githubUrl}/releases/tag/v1.0.72`} target="_blank" rel="noreferrer" class="mt-2 inline-flex items-center gap-2 text-2xl font-semibold text-primary">
					v1.0.72 <ExternalLink class="size-4" />
				</a>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">New work is recorded under Unreleased until the next tag.</p>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
		<div class="relative">
			<div class="absolute top-3 bottom-3 left-[0.45rem] w-px bg-border sm:left-[8.45rem]"></div>
			<div class="space-y-12">
				{#each changelogEntries as entry (entry.title)}
					<article class="relative grid gap-5 pl-8 sm:grid-cols-[7rem_1fr] sm:gap-10 sm:pl-0">
						<div>
							<span class="absolute top-2 left-0 size-4 rounded-full border-4 border-background bg-primary sm:left-[8rem]"></span>
							<time datetime={entry.date} class="font-mono text-sm text-primary">{entry.date}</time>
						</div>
						<div class="rounded-xl border bg-card p-6 sm:p-8">
							<p class="text-xs font-medium tracking-wide text-primary uppercase">{entry.category}</p>
							<h2 class="mt-3 text-2xl leading-tight font-semibold">{entry.title}</h2>
							<p class="mt-4 text-sm leading-7 text-muted-foreground">{entry.detail}</p>
							<ul class="mt-6 grid gap-3 sm:grid-cols-2">
								{#each entry.highlights as highlight (highlight)}
									<li class="flex gap-2 text-sm leading-6 text-muted-foreground">
										<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />
										<span>{highlight}</span>
									</li>
								{/each}
							</ul>
							<a href={entry.href} target="_blank" rel="noreferrer" class="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">
								View source record <ArrowRight class="size-4" />
							</a>
						</div>
					</article>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad border-t bg-muted/20">
	<div class="mx-auto grid max-w-5xl gap-6 px-4 sm:px-6 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:px-8">
		<div class="flex size-11 items-center justify-center rounded-lg border bg-card">
			<GitCommit class="size-5 text-primary" />
		</div>
		<div>
			<h2 class="text-xl font-semibold">Need every migration, fix, and release note?</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">The repository changelog is the authoritative technical record.</p>
		</div>
		<Button href={`${githubUrl}/blob/main/CHANGELOG.md`} variant="outline">Open on GitHub</Button>
	</div>
</section>
