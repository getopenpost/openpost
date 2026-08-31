<script lang="ts">
	import {
		ArrowRight,
		Box,
		Check,
		CheckCircle2,
		Code2,
		Database,
		ExternalLink,
		GitBranch,
		LifeBuoy,
		Server,
		Waypoints
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		developerDocsUrl,
		githubUrl,
		managedAccessSummary,
		managedSignupUrl,
		selfHostedDeploymentSummary,
		selfHostingDocsUrl
	} from '../_marketing';

	const licenseUrl = `${githubUrl}/blob/main/LICENSE`;

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

	const deploymentFacts = [
		{
			title: 'One application',
			detail: 'The SvelteKit frontend is embedded in the Go server binary.',
			icon: Box
		},
		{
			title: 'SQLite by default',
			detail: 'Use SQLite for a compact install, or PostgreSQL for a larger deployment.',
			icon: Database
		},
		{
			title: 'Database-backed jobs',
			detail: 'Scheduled posts survive restarts without a required Redis service.',
			icon: Waypoints
		},
		{
			title: 'Configurable media',
			detail: 'Store media locally or on a configured S3-compatible backend.',
			icon: Server
		}
	] as const;

	const deploymentChoices = [
		{
			name: 'Hosted service',
			bestFor: 'People who want to publish without operating a server.',
			items: ['We handle hosting and updates for you', managedAccessSummary],
			cta: 'Start 14-day trial',
			href: managedSignupUrl
		},
		{
			name: 'Self-hosted OpenPost',
			bestFor: 'Teams that need control over the server and stored data.',
			items: [
				'Run the complete AGPL-3.0-only server',
				'Choose the database, media storage, domain, and social app keys',
				'Own updates, TLS, secrets, backups, and restore tests'
			],
			cta: 'Read the deployment guide',
			href: selfHostingDocsUrl
		}
	] as const;
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">Self-hosting and source</p>
			<h1 class="marketing-title mt-5">Your server. Your data. The same OpenPost.</h1>
			<p class="marketing-copy mt-6 max-w-3xl">
				Run the complete AGPL-3.0-only product on infrastructure you control. You choose the data
				location and deployment settings, and you own the operating work described below.
			</p>
			<p class="mt-4 text-sm font-medium text-muted-foreground">
				For operators who want to run OpenPost on infrastructure they control.
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
			<div class="mt-6 border-t pt-5">
				<Code2 class="size-5 text-primary" aria-hidden="true" />
				<p class="mt-3 font-semibold">AGPL-3.0-only</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Inspect and modify the source under the licence terms. Network users of a modified service
					must be able to receive its corresponding source.
				</p>
				<a
					href={licenseUrl}
					target="_blank"
					rel="noreferrer"
					class="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary"
				>
					Read the licence <ExternalLink class="size-3.5" aria-hidden="true" />
				</a>
			</div>
		</aside>
	</div>
</section>

<section class="section-pad" aria-labelledby="deployment-choice-title">
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">Choose how to run it</p>
			<h2 id="deployment-choice-title" class="marketing-heading mt-4">
				The product stays the same. The server work changes.
			</h2>
		</div>
		<div class="mt-10 grid border-y lg:grid-cols-2 lg:divide-x">
			{#each deploymentChoices as choice (choice.name)}
				<article class="flex h-full flex-col py-8 lg:px-8 lg:first:pl-0 lg:last:pr-0">
					<h3 class="text-2xl font-semibold">{choice.name}</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">{choice.bestFor}</p>
					<ul class="mt-6 space-y-3">
						{#each choice.items as item (item)}
							<li class="flex gap-3 text-sm leading-6 text-muted-foreground">
								<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
								<span>{item}</span>
							</li>
						{/each}
					</ul>
					<Button
						href={choice.href}
						class="mt-8 self-start"
						variant={choice.name === 'Hosted service' ? 'default' : 'outline'}
					>
						{choice.cta}
					</Button>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20" aria-labelledby="deployment-facts-title">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[0.65fr_1.35fr]">
		<div>
			<p class="section-label">Small server setup</p>
			<h2 id="deployment-facts-title" class="mt-4 text-3xl font-semibold text-balance">
				Run fewer required services.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				The default setup is small. You still need safe settings, monitoring, backups, and social
				network access.
			</p>
		</div>
		<div class="grid divide-y border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
			{#each deploymentFacts as fact (fact.title)}
				{@const Icon = fact.icon}
				<article class="p-6 odd:border-b sm:odd:border-b">
					<Icon class="size-5 text-primary" aria-hidden="true" />
					<h3 class="mt-5 font-semibold">{fact.title}</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">{fact.detail}</p>
				</article>
			{/each}
		</div>
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
		<p class="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
			The repository also includes Devenv commands for setup, checks, tests, builds, and release
			verification. Issues and pull requests are public.
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
			<Button href={developerDocsUrl} variant="ghost">Development guide</Button>
		</div>
	</div>
</section>
