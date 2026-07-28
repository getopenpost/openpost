<script lang="ts">
	import { ArrowRight, Check, MonitorCheck, Server } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		managedAccessSummary,
		managedSignupUrl,
		selfHostingDocsUrl
	} from '../_marketing';

	const managedIncludes = [
		'Hosted updates, TLS, database, media storage, and queue operations',
		'Complete composer, renditions, scheduling, API, CLI, and MCP access',
		'Published capacity limits from €6 per month'
	] as const;

	const selfHostedIncludes = [
		'Complete AGPL-3.0-only server without a software subscription',
		'One Go binary or container, SQLite and local media by default',
		'You operate TLS, secrets, provider apps, backups, updates, and restore tests'
	] as const;
</script>

<section id="pricing" class="section-pad scroll-mt-20 border-y bg-muted/20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-8 lg:grid-cols-[0.76fr_1.24fr] lg:items-end">
			<div>
				<p class="section-label">Two ways to run OpenPost</p>
				<h2 class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
					Use the managed app or own the runtime.
				</h2>
			</div>
			<p class="max-w-2xl text-lg leading-8 text-muted-foreground lg:justify-self-end">
				The managed app and self-hosted edition use the same open product. The choice is whether
				OpenPost operates the service or you do.
			</p>
		</div>

		<div class="mt-10 grid gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-2">
			<article class="flex h-full flex-col bg-card p-6 sm:p-8">
				<MonitorCheck class="size-5 text-primary" />
				<p class="mt-5 text-sm font-medium text-primary">Managed OpenPost</p>
				<h3 class="mt-2 text-2xl font-semibold">Start publishing without operating the server.</h3>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">{managedAccessSummary}</p>
				<ul class="mt-6 grid gap-3">
					{#each managedIncludes as item (item)}
						<li class="flex gap-3 text-sm leading-6">
							<Check class="mt-1 size-4 shrink-0 text-primary" />
							<span>{item}</span>
						</li>
					{/each}
				</ul>
				<div class="mt-8 flex flex-wrap items-center gap-4">
					<Button href={managedSignupUrl}>
						Try the managed app
						<ArrowRight data-icon="inline-end" />
					</Button>
					<a href="/pricing" class="text-sm font-medium text-muted-foreground hover:text-foreground">
						Compare all plans
					</a>
				</div>
			</article>

			<article class="flex h-full flex-col bg-background p-6 sm:p-8">
				<Server class="size-5 text-primary" />
				<p class="mt-5 text-sm font-medium text-primary">Self-hosted OpenPost</p>
				<h3 class="mt-2 text-2xl font-semibold">Run the complete publishing service yourself.</h3>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					Choose your domain, database, media storage, provider applications, and operating controls.
				</p>
				<ul class="mt-6 grid gap-3">
					{#each selfHostedIncludes as item (item)}
						<li class="flex gap-3 text-sm leading-6">
							<Check class="mt-1 size-4 shrink-0 text-primary" />
							<span>{item}</span>
						</li>
					{/each}
				</ul>
				<Button href={selfHostingDocsUrl} class="mt-8 self-start" variant="outline">
					Self-host OpenPost
					<ArrowRight data-icon="inline-end" />
				</Button>
			</article>
		</div>
	</div>
</section>
