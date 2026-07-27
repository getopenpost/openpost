<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import {
		ArrowLeft,
		ArrowRight,
		CheckCircle2,
		ExternalLink,
		Info,
		ShieldAlert
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import PlatformPreview from '../_components/PlatformPreview.svelte';
	import { getPlatform, managedSignupUrl, siteUrl } from '../../_marketing';

	const slug = $derived(page.params.slug ?? '');
	const platform = $derived.by(() => {
		const found = getPlatform(slug);
		if (!found) error(404, 'Platform not found');
		return found;
	});
	const requiresProviderApproval = $derived(platform.status === 'Supported');
</script>

<svelte:head>
	<title>{platform.name} publishing support - OpenPost</title>
	<meta
		name="description"
		content={`${platform.description} See formats, setup requirements, limits, and readiness.`}
	/>
	<link rel="canonical" href={`${siteUrl}/platforms/${platform.slug}`} />
</svelte:head>

<section class="border-b py-14 sm:py-18 lg:py-24">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<a
			href="/platforms"
			class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			All platforms
		</a>
		<div class="mt-10 grid gap-10 lg:grid-cols-[1fr_26rem] lg:items-end">
			<div>
				<div class="flex items-center gap-4">
					<div class="flex size-14 items-center justify-center rounded-xl border bg-card">
						<PlatformIcon platform={platform.short} class="size-7" />
					</div>
					<div>
						<p class="eyebrow">{platform.name}</p>
						<p class="mt-1 text-sm text-muted-foreground">
							{platform.statusDetail}
						</p>
					</div>
				</div>
				<h1 class="mt-7 max-w-4xl text-4xl leading-[1.03] font-semibold text-balance sm:text-6xl">
					{platform.heroTitle}
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
					{platform.description}
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">
						Try the managed app
						<ArrowRight data-icon="inline-end" />
					</Button>
					<Button
						href={platform.docsUrl}
						target="_blank"
						rel="noreferrer"
						variant="outline"
						size="lg"
					>
						Provider guide
						<ExternalLink data-icon="inline-end" />
					</Button>
				</div>
			</div>
			<div class="space-y-3">
				<PlatformPreview {platform} />
				<aside class="rounded-xl border bg-card p-4">
					<div class="flex items-center justify-between gap-4">
						<div
							class="flex items-center gap-2 {requiresProviderApproval
								? 'text-amber-400'
								: 'text-primary'}"
						>
							{#if requiresProviderApproval}<ShieldAlert class="size-4" />{:else}<CheckCircle2
									class="size-4"
								/>{/if}
							<span class="text-sm font-semibold">{platform.status}</span>
						</div>
						<span class="text-xs text-muted-foreground">{platform.auth}</span>
					</div>
					<p class="mt-3 text-xs leading-5 text-muted-foreground">
						{platform.verification}
					</p>
				</aside>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="max-w-3xl">
			<p class="eyebrow">Publication profiles</p>
			<h2 class="mt-4 text-3xl leading-tight font-semibold text-balance sm:text-5xl">
				One platform can have several different rule sets.
			</h2>
			<p class="mt-5 text-lg leading-8 text-muted-foreground">
				OpenPost validates the character and media rules for the selected format.
			</p>
		</div>
		<div class="mt-10 overflow-x-auto rounded-xl border bg-card">
			<table class="w-full min-w-[44rem] border-collapse text-left">
				<thead class="border-b bg-muted/25 text-sm">
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
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
		<div>
			<p class="eyebrow">Connect and verify</p>
			<h2 class="mt-4 text-3xl font-semibold text-balance">
				Set up {platform.name} in three checks.
			</h2>
			<ol class="mt-8 space-y-6">
				{#each platform.setup as step, index (step)}
					<li class="grid grid-cols-[2rem_1fr] gap-4">
						<span
							class="flex size-8 items-center justify-center rounded-full border bg-card font-mono text-xs text-primary"
						>
							{index + 1}
						</span>
						<p class="pt-1 text-sm leading-6 text-muted-foreground">{step}</p>
					</li>
				{/each}
			</ol>
		</div>
		<div>
			<div class="flex items-center gap-2">
				<ShieldAlert class="size-5 text-primary" />
				<p class="eyebrow">Known limits</p>
			</div>
			<h2 class="mt-4 text-3xl font-semibold text-balance">What can still block a post.</h2>
			<ul class="mt-8 divide-y rounded-xl border bg-card">
				{#each platform.limitations as limitation (limitation)}
					<li class="flex gap-3 p-5 text-sm leading-6 text-muted-foreground">
						<Info class="mt-0.5 size-4 shrink-0 text-primary" />
						<span>{limitation}</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
		<p class="eyebrow">Keep the provider guide nearby</p>
		<h2 class="mt-4 text-3xl leading-tight font-semibold text-balance sm:text-5xl">
			Use the exact callback, scope, and media setup for {platform.name}.
		</h2>
		<p class="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
			Provider consoles change. The OpenPost guide records the configuration and troubleshooting
			checks the adapter expects.
		</p>
		<Button href={platform.docsUrl} target="_blank" rel="noreferrer" class="mt-8" size="lg">
			Read the {platform.name} guide
			<ExternalLink data-icon="inline-end" />
		</Button>
	</div>
</section>
