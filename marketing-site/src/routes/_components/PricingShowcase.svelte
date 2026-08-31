<script lang="ts">
	import { resolve } from '$app/paths';
	import Check from '@lucide/svelte/icons/check';
	import { purchaseTerms } from '@openpost/plan-catalog';
	import { Button } from '$lib/components/ui/button';
	import {
		appUrl,
		billingSettingsUrl,
		managedCardRequirement,
		managedPaymentExpectation,
		plans
	} from '../_marketing';
	import AnimatedPrice from './AnimatedPrice.svelte';

	interface Props {
		compact?: boolean;
		billingPeriod?: 'monthly' | 'annual';
	}

	let { compact = false, billingPeriod = $bindable('monthly') }: Props = $props();
	const displayedPlans = $derived(compact ? plans.slice(0, 3) : plans);

	function numericPrice(price: string) {
		return Number(price.replace(/[^0-9.]/g, ''));
	}

	function monthlyPrice(plan: (typeof plans)[number]) {
		return billingPeriod === 'monthly'
			? numericPrice(plan.price)
			: numericPrice(plan.annualPrice) / 12;
	}

	function renewalPrice(plan: (typeof plans)[number]) {
		return billingPeriod === 'annual' ? `${plan.annualPrice} per year` : `${plan.price} per month`;
	}

	function externalHref(href: string) {
		return { href } as const;
	}

	const billingAnnouncement = $derived(
		billingPeriod === 'annual'
			? 'Yearly billing selected. Monthly equivalents range from $12.50 to $165.83, with the yearly total shown on each plan.'
			: 'Monthly billing selected. Prices range from $15 to $199 per month.'
	);
</script>

