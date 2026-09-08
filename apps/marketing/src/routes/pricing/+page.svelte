<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PricingShowcase from '../_components/PricingShowcase.svelte';
	import { faqs } from '../_marketing';
	const pricingFaqs = faqs.filter((faq) => faq.category === 'billing');
</script>

<section class="pricing-hero marketing-shell">
	<h1>One person. A team.<br />Or a whole client list.</h1>
	<p>Three plans. Every feature included. Choose who you publish with.</p>
</section>

<section id="plans" class="plans-section marketing-shell" aria-labelledby="plans-title">
	<div id="limits" class="plans-heading scroll-mt-20">
		<h2 id="plans-title">Pricing plans</h2>
		<p>Compare every plan side by side. Switch billing to see annual pricing.</p>
	</div>
	<PricingShowcase />
</section>

<section class="purchase-faq border-t" aria-labelledby="purchase-faq-title">
	<div class="marketing-shell faq-grid">
		<h2 id="purchase-faq-title">A few things to know.</h2>
		<div class="faq-list">
			{#each pricingFaqs as item (item.id)}
				<details>
					<summary class="focus-ring">{item.question}<span aria-hidden="true">+</span></summary>
					<p>{item.answer}</p>
				</details>
			{/each}
		</div>
	</div>
</section>

<section class="self-hosted-section border-t" aria-label="Self-hosted deployment">
	<div class="marketing-shell self-hosted-grid">
		<div>
			<h2>Prefer to run it yourself?</h2>
			<p>
				Self-hosting has <strong>no software fee</strong>. You pay for your infrastructure and
				provider API use.
			</p>
		</div>
		<a class="focus-ring" href="/self-hosting"
			>Review self-hosting <ArrowRight aria-hidden="true" /></a
		>
	</div>
</section>

<style>
	.pricing-hero {
		padding-block: clamp(3.5rem, 7vw, 6rem) clamp(2.5rem, 5vw, 4rem);
	}
	.pricing-hero h1 {
		max-width: 20ch;
		font-size: clamp(2.5rem, 5.5vw, 4.75rem);
		font-weight: 650;
		line-height: 1.04;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}
	.pricing-hero p {
		max-width: 48ch;
		margin-top: 1.5rem;
		color: var(--muted-foreground);
		font-size: 1.1rem;
		line-height: 1.7;
	}
	.plans-section {
		padding-bottom: clamp(3rem, 6vw, 5rem);
		scroll-margin-top: 5rem;
	}
	.plans-heading {
		margin-bottom: 2rem;
	}
	.plans-heading h2 {
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.025em;
	}
	.plans-heading p {
		margin-top: 0.5rem;
		color: var(--muted-foreground);
		line-height: 1.6;
	}
	.purchase-faq {
		padding-block: clamp(3rem, 6vw, 5rem);
	}
	.faq-grid {
		display: grid;
		gap: 2rem;
	}
	.faq-grid h2,
	.self-hosted-grid h2 {
		font-size: clamp(1.5rem, 2.5vw, 2rem);
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1.2;
	}
	.faq-list {
		border-top: 1px solid var(--border);
	}
	.faq-list details {
		border-bottom: 1px solid var(--border);
	}
	.faq-list summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		min-height: 3.75rem;
		padding-block: 1rem;
		cursor: pointer;
		font-weight: 550;
		list-style: none;
	}
	.faq-list details[open] summary span {
		transform: rotate(45deg);
	}
	.faq-list p {
		max-width: 65ch;
		padding-bottom: 1.5rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.7;
	}
	.self-hosted-section {
		padding-block: 3rem;
	}
	.self-hosted-grid {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem 3rem;
	}
	.self-hosted-grid p {
		max-width: 60ch;
		margin-top: 1rem;
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	.self-hosted-grid a {
		display: inline-flex;
		min-height: 2.75rem;
		gap: 0.5rem;
		align-items: center;
		font-weight: 550;
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}
	.self-hosted-grid a :global(svg) {
		width: 1rem;
		height: 1rem;
	}
	@media (min-width: 48rem) {
		.faq-grid {
			grid-template-columns: 1fr 1.6fr;
			gap: 4rem;
		}
	}
</style>
