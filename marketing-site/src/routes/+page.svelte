<script lang="ts">
	import {
		ArrowRight,
		ChevronRight,
		Command,
		Database,
		Github,
		Terminal
	} from 'lucide-svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import AgentCampaignDemo from './_components/AgentCampaignDemo.svelte';
	import FaqSection from './_components/FaqSection.svelte';
	import PricingComparison from './_components/PricingComparison.svelte';
	import ProviderReadinessMatrix from './_components/ProviderReadinessMatrix.svelte';
	import VideoDemo from './_components/VideoDemo.svelte';
	import {
		demoVideoEmbedUrl,
		demoVideoThumbnailUrl,
		docsUrl,
		faqs,
		githubUrl,
		managedAccessSummary,
		managedSignupUrl,
		productFeatures,
		securityItems,
		selfHostingDocsUrl,
		siteUrl,
		workflowBlocks
	} from './_marketing';

	const heroFlow = [
		{ number: '01', title: 'Agent prepares', detail: 'Brief, accounts, media, and destination drafts.' },
		{ number: '02', title: 'You review', detail: 'Copy, media, format, and timing in the web app.' },
		{ number: '03', title: 'Queue runs', detail: 'Scheduled work survives restarts and publishes on time.' },
		{ number: '04', title: 'Outcomes stay visible', detail: 'Success, provider errors, and retries remain inspectable.' }
	] as const;

	const automationSurfaces = [
		{ label: 'CLI', description: 'Scripts, cron, and CI', icon: Terminal },
		{ label: 'MCP', description: 'Assistant workflows', icon: Command },
		{ label: 'API', description: 'Direct integrations', icon: Database }
	] as const;
</script>

<svelte:head>
	<title>OpenPost - Publishing for humans and AI agents</title>
	<meta
		name="description"
		content="OpenPost is the publishing workspace between AI agents and social accounts: destination renditions, human review, revocable access, and a visible queue."
	/>
	<link rel="canonical" href={siteUrl} />
	<meta name="robots" content="index, follow" />
	<meta property="og:url" content={siteUrl} />
	<meta property="og:title" content="OpenPost - Publishing for humans and AI agents" />
	<meta
		property="og:description"
		content="Let an agent prepare the campaign. Review every destination. Schedule through one visible queue."
	/>
	<meta name="twitter:title" content="OpenPost - Publishing for humans and AI agents" />
	<meta
		name="twitter:description"
		content="Provider-aware, human-reviewed publishing. Hosted or self-hosted."
	/>
</svelte:head>

