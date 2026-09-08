<script lang="ts">
	import { resolve } from '$app/paths';
	import Check from '@lucide/svelte/icons/check';
	import { planCatalog, purchaseTerms } from '@openpost/plan-catalog';
	import { Button } from '$lib/components/ui/button';
	import {
		appUrl,
		billingSettingsUrl,
		managedCardRequirement,
		managedPaymentExpectation
	} from '../_marketing';
	import AnimatedPrice from './AnimatedPrice.svelte';

	interface Props {
		compact?: boolean;
		billingPeriod?: 'monthly' | 'annual';
	}
	let { compact = false, billingPeriod = $bindable('monthly') }: Props = $props();
	let selectedPlan = $state(planCatalog.plans[0].id);
	const plans = planCatalog.plans;
	const dollars = (value: number) =>
		`$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
	const planPrice = (plan: (typeof plans)[number]) =>
		billingPeriod === 'annual' ? plan.annual_price_usd : plan.monthly_price_usd;
	const renewalPrice = (plan: (typeof plans)[number]) =>
		billingPeriod === 'annual'
			? `${dollars(plan.annual_price_usd)} per year`
			: `${dollars(plan.monthly_price_usd)} per month`;
	const billingAnnouncement = $derived(
		`${billingPeriod === 'annual' ? 'Yearly' : 'Monthly'} billing selected. ${plans.map((plan) => `${plan.name}: ${renewalPrice(plan)}`).join('. ')}.`
	);
	const groups = [
		{
			title: 'Your organization',
			rows: [
				{
					label: 'Included workspaces',
					value: (p: (typeof plans)[number]) => p.limits.workspaces.toLocaleString('en-US')
				}
			]
		},
		{
			title: 'In every workspace',
			rows: [
				{
					label: 'Social accounts',
					value: (p: (typeof plans)[number]) => p.limits.social_accounts.toLocaleString('en-US')
				},
				{
					label: 'People, including you',
					value: (p: (typeof plans)[number]) => p.limits.team_members.toLocaleString('en-US')
				},
				{
					label: 'Scheduled publications / month',
					value: (p: (typeof plans)[number]) =>
						p.limits.scheduled_posts_monthly.toLocaleString('en-US')
				},
				{
					label: 'Media storage',
					value: (p: (typeof plans)[number]) => `${p.limits.media_bytes_stored / 1_000_000_000} GB`
				},
				{
					label: 'Media uploads / month',
					value: (p: (typeof plans)[number]) =>
						`${p.limits.media_bytes_uploaded_monthly / 1_000_000_000} GB`
				}
			]
		},
		{
			title: 'Create & publish',
			rows: [
				{ label: 'Composer & channel-specific versions', value: () => 'Included' },
				{ label: 'Calendar & scheduling', value: () => 'Included' },
				{ label: 'Image Editor, Video Editor & Recorder', value: () => 'Included' },
				{ label: 'AI writing & image alt text', value: () => 'Included' },
				{ label: 'Media library & reusable templates', value: () => 'Included' }
			]
		},
		{
			title: 'Measure & connect',
			rows: [
				{ label: 'Analytics for supported accounts', value: () => 'Included' },
				{ label: 'Comments, replies & supported inboxes', value: () => 'Included' },
				{ label: 'HTTP API, CLI & MCP', value: () => 'Included' },
				{ label: 'Additional usage charges', value: () => 'None' }
			]
		}
	];
</script>

<div class="pricing-showcase" class:pricing-compact={compact}>
	<div class="pricing-toolbar">
		<p>
			<strong>{purchaseTerms.trial_days}-day free trial.</strong>
			{managedCardRequirement}.
		</p>
		<div class="billing-toggle" aria-label="Billing period">
			<Button
				variant={billingPeriod === 'monthly' ? 'default' : 'ghost'}
				aria-pressed={billingPeriod === 'monthly'}
				onclick={() => (billingPeriod = 'monthly')}>Monthly</Button
			>
			<Button
				variant={billingPeriod === 'annual' ? 'default' : 'ghost'}
				aria-pressed={billingPeriod === 'annual'}
				onclick={() => (billingPeriod = 'annual')}>Yearly <span>2 months free</span></Button
			>
		</div>
	</div>
	<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{billingAnnouncement}</p>
	<div class="mobile-plan-picker" aria-label="Plan to compare">
		{#each plans as plan (plan.id)}
			<Button
				variant={selectedPlan === plan.id ? 'secondary' : 'ghost'}
				aria-pressed={selectedPlan === plan.id}
				onclick={() => (selectedPlan = plan.id)}>{plan.name}</Button
			>
		{/each}
	</div>
	<table class="pricing-matrix">
		<caption class="sr-only">Compare Hosted plans</caption>
		<thead>
			<tr>
				<th scope="col" class="matrix-intro"><span>Compare plans</span></th>
				{#each plans as plan (plan.id)}
					<th
						scope="col"
						data-plan-id={plan.id}
						data-active={selectedPlan === plan.id}
						class:featured={plan.featured}
					>
						<h3>{plan.name}</h3>
						<p class="best-for">Best for {plan.best_for}.</p>
						<p class="price-line">
							<AnimatedPrice value={planPrice(plan)} /><span
								>/{billingPeriod === 'annual' ? 'year' : 'month'}</span
							>
						</p>
						<Button
							href={`${appUrl}/register?plan=${plan.id}&billing_period=${billingPeriod}`}
							variant={plan.featured ? 'default' : 'outline'}
							class="plan-button w-full">Start {plan.name}</Button
						>
					</th>
				{/each}
			</tr>
		</thead>
		{#each compact ? groups.slice(0, 2) : groups as group (group.title)}
			<tbody>
				<tr class="group-heading"><th colspan="4" scope="rowgroup">{group.title}</th></tr>
				{#each group.rows as row (row.label)}
					<tr>
						<th scope="row">{row.label}</th>
						{#each plans as plan (plan.id)}
							<td data-active={selectedPlan === plan.id} class:featured={plan.featured}>
								{#if row.value(plan) === 'Included'}<Check aria-hidden="true" /><span
										class="sr-only">Included</span
									>{:else}{row.value(plan)}{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		{/each}
	</table>
	{#if compact}
		<p class="capacity-note">
			Every plan includes the full product. <a class="focus-ring" href="/pricing"
				>Compare all features and billing details</a
			>
		</p>
	{:else}
		<details class="purchase-details">
			<summary class="focus-ring">How usage is counted</summary>
			<div>
				<p>
					Each workspace has separate limits. One social account is one connected profile or page.
				</p>
				<p>
					A publication counts once, including all threads and destinations. Monthly allowances
					reset by calendar month in UTC, including on yearly plans.
				</p>
				<p>
					AI writing and alt text have no separate charge. Provider limits, including the monthly X
					budget, appear in Plan &amp; usage. Reaching a limit pauses that action without an overage
					bill.
				</p>
			</div>
		</details>
		<details class="purchase-details">
			<summary class="focus-ring">Trial and billing details</summary>
			<div>
				<p>
					{managedPaymentExpectation} OpenPost shows the renewal date and price before you start. Cancel
					or manage your plan in
					<a class="focus-ring" href={billingSettingsUrl}>Billing settings</a> before renewal.
				</p>
				<p>
					Prices are in USD before tax. Paddle is the Merchant of Record and calculates tax at
					checkout. <a class="focus-ring" href={resolve('/refunds')}>Refund policy</a> ·
					<a class="focus-ring" href={resolve('/terms')}>Billing terms</a>
				</p>
			</div>
		</details>
	{/if}
</div>

<style>
	.pricing-showcase {
		min-width: 0;
	}
	.pricing-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1.5rem;
		padding-bottom: 1.5rem;
	}
	.pricing-toolbar p {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.7;
	}
	.pricing-toolbar strong {
		color: var(--foreground);
	}
	.billing-toggle {
		display: flex;
		flex: none;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
	}
	.billing-toggle :global(button) {
		min-height: 2.75rem;
	}
	.billing-toggle span {
		font-size: 0.72rem;
	}
	.mobile-plan-picker {
		display: none;
	}
	.pricing-matrix {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		text-align: left;
		table-layout: fixed;
	}
	.pricing-matrix th,
	.pricing-matrix td {
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.875rem;
		vertical-align: middle;
	}
	.pricing-matrix thead th {
		position: sticky;
		top: 4rem;
		z-index: 10;
		width: 22%;
		padding-block: 1.25rem;
		background: var(--background);
		vertical-align: top;
	}
	.pricing-matrix thead .matrix-intro {
		width: 34%;
		vertical-align: bottom;
	}
	.matrix-intro > span {
		display: block;
		font-size: clamp(1.3rem, 2vw, 1.8rem);
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.025em;
	}
	.pricing-matrix .featured {
		background: color-mix(in oklch, var(--muted) 50%, var(--background));
	}
	.pricing-matrix thead .featured {
		border-top: 2px solid var(--primary);
	}
	.pricing-matrix h3 {
		font-size: 1.5rem;
		font-weight: 650;
		letter-spacing: -0.025em;
	}
	.best-for {
		min-height: 3.4em;
		margin-top: 0.5rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		font-weight: 400;
		line-height: 1.65;
		text-wrap: pretty;
	}
	.price-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem;
		margin-top: 1rem;
		font-size: clamp(2rem, 3.3vw, 3.25rem);
		font-weight: 650;
		letter-spacing: -0.035em;
		line-height: 1.1;
	}
	.price-line > span {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-weight: 400;
		letter-spacing: normal;
	}
	:global(.plan-button) {
		min-height: 2.75rem;
		margin-top: 1rem;
	}
	.pricing-matrix tbody th {
		font-weight: 450;
	}
	.pricing-matrix tbody td {
		font-variant-numeric: tabular-nums;
	}
	.pricing-matrix td :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
		color: var(--foreground);
	}
	.pricing-matrix .group-heading th {
		padding-top: 2.5rem;
		padding-bottom: 0.75rem;
		font-size: 1rem;
		font-weight: 650;
	}
	.capacity-note {
		display: grid;
		gap: 0.6rem;
		max-width: 85ch;
		margin-top: 1.5rem;
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		line-height: 1.7;
	}
	.capacity-note a,
	.purchase-details a {
		color: var(--foreground);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.purchase-details {
		margin-top: 1.5rem;
		border-block: 1px solid var(--border);
		font-size: 0.875rem;
	}
	.purchase-details summary {
		padding-block: 1rem;
		min-height: 2.75rem;
		cursor: pointer;
		font-weight: 550;
	}
	.purchase-details > div {
		display: grid;
		gap: 0.75rem;
		padding-bottom: 1.5rem;
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	@media (max-width: 63.99rem) {
		.pricing-matrix th,
		.pricing-matrix td {
			padding-inline: 0.875rem;
		}
	}
	@media (max-width: 47.99rem) {
		.pricing-toolbar {
			align-items: stretch;
			flex-direction: column;
			gap: 1rem;
			padding-bottom: 1rem;
		}
		.billing-toggle :global(button) {
			flex: 1;
		}
		.mobile-plan-picker {
			display: flex;
			gap: 0.25rem;
			margin-bottom: 1rem;
		}
		.mobile-plan-picker :global(button) {
			flex: 1;
			min-height: 2.75rem;
		}
		.pricing-matrix {
			display: grid;
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		}
		.pricing-matrix thead,
		.pricing-matrix tbody,
		.pricing-matrix tr {
			display: contents;
		}
		.pricing-matrix [data-active='false'] {
			display: none;
		}
		.pricing-matrix thead th {
			position: static;
			width: auto;
			padding: 1.25rem 0.75rem;
		}
		.pricing-matrix thead .matrix-intro {
			display: none;
		}
		.pricing-matrix thead th[data-active='true'] {
			grid-column: 1 / -1;
		}

		.matrix-intro > span {
			font-size: 1.15rem;
		}
		.pricing-matrix th,
		.pricing-matrix td {
			min-width: 0;
			padding: 0.875rem 0.75rem;
			font-size: 0.8125rem;
			overflow-wrap: anywhere;
		}
		.pricing-matrix tbody th {
			padding-left: 0;
		}
		.pricing-matrix .group-heading th {
			grid-column: 1 / -1;
		}
		.pricing-matrix h3 {
			font-size: 1.35rem;
		}
		.best-for {
			font-size: 0.8125rem;
			min-height: 0;
		}
		.price-line {
			font-size: 2rem;
		}
	}
</style>
