<script lang="ts">
	import { ArrowRight, Bot, Braces, ExternalLink, KeyRound, Terminal } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		agentPublishingDocsUrl,
		apiGuideUrl,
		apiTokenDocsUrl,
		cliDocsUrl,
		githubUrl,
		mcpDocsUrl,
		openApiUrl
	} from '../_marketing';

	const interfaces = [
		{
			name: 'HTTP API',
			bestFor: 'Typed services, custom apps, and direct integrations.',
			detail:
				'Use the OpenAPI 3.1 contract to generate a client or call the workspace-scoped API directly.',
			href: apiGuideUrl,
			cta: 'Read the API guide',
			icon: Braces
		},
		{
			name: 'CLI',
			bestFor: 'Terminal work, scripts, CI, cron, and deploy jobs.',
			detail:
				'The CLI calls the same HTTP API and keeps named instances, tokens, and workspace selection explicit.',
			href: cliDocsUrl,
			cta: 'Use the CLI',
			icon: Terminal
		},
		{
			name: 'MCP server',
			bestFor: 'AI assistants that need to inspect or prepare publishing work.',
			detail:
				'Start read-only, search the operation catalogue, and grant change access only when the client needs it.',
			href: mcpDocsUrl,
			cta: 'Connect an assistant',
			icon: Bot
		}
	] as const;

	const boundaries = [
		'Every call stays inside an authenticated OpenPost workspace.',
		'API and MCP tokens can be limited to one workspace and removed later.',
		'MCP separates read-only queries from calls that change OpenPost or contact a network.',
		'Provider rules, account setup, plan limits, and publishing checks still apply.'
	] as const;
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell grid gap-12 lg:grid-cols-[1fr_22rem] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">Developers and agents</p>
			<h1 class="marketing-title mt-5">Use the interface that fits the job.</h1>
			<p class="marketing-copy mt-6">
				OpenPost exposes one publishing system through a typed HTTP API, a CLI, and an MCP server.
				They use the same workspace terms, access rules, provider checks, and publication states as
				the web app.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={openApiUrl} size="lg">
					OpenAPI JSON
					<ExternalLink data-icon="inline-end" />
				</Button>
				<Button href={agentPublishingDocsUrl} variant="outline" size="lg">
					Agent publishing guide
				</Button>
			</div>
		</div>
		<aside class="border-l pl-6">
			<KeyRound class="size-5 text-primary" aria-hidden="true" />
			<h2 class="mt-4 font-semibold">Start with the least access</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				Use a read-only or narrowly scoped token first. Social account keys stay inside OpenPost and
				are never returned to the client.
			</p>
			<a
				class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary"
				href={apiTokenDocsUrl}
			>
				Token and scope guide <ArrowRight class="size-4" aria-hidden="true" />
			</a>
		</aside>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">Three maintained interfaces</p>
			<h2 class="marketing-heading mt-4">One contract, different clients.</h2>
			<p class="mt-5 text-lg leading-8 text-muted-foreground">
				Choose by who or what will run the work. You can mix these interfaces without creating a
				second publishing model.
			</p>
		</div>
		<div class="mt-10 divide-y border-y">
			{#each interfaces as item (item.name)}
				{@const Icon = item.icon}
				<article class="grid gap-5 py-7 sm:grid-cols-[3rem_1fr_auto] sm:items-center">
					<div class="flex size-10 items-center justify-center">
						<Icon class="size-5 text-primary" aria-hidden="true" />
					</div>
					<div>
						<h3 class="text-xl font-semibold">{item.name}</h3>
						<p class="mt-2 text-sm font-medium text-foreground">{item.bestFor}</p>
						<p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{item.detail}</p>
					</div>
					<a
						class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
						href={item.href}
					>
						{item.cta}
						<ArrowRight class="size-4" aria-hidden="true" />
					</a>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
		<div>
			<p class="section-label">Shared safety boundary</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance">
				Automation does not bypass product rules.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				A client can only do what its token, workspace role, plan, connected accounts, and provider
				readiness allow.
			</p>
		</div>
		<ul class="divide-y border-y">
			{#each boundaries as boundary (boundary)}
				<li class="flex gap-4 py-5 text-sm leading-6 text-muted-foreground">
					<span class="mt-2 size-1.5 shrink-0 rounded-sm bg-primary" aria-hidden="true"></span>
					<span>{boundary}</span>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="section-pad text-center">
	<div class="marketing-shell">
		<h2 class="marketing-heading mx-auto">Inspect the contract before writing code.</h2>
		<p class="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
			The generated OpenAPI JSON is authoritative. The source and developer docs explain how the
			interfaces share authorization and workspace boundaries.
		</p>
		<div class="mt-8 flex flex-wrap justify-center gap-3">
			<Button href={openApiUrl} size="lg">Open the contract</Button>
			<Button href={githubUrl} variant="outline" size="lg">
				Browse the source
				<ExternalLink data-icon="inline-end" />
			</Button>
		</div>
	</div>
</section>