<section class="overflow-hidden border-b">
	<div class="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
		<div class="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
			<div>
				<Badge class="border-primary/25 bg-primary/10 text-primary">
					Agent-assisted · Human-controlled
				</Badge>
				<h1
					class="mt-6 max-w-3xl text-4xl leading-[1.04] font-semibold tracking-tight text-balance sm:text-6xl"
				>
					The publishing workspace between your AI agent and your social accounts.
				</h1>
				<p class="mt-6 max-w-2xl text-lg leading-8 text-pretty text-muted-foreground sm:text-xl">
					Let an agent prepare one campaign and tailor each destination. Review the result in
					the web app, then schedule through a queue that shows every outcome.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">
						Try the managed app
						<ArrowRight data-icon="inline-end" />
					</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">
						Self-host OpenPost
						<ChevronRight data-icon="inline-end" />
					</Button>
				</div>
				<a
					href="#demo"
					class="mt-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
				>
					Watch the current product tour before you sign up
					<ArrowRight class="size-4" />
				</a>
				<p class="mt-5 max-w-2xl text-xs leading-5 text-muted-foreground">
					{managedAccessSummary}
				</p>
			</div>

			<div class="min-w-0">
				<div class="marketing-frame overflow-hidden rounded-lg p-2">
					<div class="flex h-9 items-center justify-between gap-3 border-b px-2.5">
						<span class="truncate font-mono text-xs text-muted-foreground">app.openpost.social</span>
						<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
							<span class="size-1.5 rounded-full bg-primary"></span>
							Draft saved
						</span>
					</div>
					<img
						src="/assets/screenshots/main-dark.png"
						alt="OpenPost composer with account destinations and scheduling controls"
						class="mt-2 block aspect-[16/10] w-full rounded-md border object-contain object-top"
						width="1440"
						height="900"
						fetchpriority="high"
					/>
				</div>
			</div>
		</div>

		<div class="mt-14 border-y">
			<div class="grid sm:grid-cols-2 lg:grid-cols-4">
				{#each heroFlow as step (step.number)}
					<div class="border-b py-5 sm:px-5 sm:odd:border-r lg:border-r lg:border-b-0 lg:first:pl-0 lg:last:border-r-0">
						<div class="flex gap-4">
							<span class="font-mono text-xs text-primary">{step.number}</span>
							<div>
								<p class="text-sm font-semibold">{step.title}</p>
								<p class="mt-1 text-sm leading-6 text-muted-foreground">{step.detail}</p>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

	</div>
</section>

<VideoDemo videoSrc={demoVideoEmbedUrl} thumbnailSrc={demoVideoThumbnailUrl} />

<AgentCampaignDemo />

<section class="section-pad">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
			<div>
				<p class="section-label">The control boundary</p>
				<h2 class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
					Automation can prepare the work without owning the accounts.
				</h2>
			</div>
			<p class="max-w-2xl text-lg leading-8 text-muted-foreground lg:justify-self-end">
				Agents use revocable OpenPost credentials, not social provider tokens. You choose the
				workspace boundary and whether a client may only read or may also change state.
			</p>
		</div>

		<div class="mt-12 grid border-t sm:grid-cols-2 lg:grid-cols-4">
			{#each workflowBlocks as block, index (block.title)}
				{@const Icon = block.icon}
				<article class="border-b py-6 sm:px-5 sm:odd:border-r lg:border-r lg:border-b-0 lg:first:pl-0 lg:last:border-r-0">
					<div class="flex items-center justify-between gap-4">
						<Icon class="size-5 text-primary" />
						<span class="font-mono text-xs text-muted-foreground">0{index + 1}</span>
					</div>
					<h3 class="mt-5 font-semibold">{block.title}</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">{block.description}</p>
				</article>
			{/each}
		</div>

		<div class="mt-18 grid gap-20">
			{#each productFeatures as feature, index (feature.title)}
				{@const Icon = feature.icon}
				<article class="grid items-center gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-14">
					<div class={index % 2 === 1 ? 'lg:order-2' : ''}>
						<p class="section-label">{feature.eyebrow}</p>
						<h3 class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
							{feature.title}
						</h3>
						<p class="mt-4 text-base leading-7 text-muted-foreground">{feature.description}</p>
						<p class="mt-6 inline-flex items-center gap-2 text-sm font-medium">
							<Icon class="size-4 text-primary" />
							{feature.eyebrow} in OpenPost
						</p>
					</div>
					<figure class="marketing-frame min-w-0 overflow-hidden rounded-lg p-2">
						<img
							src={feature.image}
							alt={feature.alt}
							class="block aspect-[16/10] w-full rounded-md border object-contain object-top"
							width="1440"
							height="900"
							loading="lazy"
							decoding="async"
						/>
					</figure>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
			<div>
				<p class="section-label">Agent and automation access</p>
				<h2 class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
					Give agents a publishing surface, not your provider secrets.
				</h2>
				<p class="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
					MCP, API, and CLI requests pass through OpenPost authorization, workspace scope,
					provider validation, quotas, and audit records. Connected-account credentials stay in
					OpenPost.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={docsUrl} variant="secondary">
						Set up automation access
						<ArrowRight data-icon="inline-end" />
					</Button>
					<Button href="/tools" variant="outline">Use the free tools</Button>
				</div>
			</div>

			<div class="min-w-0">
				<div class="overflow-hidden rounded-lg border bg-[oklch(0.11_0.007_55)] text-[oklch(0.88_0.01_85)]">
					<div class="flex h-10 items-center justify-between border-b border-white/10 px-4">
						<span class="font-mono text-xs text-white/55">MCP outline · illustrative</span>
						<span class="size-1.5 rounded-full bg-primary"></span>
					</div>
					<div class="overflow-x-auto p-5 font-mono text-sm leading-7">
						<p class="text-white/55">mcp:read → inspect accounts, media, open schedule</p>
						<p class="mt-3 min-w-max">query_operation → workspace state</p>
						<p class="min-w-max">mcp:full → execute_operation → draft + renditions</p>
						<p class="mt-3 text-primary">draft created · ready for human review</p>
					</div>
				</div>
				<div class="mt-px grid gap-px overflow-hidden rounded-b-lg border bg-border sm:grid-cols-3">
					{#each automationSurfaces as surface (surface.label)}
						{@const Icon = surface.icon}
						<div class="bg-card p-4">
							<Icon class="size-4 text-primary" />
							<p class="mt-3 text-sm font-semibold">{surface.label}</p>
							<p class="mt-1 text-xs text-muted-foreground">{surface.description}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</section>

<ProviderReadinessMatrix />

<PricingComparison />

<section class="section-pad">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[0.76fr_1.24fr]">
			<div>
				<p class="section-label">Security</p>
				<h2 class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
					Revoke the agent without reconnecting every social account.
				</h2>
				<p class="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
					Provider credentials are encrypted at rest. Dedicated API and MCP tokens can be bound
					to one workspace, reviewed through recent activity, and revoked independently.
				</p>
				<Button href="/security" class="mt-8" variant="secondary">Read the security overview</Button>
			</div>

			<div class="grid border-t sm:grid-cols-2">
				{#each securityItems as item (item.title)}
					{@const Icon = item.icon}
					<article class="border-b py-6 sm:px-5 sm:odd:border-r">
						<Icon class="size-5 text-primary" />
						<h3 class="mt-4 font-semibold">{item.title}</h3>
						<p class="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
					</article>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="border-y bg-primary text-primary-foreground">
	<div class="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
		<div>
			<h2 class="text-3xl font-semibold tracking-tight text-balance">Run the same publishing boundary on your own server.</h2>
			<p class="mt-3 max-w-2xl text-base leading-7 text-primary-foreground/75">
				Use one binary or container, SQLite by default, local media by default, and the built-in
				database queue. Redis is not required.
			</p>
		</div>
		<div class="flex flex-wrap gap-3">
			<Button href={selfHostingDocsUrl} variant="secondary">Self-hosting guide</Button>
			<Button
				href={githubUrl}
				variant="outline"
				class="border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/10"
			>
				<Github data-icon="inline-start" />
				View source
			</Button>
		</div>
	</div>
</section>

<FaqSection items={faqs} />

<section class="section-pad border-t">
	<div class="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
		<div class="border-l-2 border-primary pl-6 sm:pl-10">
			<p class="section-label">Choose how to run it</p>
			<h2 class="mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-6xl">
				Prepare with an agent. Publish with control.
			</h2>
			<p class="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
				Use the managed app from €6 per month, or run the complete AGPL-licensed server on
				your own infrastructure without a software subscription.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={managedSignupUrl} size="lg">
					Try the managed app
					<ArrowRight data-icon="inline-end" />
				</Button>
				<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-host OpenPost</Button>
			</div>
		</div>
	</div>
</section>
