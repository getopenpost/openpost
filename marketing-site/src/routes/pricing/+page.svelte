<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Button } from '$lib/components/ui/button';
	import PricingShowcase from '../_components/PricingShowcase.svelte';
	import { faqs, plans, siteUrl, supportMailUrl } from '../_marketing';

	let billingPeriod = $state<'monthly' | 'annual'>('monthly');
	const pricingFaqs = faqs.filter((faq) => faq.category === 'billing');

	const sharedFeatures = [
		'One composer with account-specific versions',
		'Calendar, scheduling, and publishing status',
		'Reusable media library',
		'Analytics and inbox for supported accounts',
		'HTTP API, CLI, and MCP access',
		'Encrypted social account keys'
	] as const;

	function comparisonPrice(plan: (typeof plans)[number]) {
		return billingPeriod === 'annual' ? `${plan.annualPrice}/year` : `${plan.price}/month`;
	}

	function mailHref(href: string) {
		return { href } as const;
	}

	const comparisonRows = [
		{ label: 'Workspaces', value: (plan: (typeof plans)[number]) => plan.workspaces },
		{ label: 'Social accounts', value: (plan: (typeof plans)[number]) => plan.accounts },
		{ label: 'Scheduled posts / month', value: (plan: (typeof plans)[number]) => plan.posts },
		{ label: 'Media storage', value: (plan: (typeof plans)[number]) => plan.storage },
		{ label: 'Included seats', value: (plan: (typeof plans)[number]) => plan.seats },
		{
			label: 'Team roles',
			value: (plan: (typeof plans)[number]) =>
				plan.id === 'team' || plan.id === 'agency' ? 'Included' : '—'
		}
	] as const;
</script>

<svelte:head>
	<title>OpenPost pricing</title>
	<meta
		name="description"
		content="OpenPost managed plans start at $15 per month with a 14-day card-required trial."
	/>
	<link rel="canonical" href={`${siteUrl}/pricing`} />
</svelte:head>

<section class="pricing-hero">
	<div class="marketing-shell text-center">
		<p class="section-label">Simple pricing</p>
		<h1>Choose your plan.</h1>
		<p>Every plan includes the complete publishing workflow. Choose the limits that fit.</p>
	</div>
</section>

<section id="plans" class="plans-section scroll-mt-20">
	<div class="marketing-shell">
		<PricingShowcase bind:billingPeriod />
	</div>
</section>

