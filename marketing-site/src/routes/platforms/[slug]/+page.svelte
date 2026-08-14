<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import { ArrowLeft, ArrowRight, ExternalLink, Info, ShieldAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import PlatformPreview from '../_components/PlatformPreview.svelte';
	import { getPlatform, managedSignupUrl } from '../../_marketing';

	const slug = $derived(page.params.slug ?? '');
	const platform = $derived.by(() => {
		const found = getPlatform(slug);
		if (!found) error(404, 'Platform not found');
		return found;
	});
	const requiresProviderApproval = $derived(platform.requiresProviderApproval);
</script>

<section class="border-b py-10 sm:py-16 lg:py-20">
	<div class="marketing-shell">
		<a
			href="/platforms"
			class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			All platforms
		</a>
		<div class="mt-7 grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
			<div>
				<div class="flex items-center gap-3">
					<span class="grid size-11 place-items-center rounded-lg bg-muted">
						<PlatformIcon platform={platform.short} class="size-5" />
					</span>
					<div>
						<p class="text-sm font-semibold">{platform.name}</p>
						<p class="text-xs text-muted-foreground">{platform.auth}</p>
					</div>
				</div>
				<h1
					class="mt-6 max-w-3xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
				>
					{platform.heroTitle}
				</h1>
				<p class="mt-5 text-sm font-medium text-foreground">
					This page is for people deciding whether OpenPost fits their {platform.name} publishing workflow.
				</p>
				<p class="marketing-copy mt-5">{platform.description}</p>
				<div class="mt-5 grid gap-2 text-sm text-muted-foreground">
					<p class="inline-flex items-start gap-2">
						<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span>
							<strong class="font-medium text-foreground">Implemented:</strong>
							{platform.implementationDetail}
						</span>
					</p>
					<p class="inline-flex items-start gap-2">
						<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span>
							<strong class="font-medium text-foreground">Hosted service certification:</strong>
							{platform.managedCertificationDetail}
						</span>
					</p>
				</div>
				{#if requiresProviderApproval}
					<p
						class="mt-5 inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
					>
						<ShieldAlert class="size-4" aria-hidden="true" />
						Your social app may need approval before it can publish.
					</p>
				{/if}
				<div class="mt-7 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg" data-agent-exclude>
						Try OpenPost
						<ArrowRight data-icon="inline-end" />
					</Button>
					<Button
						href={platform.docsUrl}
						target="_blank"
						rel="noreferrer"
						variant="outline"
						size="lg"
					>
						Platform guide
						<ExternalLink data-icon="inline-end" />
					</Button>
				</div>
			</div>
			<div data-agent-exclude class="grid place-items-center rounded-2xl bg-muted/25 p-3 sm:p-6">
				<PlatformPreview {platform} />
			</div>
		</div>
	</div>
</section>

<section class="section-pad" aria-labelledby="formats-title">
	<div class="marketing-shell">
		<div class="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
			<div>
				<p class="section-label">Formats and limits</p>
				<h2 id="formats-title" class="marketing-heading mt-4">
					Different formats, different rules.
				</h2>
			</div>
			<p class="marketing-copy lg:justify-self-end">
				OpenPost checks the text and media rules for the format you choose.
			</p>
		</div>

		<div data-agent-exclude class="mt-10 grid gap-3 md:hidden">
			{#each platform.formats as format (format.name)}
				<article class="rounded-xl border bg-card p-5">
					<h3 class="font-semibold">{format.name}</h3>
					<dl class="mt-4 grid gap-3 text-sm">
						<div>
							<dt class="font-medium">Text</dt>
							<dd class="mt-1 leading-6 text-muted-foreground">
								{format.text}
							</dd>
						</div>
						<div>
							<dt class="font-medium">Media</dt>
							<dd class="mt-1 leading-6 text-muted-foreground">
								{format.media}
							</dd>
						</div>
					</dl>
				</article>
			{/each}
		</div>

		<div class="mt-10 hidden overflow-hidden rounded-xl border bg-card md:block">
			<table class="w-full border-collapse text-left">
				<thead class="border-b bg-muted/35 text-sm">
					<tr>
						<th class="px-5 py-4 font-semibold" scope="col">Format</th>
						<th class="px-5 py-4 font-semibold" scope="col">Text</th>
						<th class="px-5 py-4 font-semibold" scope="col">Media</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each platform.formats as format (format.name)}
						<tr>
							<th class="px-5 py-5 font-medium" scope="row">{format.name}</th>
							<td class="px-5 py-5 text-sm leading-6 text-muted-foreground">{format.text}</td>
							<td class="px-5 py-5 text-sm leading-6 text-muted-foreground">{format.media}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-8 border-t pt-6">
			<h3 class="text-sm font-semibold">Provider limits and scope</h3>
			<ul class="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
				{#each platform.limits as limit (limit)}
					<li class="flex gap-2">
						<span aria-hidden="true" class="text-primary">•</span>
						<span>{limit}</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell grid gap-14 lg:grid-cols-2">
		<div>
			<p class="section-label">Connect and test</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-[-0.025em] text-balance">
				Set up {platform.name} in three checks.
			</h2>
			<ol class="mt-8 border-t">
				{#each platform.setup as step, index (step)}
					<li class="grid grid-cols-[2rem_1fr] gap-4 border-b py-5">
						<span
							data-agent-exclude
							class="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
						>
							{index + 1}
						</span>
						<p class="pt-1 text-sm leading-6 text-muted-foreground">{step}</p>
					</li>
				{/each}
			</ol>
		</div>
		<div>
			<div class="flex items-center gap-2 text-primary">
				<ShieldAlert class="size-5" aria-hidden="true" />
				<p class="text-sm font-semibold">Known limits</p>
			</div>
			<h2 class="mt-4 text-3xl font-semibold tracking-[-0.025em] text-balance">
				What can still block a post.
			</h2>
			<ul class="mt-8 border-t">
				{#each platform.limitations as limitation (limitation)}
					<li class="flex gap-3 border-b py-5 text-sm leading-6 text-muted-foreground">
						<Info class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
						<span>{limitation}</span>
					</li>
				{/each}
			</ul>
			<div class="mt-8 grid gap-5 border-t pt-6 text-sm leading-6 text-muted-foreground">
				<p>
					<strong class="font-medium text-foreground">Account requirement:</strong>
					{platform.accountRequirement}
				</p>
				<p>
					<strong class="font-medium text-foreground">Verification:</strong>
					{platform.verification}
				</p>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
		<h2 class="marketing-heading">
			Use the current callback address, permissions, and media setup.
		</h2>
		<div>
			<p class="marketing-copy">
				Social network developer pages change. The OpenPost guide lists the settings and checks you
				need now.
			</p>
			<Button href={platform.docsUrl} target="_blank" rel="noreferrer" class="mt-7" size="lg">
				Read the {platform.name} guide
				<ExternalLink data-icon="inline-end" />
			</Button>
		</div>
	</div>
</section>
