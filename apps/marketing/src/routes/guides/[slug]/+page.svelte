<script lang="ts">
	import { resolve } from '$app/paths';
	import { marketingGuides } from '@openpost/social-images';
	import { Button } from '$lib/components/ui/button';
	import { ArrowRight, ArrowLeft } from '@lucide/svelte';
	import GuideVisual from '../GuideVisual.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const relatedGuides = $derived.by(() => {
		const otherGuides = marketingGuides.filter((guide) => guide.slug !== data.guide.slug);
		const sameCategory = otherGuides.filter(
			(guide) => guide.comparison?.category === data.guide.comparison?.category
		);
		return (
			sameCategory.length ? sameCategory : otherGuides.filter((guide) => guide.comparison?.toolHref)
		).slice(0, 3);
	});
	const reviewDateFormat = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
</script>

<article class="guide-article">
	<div class="marketing-shell">
		<header class="guide-hero">
			<div class="hero-copy">
				<a
					href={data.guide.comparison ? '/comparisons' : resolve('/guides')}
					class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-primary"
					><ArrowLeft size={16} aria-hidden="true" />
					{data.guide.comparison ? 'All comparisons' : 'All guides and comparisons'}</a
				>
				<h1 class="guide-title mt-5">{data.guide.question}</h1>
				<p class="mt-6 text-sm text-muted-foreground">
					By OpenPost · Reviewed <time datetime={data.guide.reviewedAt}
						>{reviewDateFormat.format(new Date(data.guide.reviewedAt))}</time
					>
				</p>
				<p class="marketing-copy mt-6">{data.guide.answer}</p>
				<p class="mt-6 max-w-3xl text-sm leading-6 text-muted-foreground">
					Written by the team behind OpenPost. See the linked sources when comparing tools.
				</p>
			</div>
			<div class="hero-visual">
				<GuideVisual guide={data.guide} />
			</div>
		</header>
		<div class="guide-layout">
			<div class="max-w-3xl min-w-0">
				{#if !data.guide.comparison || data.guide.comparison.category === 'Publishing'}
					<aside class="readiness" aria-label="OpenPost Hosted readiness">
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
				{/if}
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
			<aside class="guide-sidebar" aria-label="Reading tools">
				<nav aria-label="On this page" class="sidebar-section">
					<h2 class="text-sm font-semibold">On this page</h2>
					<ul class="mt-3">
						{#each data.guide.sections as section, i (section.title)}
							<li><a class="sidebar-link focus-ring" href={'#section-' + i}>{section.title}</a></li>
						{/each}
						<li><a class="sidebar-link focus-ring" href="#sources-title">Sources</a></li>
					</ul>
				</nav>
				<div class="sidebar-section">
					<h2 class="text-sm font-semibold">
						{data.guide.comparison?.toolHref
							? 'Make something. Try it free.'
							: 'Start with your next post.'}
					</h2>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">
						{data.guide.comparison?.toolHref
							? 'Local editing needs no account or subscription. Keep publishing plans separate.'
							: 'Try our free editors and previews before choosing a publishing plan.'}
					</p>
					<a
						class="sidebar-link focus-ring text-primary"
						href={data.guide.comparison?.toolHref ?? '/tools'}
						>{data.guide.comparison?.toolLabel ?? 'Explore free tools'}<ArrowRight
							size={16}
							aria-hidden="true"
						/></a
					>
				</div>
				<nav aria-label="Related resources" class="sidebar-section">
					<h2 class="text-sm font-semibold">Related resources</h2>
					<ul class="mt-4 space-y-3">
						{#each relatedGuides as guide (guide.slug)}
							<li>
								<a
									href={resolve('/guides/[slug]', { slug: guide.slug })}
									class="sidebar-link focus-ring">{guide.question}</a
								>
							</li>
						{/each}
					</ul>
				</nav>
			</aside>
		</div>
	</div>
</article>

<style>
	.guide-article {
		padding-block: 64px 100px;
	}
	.guide-hero {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		align-items: center;
		gap: 56px;
		padding-bottom: 48px;
		border-bottom: 1px solid var(--border);
	}
	.guide-title {
		font-size: clamp(32px, 4vw, 56px);
		font-weight: 550;
		line-height: 1.12;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}
	.hero-visual {
		overflow: hidden;
		border-radius: 12px;
		min-width: 0;
		height: 280px;
		background: var(--marketing-blue);
	}
	.hero-visual :global(.comparison-visual) {
		height: 100%;
	}
	.guide-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		gap: 72px;
		margin-top: 48px;
	}
	.readiness {
		border-radius: 12px;
		padding: 24px;
		background: var(--marketing-section);
	}
	.guide-sidebar {
		align-self: start;
		position: sticky;
		top: 96px;
	}
	.sidebar-section {
		border-top: 1px solid var(--border);
		padding-block: 20px;
	}
	.sidebar-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 44px;
		border-radius: 4px;
		padding-block: 8px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.sidebar-link:hover {
		color: var(--primary);
	}
	.sidebar-link.text-primary {
		color: var(--primary);
	}
	@media (max-width: 1023px) {
		.guide-hero {
			gap: 32px;
		}
		.guide-layout {
			grid-template-columns: minmax(0, 1fr) 230px;
			gap: 32px;
		}
	}
	@media (max-width: 767px) {
		.guide-article {
			padding-block: 32px 64px;
		}
		.guide-hero,
		.guide-layout {
			grid-template-columns: 1fr;
			gap: 28px;
		}
		.hero-visual {
			height: 200px;
		}
		.guide-sidebar {
			position: static;
		}
		.guide-layout {
			margin-top: 32px;
		}
	}
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