<section class="included-section" aria-labelledby="included-title">
	<div class="marketing-shell included-grid">
		<div>
			<p class="section-label">Every plan</p>
			<h2 id="included-title">The full workflow is included.</h2>
		</div>
		<ul>
			{#each sharedFeatures as feature (feature)}
				<li><Check aria-hidden="true" /> <span>{feature}</span></li>
			{/each}
		</ul>
	</div>
</section>

<section id="limits" class="section-pad scroll-mt-20" aria-labelledby="limits-title">
	<div class="marketing-shell">
		<div class="limits-heading">
			<p class="section-label">Exact limits</p>
			<h2 id="limits-title">Compare every plan.</h2>
			<p>Team includes three seats. Agency includes five.</p>
		</div>

		<div class="mobile-limits">
			{#each plans as plan (plan.id)}
				<details data-plan-id={plan.id}>
					<summary class="focus-ring">
						<span><strong>{plan.name}</strong> <small>{comparisonPrice(plan)}</small></span>
						<span aria-hidden="true">+</span>
					</summary>
					<dl>
						{#each comparisonRows as row (row.label)}
							<div>
								<dt>{row.label}</dt>
								<dd>{row.value(plan)}</dd>
							</div>
						{/each}
					</dl>
				</details>
			{/each}
		</div>

		<div class="desktop-limits">
			<table>
				<thead>
					<tr>
						<th scope="col">Limit</th>
						{#each plans as plan (plan.id)}
							<th scope="col">
								<span>{plan.name}</span>
								<small>{comparisonPrice(plan)}</small>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each comparisonRows as row (row.label)}
						<tr>
							<th scope="row">{row.label}</th>
							{#each plans as plan (plan.id)}<td>{row.value(plan)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>

<section class="purchase-faq border-t" aria-labelledby="purchase-faq-title">
	<div class="marketing-shell purchase-faq-grid">
		<div>
			<p class="section-label">Purchase questions</p>
			<h2 id="purchase-faq-title">Know what happens after you choose.</h2>
			<p>
				The full FAQ covers provider access, privacy, failures, and self-hosting. These answers are
				the ones that change a purchase decision.
			</p>
			<div class="purchase-faq-actions">
				<Button href="/faq" variant="outline">
					Read the full FAQ
					<ArrowRight data-icon="inline-end" />
				</Button>
				<a class="focus-ring" {...mailHref(supportMailUrl)}>Ask a billing question</a>
			</div>
		</div>
		<div class="purchase-faq-list">
			{#each pricingFaqs as item (item.id)}
				<details>
					<summary class="focus-ring">
						<span>{item.question}</span>
						<span aria-hidden="true">+</span>
					</summary>
					<p>{item.answer}</p>
				</details>
			{/each}
		</div>
	</div>
</section>

<style>
	.pricing-hero {
		padding-block: clamp(4.5rem, 9vw, 8rem) clamp(3rem, 6vw, 5rem);
		border-bottom: 1px solid var(--border);
		background:
			radial-gradient(
				circle at 50% 0,
				color-mix(in oklch, var(--primary) 14%, transparent),
				transparent 28rem
			),
			var(--background);
	}

	.pricing-hero h1 {
		margin-top: 1rem;
		font-size: clamp(3rem, 7vw, 6rem);
		font-weight: 740;
		line-height: 0.95;
		letter-spacing: -0.05em;
		text-wrap: balance;
	}

	.pricing-hero p:last-child {
		max-width: 38rem;
		margin: 1.5rem auto 0;
		color: var(--muted-foreground);
		font-size: 1.05rem;
		line-height: 1.7;
	}

	.plans-section {
		padding-block: clamp(3.5rem, 7vw, 7rem);
	}

	.included-section {
		padding-block: clamp(4rem, 8vw, 7rem);
		border-block: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 32%, var(--background));
	}

	.included-grid {
		display: grid;
		gap: 2.5rem;
	}

	.included-grid h2,
	.limits-heading h2 {
		margin-top: 1rem;
		font-size: clamp(2.3rem, 4vw, 3.8rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.included-grid ul {
		display: grid;
		gap: 1rem;
		padding: 0;
		list-style: none;
	}

	.included-grid li {
		display: flex;
		gap: 0.8rem;
		align-items: flex-start;
		color: var(--muted-foreground);
		line-height: 1.55;
	}

	.included-grid li :global(svg) {
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
		margin-top: 0.15rem;
		color: var(--primary);
	}

	.limits-heading {
		max-width: 44rem;
	}

	.limits-heading > p:last-child {
		margin-top: 1.25rem;
		color: var(--muted-foreground);
	}

	.mobile-limits {
		display: grid;
		gap: 0.75rem;
		margin-top: 2.5rem;
	}

	.mobile-limits details {
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
	}

	.mobile-limits summary {
		display: flex;
		min-height: 4rem;
		cursor: pointer;
		list-style: none;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-inline: 1rem;
		border-radius: 1rem;
	}

	.mobile-limits summary small {
		margin-left: 0.35rem;
		color: var(--muted-foreground);
		font-size: 0.78rem;
	}

	.mobile-limits dl {
		display: grid;
		gap: 0.8rem;
		padding: 1rem;
		border-top: 1px solid var(--border);
	}

	.mobile-limits dl div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.85rem;
	}

	.mobile-limits dt,
	.desktop-limits td {
		color: var(--muted-foreground);
	}

	.desktop-limits {
		display: none;
		margin-top: 2.5rem;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
	}

	.purchase-faq {
		padding-block: clamp(4rem, 8vw, 7rem);
		background: color-mix(in oklch, var(--muted) 28%, var(--background));
	}

	.purchase-faq-grid {
		display: grid;
		gap: 3rem;
	}

	.purchase-faq h2 {
		max-width: 16ch;
		margin-top: 1rem;
		font-size: clamp(2.2rem, 4vw, 3.8rem);
		font-weight: 680;
		line-height: 1;
		letter-spacing: -0.038em;
		text-wrap: balance;
	}

	.purchase-faq-grid > div:first-child > p:last-of-type {
		max-width: 52ch;
		margin-top: 1.25rem;
		color: var(--muted-foreground);
		line-height: 1.7;
	}

	.purchase-faq-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.25rem;
		margin-top: 1.5rem;
	}

	.purchase-faq-actions > a {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		border-radius: 0.5rem;
		color: var(--primary);
		font-size: 0.82rem;
		font-weight: 650;
	}

	.purchase-faq-list {
		border-block: 1px solid var(--border);
	}

	.purchase-faq-list details + details {
		border-top: 1px solid var(--border);
	}

	.purchase-faq-list summary {
		display: flex;
		min-height: 4rem;
		cursor: pointer;
		list-style: none;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-radius: 0.5rem;
		font-weight: 620;
	}

	.purchase-faq-list details[open] summary span:last-child {
		transform: rotate(45deg);
	}

	.purchase-faq-list p {
		max-width: 65ch;
		padding: 0 2rem 1.5rem 0;
		color: var(--muted-foreground);
		font-size: 0.88rem;
		line-height: 1.65;
	}

	.desktop-limits table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	.desktop-limits thead {
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 45%, transparent);
	}

	.desktop-limits tr + tr {
		border-top: 1px solid var(--border);
	}

	.desktop-limits th,
	.desktop-limits td {
		padding: 1rem 1.15rem;
		font-size: 0.82rem;
	}

	.desktop-limits th {
		font-weight: 650;
	}

	.desktop-limits thead th span,
	.desktop-limits thead th small {
		display: block;
	}

	.desktop-limits thead th small {
		margin-top: 0.3rem;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		font-weight: 500;
	}

	@media (min-width: 48rem) {
		.included-grid {
			grid-template-columns: 0.8fr 1.2fr;
			align-items: start;
		}

		.included-grid ul {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 64rem) {
		.mobile-limits {
			display: none;
		}

		.desktop-limits {
			display: block;
		}

		.purchase-faq-grid {
			grid-template-columns: minmax(18rem, 0.72fr) minmax(0, 1.28fr);
			gap: clamp(3rem, 7vw, 7rem);
		}
	}
</style>
