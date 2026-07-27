<script lang="ts">
	import { ShieldAlert } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import ProviderReadinessMatrix from '../_components/ProviderReadinessMatrix.svelte';
	import { managedSignupUrl, platforms, siteUrl } from '../_marketing';

	const availablePlatforms = platforms.filter((platform) => platform.status === 'Available');
	const approvalPlatforms = platforms.filter((platform) => platform.status === 'Supported');
</script>

<svelte:head>
	<title>Social platforms supported by OpenPost</title>
	<meta
		name="description"
		content="See the post formats, account requirements, limits, and readiness status for every social platform in OpenPost."
	/>
	<link rel="canonical" href={`${siteUrl}/platforms`} />
</svelte:head>

<section class="border-b py-14 sm:py-18 lg:py-24">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="eyebrow">Platforms</p>
				<h1 class="mt-4 text-4xl leading-[1.03] font-semibold text-balance sm:text-6xl">
					Know what you can publish before you connect an account.
				</h1>
				<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
					Every network has different formats, permissions, and media rules. OpenPost documents them
					per platform, including the provider approval and account requirements that still apply.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">Try the managed app</Button>
					<Button href="/tools" variant="outline" size="lg">Try the free tools</Button>
				</div>
			</div>
			<dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border">
				<div class="bg-card p-5">
					<dt class="text-sm text-muted-foreground">Available</dt>
					<dd class="mt-2 text-3xl font-semibold">
						{availablePlatforms.length}
					</dd>
				</div>
				<div class="bg-card p-5">
					<dt class="text-sm text-muted-foreground">Provider approval</dt>
					<dd class="mt-2 text-3xl font-semibold">
						{approvalPlatforms.length}
					</dd>
				</div>
			</dl>
		</div>
	</div>
</section>

<ProviderReadinessMatrix />

<section class="section-pad border-y bg-muted/20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-8 lg:grid-cols-[16rem_1fr]">
			<div>
				<p class="eyebrow">Provider access</p>
				<h2 class="mt-4 text-3xl leading-tight font-semibold text-balance">
					Supported with provider approval
				</h2>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					These integrations are implemented. Your provider app may still need review, approved
					permissions, public-media setup, or a live-account audit before it can publish.
				</p>
			</div>
			<div class="grid gap-4 md:grid-cols-2">
				{#each approvalPlatforms as platform (platform.slug)}
					<a
						href={`/platforms/${platform.slug}`}
						class="group rounded-xl border bg-card p-5 transition hover:bg-background"
					>
						<div class="flex items-start justify-between gap-4">
							<div class="flex items-center gap-3">
								<PlatformIcon platform={platform.short} class="size-5" />
								<h3 class="font-semibold">{platform.name}</h3>
							</div>
							<span
								class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[0.7rem] font-medium text-amber-400"
							>
								Provider approval
							</span>
						</div>
						<p class="mt-4 text-sm leading-6 text-muted-foreground">
							{platform.description}
						</p>
						<p class="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
							<ShieldAlert class="mt-0.5 size-3.5 shrink-0" />
							{platform.verification}
						</p>
					</a>
				{/each}
			</div>
		</div>
	</div>
</section>
