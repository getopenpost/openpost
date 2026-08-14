<script lang="ts">
	import { ArrowRight, Check, GitBranch, LifeBuoy, Server, Waypoints } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { selfHostedDeploymentSummary } from '../_marketing';

	const responsibilities = [
		{
			title: 'Infrastructure and data',
			icon: Server,
			detail:
				'You provide the server, public HTTPS origin, database, media storage, monitoring, secrets, and access controls. You decide where OpenPost data is stored and who can administer it.'
		},
		{
			title: 'Upgrades and backups',
			icon: GitBranch,
			detail:
				'You track releases and security notices, schedule upgrades, and back up the database, media, and required secrets together. Test restores before relying on those backups.'
		},
		{
			title: 'Provider projects',
			icon: Waypoints,
			detail:
				'You create and maintain social network projects, callback URLs, permissions, reviews, and API budgets. OpenPost still sends requested content and access tokens to those networks.'
		},
		{
			title: 'Support boundary',
			icon: LifeBuoy,
			detail:
				'OpenPost publishes documentation, source, issues, and community help. You operate the service, support its users, respond to incidents, and maintain the privacy and retention practices for your deployment.'
		}
	] as const;

	const included = [
		'One Go service with the SvelteKit app embedded',
		'SQLite and local media by default',
		'PostgreSQL and S3-compatible media options',
		'Database-backed scheduling without required Redis',
		'The same Publication, Rendition, Workspace, API, CLI, and MCP model'
	] as const;
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">Self-hosted deployment</p>
			<h1 class="marketing-title mt-5">Operate OpenPost on your infrastructure.</h1>
			<p class="marketing-copy mt-6 max-w-3xl">
				Run the complete AGPL-licensed product on a server you control. You choose the data location
				and deployment settings, and you own the service work described below.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={selfHostedDeploymentSummary.docsUrl} size="lg">
					Open the deployment guide <ArrowRight data-icon="inline-end" />
				</Button>
				<Button href={selfHostedDeploymentSummary.sourceUrl} variant="outline" size="lg">
					View source on GitHub
				</Button>
			</div>
		</div>
		<aside class="rounded-2xl border bg-card p-6">
			<p class="text-sm font-semibold text-primary">No software fee</p>
			<p class="mt-3 text-3xl font-semibold">{selfHostedDeploymentSummary.softwareFee}</p>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				Self-hosting is not a Hosted service plan or a zero-price Hosted service tier. You pay for
				infrastructure and any social network or third-party services you use.
			</p>
		</aside>
	</div>
</section>

<section class="section-pad" aria-labelledby="responsibility-title">
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">Operating responsibility</p>
			<h2 id="responsibility-title" class="marketing-heading mt-4">
				Know what you take on before you deploy.
			</h2>
		</div>
		<div class="mt-10 grid border-y md:grid-cols-2">
			{#each responsibilities as responsibility, index (responsibility.title)}
				{@const Icon = responsibility.icon}
				<article
					class={[
						'py-7 md:p-7',
						index < 3 && 'border-b',
						index % 2 === 0 && 'md:border-r',
						index < 2 && 'md:border-b',
						index === 2 && 'md:border-b-0'
					]}
				>
					<Icon class="size-5 text-muted-foreground" aria-hidden="true" />
					<h3 class="mt-5 text-xl font-semibold">{responsibility.title}</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">{responsibility.detail}</p>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20" aria-labelledby="product-title">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
		<div>
			<p class="section-label">One product</p>
			<h2 id="product-title" class="mt-4 text-3xl font-semibold text-balance">
				The deployment changes. The publishing model does not.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				The Hosted service and a self-hosted deployment use the same OpenPost code and product
				terms. Hosted plan limits and operated services do not become part of your installation.
			</p>
		</div>
		<ul class="divide-y border-y">
			{#each included as item (item)}
				<li class="flex min-h-14 items-center gap-3 py-3 text-sm leading-6">
					<Check class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span>{item}</span>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell rounded-2xl border bg-card p-6 sm:p-10">
		<h2 class="text-3xl font-semibold text-balance">Start with the production checklist.</h2>
		<p class="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
			The documentation covers installation, configuration, provider projects, backups, health
			checks, logs, upgrades, and troubleshooting. Review the complete path before exposing an
			instance to users.
		</p>
		<div class="mt-7 flex flex-wrap gap-3">
			<Button href={selfHostedDeploymentSummary.productionChecklistUrl}
				>Review the production checklist</Button
			>
			<Button
				href={`${selfHostedDeploymentSummary.sourceUrl}/blob/main/SECURITY.md`}
				variant="outline"
			>
				Read the security policy
			</Button>
		</div>
	</div>
</section>
