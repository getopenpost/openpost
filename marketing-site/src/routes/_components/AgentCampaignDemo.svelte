<script lang="ts">
	import { ArrowRight, Bot, CheckCircle2, Eye, KeyRound, ListChecks } from 'lucide-svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { Button } from '$lib/components/ui/button';
	import { developerDocsUrl, illustrativeLaunchRenditions } from '../_marketing';

	const handoff = [
		{
			title: 'Agent prepares',
			detail: 'Inspects the permitted workspace, reads the launch brief, and creates a base draft plus renditions.',
			icon: Bot
		},
		{
			title: 'Human reviews',
			detail: 'Checks the copy, media, format, destination, and time in the web app before scheduling.',
			icon: Eye
		},
		{
			title: 'Queue records the outcome',
			detail: 'Runs the schedule you chose and keeps success, provider errors, and retries visible.',
			icon: ListChecks
		}
	] as const;
</script>

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
			<div>
				<p class="section-label">Illustrative launch campaign</p>
				<h2 class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
					One brief in. Five reviewable destinations out.
				</h2>
			</div>
			<div class="lg:justify-self-end">
				<p class="max-w-2xl text-lg leading-8 text-muted-foreground">
					This example shows how the same product launch can change by audience and provider. It
					is sample copy, not a claim that these exact accounts or formats passed a live production test.
				</p>
			</div>
		</div>

		<div class="mt-10 overflow-hidden rounded-xl border bg-card">
			<div class="grid border-b lg:grid-cols-[19rem_1fr]">
				<div class="border-b bg-background/60 p-6 lg:border-r lg:border-b-0">
					<p class="text-sm font-semibold">Base launch brief</p>
					<p class="mt-4 text-sm leading-6 text-muted-foreground">
						Introduce OpenPost as the publishing workspace between an AI agent and social accounts.
						Explain human review, destination renditions, revocable access, visible queue state, and
						the compact self-hosted runtime.
					</p>
					<div class="mt-6 border-t pt-5">
						<p class="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
							<KeyRound class="mt-0.5 size-3.5 shrink-0 text-primary" />
							The agent uses an OpenPost token. It never receives a provider credential.
						</p>
					</div>
				</div>

			<div class="divide-y">
				{#each illustrativeLaunchRenditions as rendition (rendition.slug)}
					<article class="grid gap-4 p-5 sm:grid-cols-[10rem_1fr] sm:p-6">
						<div>
							<div class="flex items-center gap-2.5">
								<PlatformIcon platform={rendition.short} class="size-4" />
								<h3 class="font-semibold">{rendition.name}</h3>
							</div>
							<p class="mt-2 text-xs leading-5 text-primary">{rendition.purpose}</p>
						</div>
						<p class="text-sm leading-6 text-muted-foreground">{rendition.content}</p>
					</article>
					{/each}
				</div>
			</div>
		</div>

		<div class="mt-px grid gap-px overflow-hidden rounded-b-xl border bg-border md:grid-cols-3">
			{#each handoff as step, index (step.title)}
				{@const Icon = step.icon}
				<div class="bg-background p-5">
					<div class="flex items-center justify-between gap-4">
						<Icon class="size-4 text-primary" />
						<span class="font-mono text-xs text-muted-foreground">0{index + 1}</span>
					</div>
					<h3 class="mt-4 text-sm font-semibold">{step.title}</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p>
				</div>
			{/each}
		</div>

		<div class="mt-8 flex flex-col gap-5 border-t pt-8 sm:flex-row sm:items-center sm:justify-between">
			<p class="flex max-w-2xl items-start gap-3 text-sm leading-6 text-muted-foreground">
				<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" />
				Start inspection with workspace-scoped mcp:read. Grant mcp:full only when a trusted client
				must use state-changing operations. The server still enforces scope, operation class,
				validation, quotas, and audit records.
			</p>
			<Button href={`${developerDocsUrl}mcp`} variant="outline">
				Inspect the MCP boundary
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
	</div>
</section>
