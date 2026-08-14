<script lang="ts">
	import { resolve } from '$app/paths';
	import Check from '@lucide/svelte/icons/check';
	import { purchaseTerms } from '@openpost/plan-catalog';
	import { Button } from '$lib/components/ui/button';
	import {
		appUrl,
		billingSettingsUrl,
		managedAccessSummary,
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
		<div>
			<p class="font-semibold">{purchaseTerms.trial_days} days free</p>
			<p>{managedAccessSummary}</p>
		</div>
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

	<div class="purchase-summary" aria-label="Hosted service plan purchase terms">
		<p>
			<strong>Before checkout:</strong>
			{managedPaymentExpectation} OpenPost shows the renewal date and price before you start. Cancel or
			change the subscription from
			<a class="focus-ring" {...externalHref(billingSettingsUrl)}>Billing settings</a> before renewal.
		</p>
		<p>
			Paddle is the Merchant of Record and calculates applicable taxes at checkout.
			<a class="focus-ring" href={resolve('/refunds')}>Refund policy</a>
			<span aria-hidden="true">·</span>
			<a class="focus-ring" href={resolve('/terms')}>Billing terms</a>
		</p>
	</div>

	<div class="pricing-grid">
		{#each plans as plan (plan.id)}
			<article class:featured={plan.featured} class="pricing-card" data-plan-id={plan.id}>
				{#if plan.featured}<span class="popular-label">Most popular</span>{/if}
				<div>
					<h3>{plan.name}</h3>
					<p class="best-for">Best for {plan.bestFor.toLocaleLowerCase()}</p>
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
					class="w-full"
					aria-describedby={`plan-${plan.id}-purchase-note`}
				>
					Start {plan.name}
				</Button>
				<p id={`plan-${plan.id}-purchase-note`} class="purchase-note">
					{managedCardRequirement}. After {purchaseTerms.trial_days} days: {renewalPrice(plan)} until
					canceled.
				</p>
			</article>
		{/each}
	</div>
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

	.pricing-toolbar > div:first-child {
		display: grid;
		gap: 0.3rem;
	}

	.pricing-toolbar p:last-child {
		color: var(--muted-foreground);
		font-size: 0.8rem;
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

	.purchase-summary {
		display: grid;
		gap: 0.45rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--muted) 38%, var(--background));
		color: var(--muted-foreground);
		font-size: 0.8rem;
		line-height: 1.55;
	}

	.purchase-summary a {
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
		min-height: 31rem;
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

	.best-for {
		margin-top: 0.45rem;
		color: var(--foreground);
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.4;
	}

	.plan-description {
		min-height: 2.9rem;
		margin-top: 0.55rem;
		color: var(--muted-foreground);
		font-size: 0.9rem;
		line-height: 1.65;
	}

	.price-line {
		display: flex;
		align-items: baseline;
		margin-top: 2rem;
		font-size: clamp(2.7rem, 5vw, 4rem);
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
		margin-block: 2rem auto;
		padding: 0;
		list-style: none;
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
