<script lang="ts">
	import { resolve } from '$app/paths';
	import { marketingGuides } from '@openpost/social-images';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const reviewDateFormat = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
</script>

<article class="section-pad">
	<div class="marketing-shell">
		<div class="max-w-4xl">
			<a
				href={resolve('/guides')}
				class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-primary"
				>← All publishing guides</a
			>
			<h1 class="marketing-title mt-5">{data.guide.question}</h1>
			<p class="mt-6 text-sm text-muted-foreground">
				By OpenPost · Reviewed <time datetime={data.guide.reviewedAt}
					>{reviewDateFormat.format(new Date(data.guide.reviewedAt))}</time
				>
			</p>
			<p class="marketing-copy mt-7">{data.guide.answer}</p>
			<p class="mt-6 max-w-3xl text-sm leading-6 text-muted-foreground">
				Written by the team behind OpenPost. See the linked sources when comparing tools.
			</p>
		</div>
		<div class="mt-12 grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
			<div class="max-w-3xl min-w-0">
				<aside class="border-y py-6" aria-label="OpenPost Hosted readiness">
					<h2 class="text-base font-semibold">Check your channels first</h2>
					<p class="mt-3 leading-7 text-muted-foreground">
						Posting, inbox, and analytics vary by account and format. Check provider requirements
						and live-account readiness before planning a launch.
					</p>
					<a
						href="/platforms"
						class="focus-ring mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary"
						>Check channel availability →</a
					>
				</aside>
				{#each data.guide.sections as section, i (section.title)}
					<section id={`section-${i}`} class="mt-10 scroll-mt-28">
						<h2 class="text-2xl font-semibold tracking-tight">
							{section.title}
						</h2>
						<p class="mt-4 leading-7 text-muted-foreground">{section.text}</p>
						{#if section.table}
							<table class="guide-table mt-6">
								<caption class="mb-3 text-left text-sm font-medium">{section.table.caption}</caption
								>
								<thead>
									<tr>
										{#each section.table.columns as column (column)}
											<th scope="col">{column}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each section.table.rows as row (row[0])}
										<tr>
											<th scope="row">{row[0]}</th>
											{#each row.slice(1) as cell, column (column)}
												<td>
													<span class="cell-label" aria-hidden="true"
														>{section.table.columns[column + 1]}</span
													>
													{cell}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
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
				aria-label="More publishing guides"
				class="self-start border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"
			>
				<h2 class="text-sm font-semibold">More publishing guides</h2>
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

<style>
	.guide-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.guide-table th,
	.guide-table td {
		border-bottom: 1px solid var(--border);
		padding: 1rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}
	.guide-table th {
		font-weight: 600;
	}
	.guide-table td {
		color: var(--muted-foreground);
	}
	.cell-label {
		display: none;
	}
	@media (max-width: 639px) {
		.guide-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.guide-table tbody,
		.guide-table tr,
		.guide-table th,
		.guide-table td {
			display: block;
		}
		.guide-table tbody tr {
			padding-block: 1rem;
			border-top: 1px solid var(--border);
		}
		.guide-table tbody th,
		.guide-table td {
			border: 0;
			padding: 0.5rem 0;
		}
		.cell-label {
			display: block;
			font-weight: 500;
			color: var(--foreground);
		}
	}
</style>
