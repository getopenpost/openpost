<script lang="ts">
	import { ArrowRight, ExternalLink, GitBranch, Globe2, UserRound } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { githubUrl, managedSignupUrl, supportMailUrl } from '../_marketing';

	const principles = [
		{
			title: 'Start with the work',
			detail:
				'OpenPost starts with a launch, update, lesson, or idea, then helps prepare the versions each destination needs.'
		},
		{
			title: 'Keep provider truth visible',
			detail:
				'Formats, limits, account setup, review needs, publishing state, and failures stay visible instead of being hidden by automation.'
		},
		{
			title: 'Share one product model',
			detail:
				'The web app, mobile app, API, CLI, MCP server, and self-hosted service use the same publications, renditions, workspaces, and permissions.'
		}
	] as const;
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell grid gap-12 lg:grid-cols-[1fr_22rem] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">About OpenPost</p>
			<h1 class="marketing-title mt-5">A content workspace for companies of one.</h1>
			<p class="marketing-copy mt-6">
				OpenPost helps solo founders and small teams turn the work they are already doing into
				channel-ready content, publish it across supported networks, and track what happened.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={managedSignupUrl} size="lg">Start free trial</Button>
				<Button href={githubUrl} variant="outline" size="lg">
					Browse the source
					<ExternalLink data-icon="inline-end" />
				</Button>
			</div>
		</div>
		<aside class="border-l pl-6">
			<UserRound class="size-5 text-primary" aria-hidden="true" />
			<h2 class="mt-4 font-semibold">Operated by Rodrigo Dias</h2>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				OpenPost is an independent product and open-source project operated from Porto, Portugal.
				The Hosted service is the main product. Self-hosting remains a complete deployment option.
			</p>
			<a
				class="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
				href={supportMailUrl}
			>
				Contact the operator <ArrowRight class="size-4" aria-hidden="true" />
			</a>
		</aside>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-12 lg:grid-cols-[0.68fr_1.32fr]">
		<div>
			<p class="section-label">Why it exists</p>
			<h2 class="marketing-heading mt-4">Publishing should not need a content team.</h2>
		</div>
		<div class="max-w-3xl space-y-6 text-lg leading-8 text-muted-foreground">
			<p>
				Small companies still need to announce launches, explain decisions, share lessons, and stay
				visible. The work is real, but moving it through separate writing, media, scheduling, and
				reporting tools creates repeat work.
			</p>
			<p>
				OpenPost keeps one source idea with destination-specific versions, media, timing, provider
				settings, and results. It aims to remove repeat work without pretending every network works
				the same way.
			</p>
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">Product principles</p>
			<h2 class="marketing-heading mt-4">Clear outcomes and visible limits.</h2>
		</div>
		<div class="mt-10 divide-y border-y lg:grid lg:grid-cols-3 lg:divide-x lg:divide-y-0">
			{#each principles as principle (principle.title)}
				<article class="py-7 lg:px-7 lg:first:pl-0 lg:last:pr-0">
					<h3 class="text-xl font-semibold">{principle.title}</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">{principle.detail}</p>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-12 lg:grid-cols-2">
		<div>
			<Globe2 class="size-5 text-primary" aria-hidden="true" />
			<h2 class="mt-5 text-3xl font-semibold tracking-[-0.03em] text-balance">Hosted service</h2>
			<p class="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
				OpenPost runs the server, updates, database, media storage, and public app. Customers
				connect their accounts and use the web, mobile, API, CLI, or MCP interfaces.
			</p>
			<Button href={managedSignupUrl} class="mt-6">Try the Hosted service</Button>
		</div>
		<div class="border-t pt-10 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12">
			<GitBranch class="size-5 text-primary" aria-hidden="true" />
			<h2 class="mt-5 text-3xl font-semibold tracking-[-0.03em] text-balance">
				Open-source project
			</h2>
			<p class="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
				The full service is AGPL-3.0-only. Operators can deploy it on their own infrastructure,
				choose storage and provider settings, and own updates, security, backups, and support.
			</p>
			<Button href={githubUrl} variant="outline" class="mt-6">View the repository</Button>
		</div>
	</div>
</section>