<div class:pricing-compact={compact} class="pricing-showcase">
	<div class="pricing-toolbar">
		<p class="trial-copy">
			<strong>{purchaseTerms.trial_days}-day free trial.</strong>
			{managedCardRequirement}.
		</p>
		<div class="billing-toggle" aria-label="Billing period">
			<Button
				variant={billingPeriod === 'monthly' ? 'default' : 'ghost'}
				size="sm"
				aria-pressed={billingPeriod === 'monthly'}
				onclick={() => (billingPeriod = 'monthly')}>Monthly</Button
			>
			<Button
				variant={billingPeriod === 'annual' ? 'default' : 'ghost'}
				size="sm"
				aria-pressed={billingPeriod === 'annual'}
				onclick={() => (billingPeriod = 'annual')}
			>
				Yearly <span>Save 17%</span>
			</Button>
		</div>
	</div>
	<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
		{billingAnnouncement}
	</p>

	<div class="pricing-grid">
		{#each displayedPlans as plan (plan.id)}
			<article class:featured={plan.featured} class="pricing-card" data-plan-id={plan.id}>
				{#if plan.featured}<span class="popular-label">Most popular</span>{/if}
				<div>
					<h3>{plan.name}</h3>
					<p class="plan-description">{plan.description}</p>
				</div>
				<p class="price-line">
					<AnimatedPrice value={monthlyPrice(plan)} />
					<span>/month</span>
				</p>
				<p class="billing-note">
					{#if billingPeriod === 'annual'}
						Billed {plan.annualPrice} yearly
					{:else}
						Billed monthly
					{/if}
				</p>
				<ul>
					{#each plan.limits.slice(0, compact ? 4 : 5) as limit (limit)}
						<li><Check aria-hidden="true" /> <span>{limit}</span></li>
					{/each}
				</ul>
				<Button
					href={`${appUrl}/register?plan=${plan.id}&billing_period=${billingPeriod}`}
					variant={plan.featured ? 'default' : 'outline'}
					class="plan-button w-full"
					aria-describedby={`plan-${plan.id}-purchase-note`}
				>
					Start {plan.name}
				</Button>
				<p id={`plan-${plan.id}-purchase-note`} class="purchase-note">
					Then {renewalPrice(plan)} until canceled.
				</p>
			</article>
		{/each}
	</div>

	{#if !compact}
		<details class="purchase-details">
			<summary class="focus-ring">Trial and billing details</summary>
			<div>
				<p>
					{managedPaymentExpectation} OpenPost shows the renewal date and price before you start. Cancel
					or change your plan in
					<a class="focus-ring" {...externalHref(billingSettingsUrl)}>Billing settings</a> before renewal.
				</p>
				<p>
					Paddle is the Merchant of Record and calculates tax at checkout.
					<a class="focus-ring" href={resolve('/refunds')}>Refund policy</a>
					<span aria-hidden="true">·</span>
					<a class="focus-ring" href={resolve('/terms')}>Billing terms</a>
				</p>
			</div>
		</details>
	{/if}
</div>

<style>
	.pricing-showcase {
		display: grid;
		gap: 2rem;
	}

	.pricing-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.trial-copy {
		color: var(--muted-foreground);
		font-size: 0.9rem;
	}

	.trial-copy strong {
		color: var(--foreground);
	}

	.billing-toggle {
		display: inline-flex;
		flex: none;
		gap: 0.2rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--muted) 52%, var(--background));
	}

	.billing-toggle :global(button) {
		min-width: 6rem;
	}

	.billing-toggle span {
		margin-left: 0.2rem;
		font-size: 0.68rem;
		opacity: 0.72;
	}

	.purchase-details {
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--muted) 38%, var(--background));
	}

	.purchase-details summary {
		min-height: 2.75rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 650;
	}

	.purchase-details > div {
		display: grid;
		gap: 0.5rem;
		padding: 0 1rem 1rem;
		color: var(--muted-foreground);
		font-size: 0.8rem;
		line-height: 1.55;
	}

	.purchase-details a {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		margin-inline: 0.25rem;
		border-radius: 0.5rem;
		color: var(--foreground);
		font-weight: 620;
	}

	.pricing-grid {
		display: grid;
		gap: 1rem;
	}

	.pricing-card {
		position: relative;
		display: flex;
		min-width: 0;
		min-height: 27rem;
		flex-direction: column;
		padding: clamp(1.4rem, 2.5vw, 2rem);
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: color-mix(in oklch, var(--card) 95%, var(--background));
		transition:
			transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
			border-color 180ms ease;
	}

	.pricing-card:hover {
		transform: translateY(-0.25rem);
		border-color: color-mix(in oklch, var(--foreground) 28%, var(--border));
	}

	.pricing-card.featured {
		border-color: color-mix(in oklch, var(--primary) 76%, var(--border));
	}

	.popular-label {
		position: absolute;
		top: 0;
		left: 50%;
		padding: 0.4rem 1.1rem;
		border-radius: 0 0 0.8rem 0.8rem;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 0.74rem;
		font-weight: 700;
		transform: translateX(-50%);
	}

	.pricing-card h3 {
		font-size: 1.25rem;
		font-weight: 700;
	}

	.plan-description {
		min-height: 2.8rem;
		margin-top: 0.65rem;
		color: var(--muted-foreground);
		font-size: 0.9rem;
		line-height: 1.65;
	}

	.price-line {
		display: flex;
		align-items: baseline;
		margin-top: 1.4rem;
		font-size: clamp(2.6rem, 4vw, 3.5rem);
		font-weight: 720;
		letter-spacing: -0.04em;
	}

	.price-line > span:last-child {
		margin-left: 0.25rem;
		color: var(--muted-foreground);
		font-size: 0.82rem;
		font-weight: 450;
		letter-spacing: normal;
	}

	.billing-note {
		min-height: 1.25rem;
		margin-top: 0.35rem;
		color: var(--muted-foreground);
		font-size: 0.72rem;
	}

	.purchase-note {
		margin-top: 0.75rem;
		color: var(--muted-foreground);
		font-size: 0.7rem;
		line-height: 1.45;
		text-align: center;
	}

	.pricing-card ul {
		display: grid;
		gap: 0.85rem;
		margin-block: 1.5rem;
		padding: 0;
		list-style: none;
	}

	:global(.plan-button) {
		margin-top: auto;
	}

	.pricing-card li {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		color: var(--muted-foreground);
		font-size: 0.88rem;
		line-height: 1.45;
	}

	.pricing-card li :global(svg) {
		width: 1rem;
		height: 1rem;
		flex: none;
		margin-top: 0.1rem;
		color: var(--primary);
	}

	@media (min-width: 64rem) {
		.pricing-grid {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}

		.pricing-card {
			grid-column: span 2;
		}

		.pricing-card:nth-child(4) {
			grid-column: 2 / span 2;
		}

		.pricing-card:nth-child(5) {
			grid-column: 4 / span 2;
		}

		.pricing-card.featured {
			transform: translateY(-0.5rem);
		}

		.pricing-card.featured:hover {
			transform: translateY(-0.75rem);
		}
	}

	@media (max-width: 39.99rem) {
		.pricing-toolbar {
			align-items: stretch;
			flex-direction: column;
		}

		.billing-toggle,
		.billing-toggle :global(button) {
			width: 100%;
		}

		.billing-toggle :global(button) {
			flex: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pricing-card {
			transition: none;
		}
	}
</style>
