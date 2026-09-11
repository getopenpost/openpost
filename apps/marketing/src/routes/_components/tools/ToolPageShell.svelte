<script lang="ts">
	import { ArrowLeft, ArrowRight, Check } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import HeroAccent from '../HeroAccent.svelte';
	import {
		managedSignupUrl,
		managedTrialNote,
		tools,
		type MarketingToolSlug
	} from '../../_marketing';
	import { toolArticles } from '../../tools/_articles';
	let { slug, children }: { slug: MarketingToolSlug; children: Snippet } = $props();
	const article = $derived(toolArticles[slug]);
	const related = $derived(tools.filter((tool) => tool.slug !== slug).slice(0, 4));
</script>

<section class="tool-page marketing-shell">
	<a href="/tools" class="back-link focus-ring"><ArrowLeft size={16} /> All free tools</a>
	<div class="tool-layout">
		<div class="tool-main">
			<header>
				<h1>{article.title}</h1>
				<p>{article.description}</p>
			</header>
			<div class="tool-controls" data-agent-exclude="interactive-tool">
				<noscript
					><p class="no-script">
						Turn on JavaScript to use this tool. You can still read the guide below.
					</p></noscript
				>
				{@render children()}
			</div>
			<p class="privacy-note">{article.privacy}</p>
			<article class="tool-guide" data-agent-include="tool-explanation">
				<section>
					<h2>How to use it</h2>
					<ol>
						{#each article.steps as step (step)}<li>{step}</li>{/each}
					</ol>
				</section>
				{#each article.sections as section (section.title)}<section>
						<h2>{section.title}</h2>
						{#each section.paragraphs as paragraph (paragraph)}<p>{paragraph}</p>{/each}
					</section>{/each}
				<section>
					<h2>Common questions</h2>
					{#each article.questions as item (item.question)}<details>
							<summary>{item.question}</summary>
							<p>{item.answer}</p>
						</details>{/each}
				</section>
				<section>
					<h2>Keep making</h2>
					<div class="related-tools">
						{#each related as tool (tool.slug)}<a class="focus-ring" href={`/tools/${tool.slug}`}
								>{tool.name}<ArrowRight size={16} /></a
							>{/each}
					</div>
				</section>
			</article>
		</div>
		<aside
			class="tool-promo"
			aria-label="Create and schedule with OpenPost"
			data-agent-exclude="application-cta"
		>
			<div class="promo-content">
				<div class="promo-brand">
					<img src="/assets/brand/logo.svg" alt="" width="24" height="24" /><span>OpenPost</span>
				</div>
				<h2>A good post.<br /><HeroAccent>Then another.</HeroAccent></h2>
				<p>Keep your ideas, images, videos, and schedule in one place.</p>
				<ul>
					<li><Check size={16} /> Write with a little AI help</li>
					<li><Check size={16} /> Edit images and videos</li>
					<li><Check size={16} /> Plan your week of posts</li>
				</ul>
				<Button href={managedSignupUrl}>Try OpenPost <ArrowRight data-icon="inline-end" /></Button>
				<small>{managedTrialNote}</small>
			</div>
			<img
				class="promo-preview"
				src="/assets/screenshots/calendar-dark.webp"
				alt="Scheduled posts in the OpenPost calendar"
				width="1280"
				height="800"
				loading="lazy"
			/>
		</aside>
	</div>
</section>

<style>
	.tool-page {
		padding-block: 28px 72px;
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font-size: 13px;
		color: var(--muted-foreground);
		border-radius: 4px;
	}
	.tool-layout {
		display: grid;
		gap: 48px;
		align-items: start;
		margin-top: 24px;
	}
	.tool-main {
		min-width: 0;
		container: tool / inline-size;
	}
	header {
		padding-block: 16px 28px;
	}
	h1 {
		max-width: 22ch;
		font-size: clamp(36px, 4vw, 56px);
		font-weight: 550;
		line-height: 1.08;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}
	header > p {
		margin-top: 18px;
		font-size: 17px;
		line-height: 1.7;
		color: var(--muted-foreground);
	}
	.tool-controls :global(> div) {
		margin-top: 0;
	}
	.tool-controls {
		min-width: 0;
	}
	.privacy-note {
		font-size: 12px;
		line-height: 1.7;
		color: var(--muted-foreground);
		margin-top: 16px;
	}
	.no-script {
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		margin-bottom: 20px;
		font-size: 14px;
	}
	.tool-guide {
		max-width: 72ch;
		margin-top: 56px;
	}
	.tool-guide section + section {
		margin-top: 48px;
	}
	.tool-guide h2 {
		font-size: 27px;
		line-height: 1.25;
		letter-spacing: -0.025em;
		font-weight: 550;
		margin-bottom: 20px;
		text-wrap: balance;
	}
	.tool-guide p,
	.tool-guide li {
		color: var(--muted-foreground);
		font-size: 16px;
		line-height: 1.8;
	}
	.tool-guide p + p {
		margin-top: 18px;
	}
	.tool-guide ol {
		list-style: decimal;
		padding-left: 24px;
	}
	.tool-guide li + li {
		margin-top: 10px;
	}
	.tool-guide details {
		border-bottom: 1px solid var(--border);
	}
	.tool-guide summary {
		cursor: pointer;
		padding-block: 18px;
		line-height: 1.5;
		font-weight: 550;
	}
	.tool-guide details p {
		padding-bottom: 20px;
	}
	.tool-promo {
		min-width: 0;
		border-radius: 16px;
		overflow: hidden;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.promo-content {
		padding: 28px;
	}
	.promo-brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 550;
		font-size: 17px;
	}
	.tool-promo h2 {
		margin-top: 32px;
		font-size: 32px;
		line-height: 1.16;
		font-weight: 550;
		letter-spacing: -0.03em;
	}
	.tool-promo p {
		margin-block: 20px;
		font-size: 15px;
		line-height: 1.7;
	}
	.tool-promo ul {
		display: grid;
		gap: 12px;
		margin-bottom: 28px;
	}
	.tool-promo li {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 13px;
	}
	.tool-promo li :global(svg) {
		flex-shrink: 0;
	}
	.tool-promo small {
		display: block;
		margin-top: 12px;
		font-size: 11px;
		line-height: 1.6;
	}
	.promo-preview {
		display: block;
		width: calc(100% - 28px);
		height: auto;
		margin-left: 28px;
		border-radius: 10px 0 0 0;
	}
	.related-tools {
		display: grid;
	}
	.related-tools a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		min-height: 52px;
		padding-block: 12px;
		border-bottom: 1px solid var(--border);
		border-radius: 4px;
		font-size: 15px;
	}
	@media (min-width: 1100px) {
		.tool-layout {
			grid-template-columns: minmax(0, 1fr) 300px;
		}
		.tool-promo {
			position: sticky;
			top: 104px;
		}
	}
	@container tool (max-width: 920px) {
		.tool-controls :global([class*='lg:grid-cols-[']),
		.tool-controls :global([class*='xl:grid-cols-[']) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
