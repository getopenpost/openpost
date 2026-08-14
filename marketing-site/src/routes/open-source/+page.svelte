<script lang="ts">
	import {
		ArrowRight,
		Box,
		CheckCircle2,
		Code2,
		Database,
		ExternalLink,
		GitBranch,
		Server,
		Waypoints
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		developerDocsUrl,
		githubUrl,
		managedAccessSummary,
		managedSignupUrl,
		selfHostingDocsUrl
	} from '../_marketing';

	const licenseUrl = `${githubUrl}/blob/main/LICENSE`;
	const deploymentFacts = [
		{
			title: 'One application',
			detail: 'The SvelteKit frontend is embedded in the Go server binary.',
			icon: Box
		},
		{
			title: 'SQLite by default',
			detail:
				'Use a local database for a compact install; hosted cloud deployments can use PostgreSQL.',
			icon: Database
		},
		{
			title: 'Database-backed jobs',
			detail: 'Scheduled posts survive restarts. You do not need Redis.',
			icon: Waypoints
		},
		{
			title: 'Configurable media',
			detail: 'Store media on the local filesystem or a configured object-storage backend.',
			icon: Server
		}
	] as const;

	const choices = [
		{
			name: 'Managed OpenPost',
			bestFor: 'People who want to publish without operating a server.',
			items: [
				'We handle hosting and updates for you',
				'AI, API, CLI, and web access follow the same workspace rules',
				managedAccessSummary
			],
			cta: 'Try the managed app',
			href: managedSignupUrl
		},
		{
			name: 'Self-hosted OpenPost',
			bestFor: 'Teams that need control over the server and stored data.',
			items: [
				'Run the complete AGPL-licensed server',
				'Choose the database, media storage, domain, and social app keys',
				'Own updates, TLS, secrets, backups, and restore tests'
			],
			cta: 'Read the self-hosting guide',
			href: selfHostingDocsUrl
		}
	] as const;
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[1fr_22rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="section-label">Open source</p>
				<h1 class="marketing-title mt-5">Run OpenPost your way.</h1>
				<p class="mt-5 text-sm font-medium text-foreground">
					This page is for operators and developers evaluating the open-source deployment path.
				</p>
				<p class="marketing-copy mt-6">
					Use the managed app or deploy the AGPL-licensed server yourself. Both use the same posting
					tools, account settings, and status tracking.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={githubUrl} size="lg">
						Browse the source
						<ExternalLink data-icon="inline-end" />
					</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-hosting guide</Button>
				</div>
			</div>
			<div class="border-l pl-6">
				<Code2 class="size-5 text-primary" />
				<p class="mt-4 font-semibold">AGPL-3.0-only</p>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					You may use, inspect, and modify the software under the licence terms. Network users of a
					modified service must be able to receive its corresponding source.
				</p>
				<a
					href={licenseUrl}
					target="_blank"
					rel="noreferrer"
					class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary"
				>
					Read the licence <ExternalLink class="size-3.5" />
				</a>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">Choose how to run it</p>
			<h2 class="marketing-heading mt-4">The product stays the same. The server work changes.</h2>
		</div>
		<div class="mt-10 grid border-y lg:grid-cols-2 lg:divide-x">
			{#each choices as choice (choice.name)}
				<article class="flex h-full flex-col py-8 lg:px-8 lg:first:pl-0 lg:last:pr-0">
					<h3 class="text-2xl font-semibold">{choice.name}</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">
						{choice.bestFor}
					</p>
					<ul class="mt-6 space-y-3">
						{#each choice.items as item (item)}
							<li class="flex gap-3 text-sm leading-6 text-muted-foreground">
								<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" />
								<span>{item}</span>
							</li>
						{/each}
					</ul>
					<Button
						href={choice.href}
						class="mt-8 self-start"
						variant={choice.name === 'Managed OpenPost' ? 'default' : 'outline'}
					>
						{choice.cta}
					</Button>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell">
		<div class="grid gap-10 lg:grid-cols-[0.65fr_1.35fr]">
			<div>
				<p class="section-label">Small server setup</p>
				<h2 class="mt-4 text-3xl font-semibold text-balance">Run fewer required services.</h2>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					The default setup is small. You still need safe settings, monitoring, backups, and social
					network access.
				</p>
			</div>
			<div class="grid divide-y border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
				{#each deploymentFacts as fact (fact.title)}
					{@const Icon = fact.icon}
					<article class="p-6 odd:border-b sm:odd:border-b">
						<Icon class="size-5 text-primary" />
						<h3 class="mt-5 font-semibold">{fact.title}</h3>
						<p class="mt-2 text-sm leading-6 text-muted-foreground">
							{fact.detail}
						</p>
					</article>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-12 lg:grid-cols-2">
		<div>
			<p class="section-label">Before you self-host</p>
			<h2 class="mt-4 text-3xl font-semibold text-balance">
				Plan how you will store and restore data.
			</h2>
			<ol class="mt-8 space-y-5">
				<li class="grid grid-cols-[2rem_1fr] gap-4">
					<span class="font-mono text-sm text-primary">01</span>
					<p class="text-sm leading-6 text-muted-foreground">
						Choose a public HTTPS origin and configure exact OAuth callbacks.
					</p>
				</li>
				<li class="grid grid-cols-[2rem_1fr] gap-4">
					<span class="font-mono text-sm text-primary">02</span>
					<p class="text-sm leading-6 text-muted-foreground">
						Generate strong JWT and encryption keys and keep them outside the image and repository.
					</p>
				</li>
				<li class="grid grid-cols-[2rem_1fr] gap-4">
					<span class="font-mono text-sm text-primary">03</span>
					<p class="text-sm leading-6 text-muted-foreground">
						Choose SQLite or PostgreSQL and local or object media storage for the expected workload.
					</p>
				</li>
				<li class="grid grid-cols-[2rem_1fr] gap-4">
					<span class="font-mono text-sm text-primary">04</span>
					<p class="text-sm leading-6 text-muted-foreground">
						Back up the database, media, and required secrets together, then prove the restore
						works.
					</p>
				</li>
			</ol>
		</div>
		<div class="border-t pt-8">
			<div class="flex size-10 items-center justify-center">
				<GitBranch class="size-5 text-primary" />
			</div>
			<h2 class="mt-5 text-2xl font-semibold">Contribute from the same project environment</h2>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				The repository includes Devenv commands for installation, setup, checks, tests, builds, and
				release verification. Issues and pull requests are public.
			</p>
			<div class="mt-6 flex flex-wrap gap-3">
				<Button href={developerDocsUrl} variant="outline">Development guide</Button>
				<Button href={`${githubUrl}/issues`} variant="ghost">
					Browse issues <ArrowRight data-icon="inline-end" />
				</Button>
			</div>
		</div>
	</div>
</section>
