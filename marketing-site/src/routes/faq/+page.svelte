<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowRight, ExternalLink, Mail, MessageCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		discordCommunityUrl,
		faqCategories,
		faqs,
		supportEmail,
		supportMailUrl
	} from '../_marketing';

	function isExternal(href: string) {
		return href.startsWith('https://');
	}

	function linkAttributes(href: string) {
		return { href: href.startsWith('/') ? resolve(href as '/') : href };
	}
</script>

<section class="faq-hero border-b">
	<div class="marketing-shell grid gap-10 py-16 sm:py-24 lg:grid-cols-[1fr_21rem] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">FAQ</p>
			<h1 class="marketing-title mt-5">Know the boundary before you start.</h1>
			<p class="marketing-copy mt-7">
				These answers cover the questions that change setup, publishing, billing, or access. Each
				answer points to the maintained page when more detail matters.
			</p>
		</div>
		<nav class="faq-index" aria-label="FAQ topics">
			<p class="text-sm font-semibold">Jump to a topic</p>
			<ul class="mt-3">
				{#each faqCategories as category (category.id)}
					<li><a class="focus-ring" href={`#${category.id}`}>{category.label}</a></li>
				{/each}
			</ul>
		</nav>
	</div>
</section>

<section class="section-pad" aria-labelledby="faq-answers-title">
	<div class="marketing-shell">
		<h2 id="faq-answers-title" class="sr-only">OpenPost questions and answers</h2>
		<div class="faq-groups">
			{#each faqCategories as category (category.id)}
				{@const categoryFaqs = faqs.filter((faq) => faq.category === category.id)}
				<section
					id={category.id}
					class="faq-group scroll-mt-28"
					aria-labelledby={`${category.id}-title`}
				>
					<div class="faq-group-heading">
						<p class="section-label">{category.label}</p>
						<h3 id={`${category.id}-title`}>{category.description}</h3>
					</div>
					<div class="faq-list">
						{#each categoryFaqs as item (item.id)}
							<details id={item.id} class="group scroll-mt-28">
								<summary class="focus-ring">
									<span>{item.question}</span>
									<span class="summary-mark" aria-hidden="true">+</span>
								</summary>
								<div class="faq-answer">
									<p>{item.answer}</p>
									<a
										class="focus-ring"
										{...linkAttributes(item.learnMore.href)}
										target={isExternal(item.learnMore.href) ? '_blank' : undefined}
										rel={isExternal(item.learnMore.href) ? 'noreferrer' : undefined}
									>
										{item.learnMore.label}
										{#if isExternal(item.learnMore.href)}<ExternalLink
												aria-hidden="true"
											/>{:else}<ArrowRight aria-hidden="true" />{/if}
									</a>
								</div>
							</details>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</div>
</section>

<section class="contact-section border-y" aria-labelledby="faq-contact-title">
	<div class="marketing-shell grid gap-10 py-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
		<div>
			<p class="section-label">Still deciding?</p>
			<h2
				id="faq-contact-title"
				class="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance"
			>
				Ask with the context that matters.
			</h2>
			<p class="mt-4 max-w-xl leading-7 text-muted-foreground">
				For a setup or product question, use the community. For an account, billing, privacy, or
				security question, email support and avoid posting private details in public.
			</p>
		</div>
		<div class="contact-actions">
			<a
				class="focus-ring contact-action"
				{...linkAttributes(discordCommunityUrl)}
				target="_blank"
				rel="noreferrer"
			>
				<span><MessageCircle aria-hidden="true" /></span>
				<span>
					<strong>Ask the Discord community</strong>
					<small>Setup, workflow, and self-hosting questions</small>
				</span>
				<ExternalLink aria-hidden="true" />
			</a>
			<a class="focus-ring contact-action" {...linkAttributes(supportMailUrl)}>
				<span><Mail aria-hidden="true" /></span>
				<span>
					<strong>Email {supportEmail}</strong>
					<small>Account, billing, privacy, and security questions</small>
				</span>
				<ArrowRight aria-hidden="true" />
			</a>
		</div>
	</div>
</section>

<section class="section-pad text-center" aria-labelledby="faq-next-title">
	<div class="marketing-shell">
		<p class="section-label">Next step</p>
		<h2 id="faq-next-title" class="marketing-heading mx-auto mt-4">
			See the workflow or compare its limits.
		</h2>
		<div class="mt-8 flex flex-wrap justify-center gap-3">
			<Button href="/features" size="lg">Explore features</Button>
			<Button href="/pricing" variant="outline" size="lg">Compare plans</Button>
		</div>
	</div>
</section>

<style>
	.faq-hero {
		background:
			radial-gradient(
				circle at 72% 20%,
				color-mix(in oklch, var(--primary) 10%, transparent),
				transparent 22rem
			),
			var(--background);
	}

	.faq-index {
		padding-left: 1.25rem;
		border-left: 1px solid var(--border);
	}

	.faq-index ul {
		display: grid;
		gap: 0.1rem;
	}

	.faq-index a {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		border-radius: 0.5rem;
		color: var(--muted-foreground);
		font-size: 0.82rem;
		font-weight: 550;
	}

	.faq-index a:hover {
		color: var(--foreground);
	}

	.faq-groups {
		display: grid;
		gap: clamp(4rem, 8vw, 7rem);
	}

	.faq-group {
		display: grid;
		gap: 2rem;
	}

	.faq-group-heading h3 {
		max-width: 28ch;
		margin-top: 1rem;
		font-size: clamp(1.55rem, 3vw, 2.25rem);
		font-weight: 620;
		line-height: 1.12;
		letter-spacing: -0.028em;
		text-wrap: balance;
	}

	.faq-list {
		border-block: 1px solid var(--border);
	}

	.faq-list details + details {
		border-top: 1px solid var(--border);
	}

	.faq-list summary {
		display: flex;
		min-height: 4rem;
		cursor: pointer;
		list-style: none;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-block: 0.75rem;
		border-radius: 0.5rem;
		font-weight: 620;
	}

	.summary-mark {
		color: var(--muted-foreground);
		font-size: 1.35rem;
		transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	details[open] .summary-mark {
		transform: rotate(45deg);
	}

	.faq-answer {
		max-width: 70ch;
		padding: 0 2rem 1.5rem 0;
	}

	.faq-answer p {
		color: var(--muted-foreground);
		line-height: 1.7;
	}

	.faq-answer a {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.8rem;
		border-radius: 0.5rem;
		color: var(--primary);
		font-size: 0.8rem;
		font-weight: 650;
	}

	.faq-answer a :global(svg) {
		width: 0.85rem;
		height: 0.85rem;
	}

	.contact-section {
		background: color-mix(in oklch, var(--muted) 32%, var(--background));
	}

	.contact-actions {
		display: grid;
		border-block: 1px solid var(--border);
	}

	.contact-action {
		display: grid;
		min-width: 0;
		min-height: 5.5rem;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
		padding: 1rem 0.25rem;
		border-radius: 0.5rem;
	}

	.contact-action + .contact-action {
		border-top: 1px solid var(--border);
	}

	.contact-action > span:first-child {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--background);
		color: var(--primary);
	}

	.contact-action > span:first-child :global(svg),
	.contact-action > :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.contact-action strong,
	.contact-action small {
		display: block;
	}

	.contact-action small {
		margin-top: 0.2rem;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.4;
	}

	@media (min-width: 56rem) {
		.faq-group {
			grid-template-columns: minmax(15rem, 0.72fr) minmax(0, 1.28fr);
			gap: clamp(3rem, 7vw, 7rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.summary-mark {
			transition: none;
		}
	}
</style>
