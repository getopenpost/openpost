<script lang="ts">
	import { Check, ExternalLink, Server } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		appUrl,
		managedAccessSummary,
		managedSignupUrl,
		plans,
		selfHostingDocsUrl,
		siteUrl
	} from '../_marketing';

	const sharedFeatures = [
		'Composer, drafts, and account-specific content',
		'Calendar, posting slots, queue, and activity state',
		'Reusable media library',
		'CLI, HTTP API, and MCP tools',
		'Encrypted provider credentials'
	] as const;

	const comparisonRows = [
		{ label: 'Workspaces', values: plans.map((plan) => plan.workspaces) },
		{ label: 'Social accounts', values: plans.map((plan) => plan.accounts) },
		{ label: 'Scheduled posts each month', values: plans.map((plan) => plan.posts) },
		{ label: 'Media storage', values: plans.map((plan) => plan.storage) },
		{ label: 'Included seats', values: plans.map((plan) => plan.seats) },
		{ label: 'Team roles', values: ['No', 'No', 'No', 'Yes', 'Yes'] }
	] as const;
</script>

<svelte:head>
	<title>OpenPost pricing</title>
	<meta
		name="description"
		content="OpenPost managed publishing starts at €6 per month. Compare workspace, social-account, post, media, and seat limits or self-host without a software subscription."
	/>
	<link rel="canonical" href={`${siteUrl}/pricing`} />
</svelte:head>

<section class="border-b py-14 sm:py-18 lg:py-24">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="eyebrow">Pricing</p>
				<h1 class="mt-4 text-4xl leading-[1.03] font-semibold text-balance sm:text-6xl">
					Pay for managed capacity, not a different product edition.
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
					Every managed plan includes the composer, destination renditions, queue, API, CLI, and
					MCP access. Higher plans add capacity and shared team access.
				</p>
			</div>
			<div class="rounded-xl border bg-card p-6">
				<p class="font-semibold">Monthly managed app</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					{managedAccessSummary} Applicable taxes and final billing terms appear before checkout.
				</p>
				<a href="#plans" class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">Plans start at €6</a>
			</div>
		</div>
	</div>
</section>

<section id="plans" class="section-pad scroll-mt-20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
			{#each plans as plan (plan.id)}
				<article class="flex h-full flex-col rounded-xl border bg-card p-5 {plan.featured ? 'border-primary/60 ring-1 ring-primary/20' : ''}">
					<div class="flex items-start justify-between gap-3">
						<div>
							<h2 class="text-lg font-semibold">{plan.name}</h2>
							<p class="mt-2 text-3xl font-semibold">{plan.price}<span class="text-sm font-normal text-muted-foreground">/month</span></p>
						</div>
						{#if plan.featured}
							<span class="rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Popular</span>
						{/if}
					</div>
					<p class="mt-4 min-h-12 text-sm leading-6 text-muted-foreground">{plan.description}</p>
					<ul class="mt-5 flex-1 space-y-3">
						{#each plan.limits as limit (limit)}
							<li class="flex gap-2 text-sm leading-5 text-muted-foreground">
								<Check class="mt-0.5 size-4 shrink-0 text-primary" />
								<span>{limit}</span>
							</li>
						{/each}
					</ul>
					<Button href={`${appUrl}/register?plan=${plan.id}`} class="mt-6 w-full" variant={plan.featured ? 'default' : 'outline'}>
						Start {plan.name}
					</Button>
				</article>
			{/each}
		</div>

		<div class="mt-12 rounded-xl border bg-muted/20 p-6 sm:p-8">
			<p class="eyebrow">Included on every plan</p>
			<ul class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each sharedFeatures as feature (feature)}
					<li class="flex gap-3 text-sm leading-6 text-muted-foreground">
						<Check class="mt-0.5 size-4 shrink-0 text-primary" />
						<span>{feature}</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="max-w-3xl">
			<p class="eyebrow">Plan limits</p>
			<h2 class="mt-4 text-3xl leading-tight font-semibold text-balance sm:text-5xl">Compare the capacity in each plan.</h2>
			<p class="mt-5 text-lg leading-8 text-muted-foreground">Pro remains a single-user plan with higher limits. Team includes three seats; Agency includes five.</p>
		</div>
		<div class="mt-10 overflow-x-auto rounded-xl border bg-card">
			<table class="w-full min-w-[58rem] border-collapse text-left">
				<thead class="border-b bg-background/70">
					<tr>
						<th class="px-5 py-4 text-sm font-semibold" scope="col">Limit</th>
						{#each plans as plan (plan.id)}
							<th class="px-5 py-4 text-sm font-semibold" scope="col">{plan.name}</th>
						{/each}
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each comparisonRows as row (row.label)}
						<tr>
							<th class="px-5 py-4 text-sm font-medium" scope="row">{row.label}</th>
							{#each row.values as value, index (`${row.label}-${index}`)}
								<td class="px-5 py-4 text-sm text-muted-foreground">{value}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8">
		<div class="rounded-xl border bg-card p-6 sm:p-8">
			<Server class="size-5 text-primary" />
			<h2 class="mt-5 text-2xl font-semibold">Self-host the server</h2>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				The OpenPost server is available under AGPL-3.0-only without a software subscription. You provide the infrastructure, domain, email, storage, backups, provider apps, and any provider API costs.
			</p>
			<Button href={selfHostingDocsUrl} target="_blank" rel="noreferrer" class="mt-6" variant="outline">
				Self-hosting guide <ExternalLink data-icon="inline-end" />
			</Button>
		</div>
		<div class="rounded-xl border bg-card p-6 sm:p-8">
			<p class="eyebrow">Managed app</p>
			<h2 class="mt-4 text-2xl font-semibold">Create the account first, then activate publishing.</h2>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				Registration creates your account and one bootstrap workspace. Connecting a social
				account, uploading publishing media, or scheduling requires an active managed plan.
			</p>
			<Button href={managedSignupUrl} class="mt-6">Create a managed account</Button>
		</div>
	</div>
</section>
