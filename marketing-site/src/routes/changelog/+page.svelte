<script lang="ts">
	import { ArrowRight, CheckCircle2, ExternalLink } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { githubUrl } from '../_marketing';

	type ChangelogPageData = {
		sections: Array<{
			label: string;
			date?: string;
			intro: string[];
			groups: Array<{
				title: string;
				items: string[];
				remaining: number;
			}>;
		}>;
	};

	let { data }: { data: ChangelogPageData } = $props();
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="max-w-4xl">
			<p class="section-label">Changelog</p>
			<h1 class="marketing-title mt-5">What changed, in plain language.</h1>
			<p class="mt-5 text-sm font-medium text-foreground">
				This page is for users and operators reviewing changes before an update.
			</p>
			<p class="marketing-copy mt-6">
				This page is generated from the repository changelog, the same record used for release
				notes. This summary does not replace the complete fixes and migration details in the source
				file.
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
			{#each data.sections as entry (entry.label)}
				<article
					id={entry.label === 'Unreleased' ? 'unreleased' : `v${entry.label}`}
					class="scroll-mt-24 py-10"
				>
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						{#if entry.date}
							<time datetime={entry.date} class="font-mono text-sm text-primary">{entry.date}</time>
						{/if}
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{entry.label === 'Unreleased' ? 'In progress' : 'Release'}
						</p>
					</div>
					<h2 class="mt-4 text-2xl leading-tight font-semibold">
						{entry.label === 'Unreleased' ? 'Unreleased' : `v${entry.label}`}
					</h2>
					{#if entry.intro.length > 0}
						<p class="mt-4 leading-7 text-muted-foreground">
							{entry.intro.join(' ')}
						</p>
					{/if}
					<div class="mt-6 grid gap-7">
						{#each entry.groups as group (group.title)}
							<section aria-labelledby={`${entry.label}-${group.title}`}>
								<h3 id={`${entry.label}-${group.title}`} class="text-sm font-semibold">
									{group.title}
								</h3>
								<ul class="mt-3 space-y-3">
									{#each group.items as item (item)}
										<li class="flex gap-2 text-sm leading-6 text-muted-foreground">
											<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />
											<span>{item}</span>
										</li>
									{/each}
								</ul>
								{#if group.remaining > 0}
									<p class="mt-3 text-xs text-muted-foreground">
										{group.remaining} more {group.remaining === 1 ? 'entry' : 'entries'} in the full changelog.
									</p>
								{/if}
							</section>
						{/each}
					</div>
					<a
						href={`${githubUrl}/blob/main/CHANGELOG.md`}
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
