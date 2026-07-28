<script lang="ts">
	import { ArrowRight, ShieldAlert } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { managedSignupUrl, platforms, siteUrl } from '../_marketing';

	const approvalPlatforms = new Set<string>(
		platforms.filter((platform) => platform.status === 'Supported').map((platform) => platform.slug)
	);
</script>

<svelte:head>
	<title>Social platforms supported by OpenPost</title>
	<meta
		name="description"
		content="See the post formats, account requirements, limits, and provider approval requirements for every social platform in OpenPost."
	/>
	<link rel="canonical" href={`${siteUrl}/platforms`} />
</svelte:head>

<section class="border-b py-14 sm:py-20 lg:py-24">
	<div class="marketing-shell grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
		<div>
			<p class="section-label">Platforms</p>
			<h1
				class="mt-4 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
			>
				Know the destination before you connect it.
			</h1>
		</div>
		<div>
			<p class="marketing-copy">
				Every network has different formats, permissions, and media rules. OpenPost keeps those
				differences visible in the composer and provider guides.
			</p>
			<div class="mt-7 flex flex-wrap gap-3">
				<Button href={managedSignupUrl} size="lg">Try OpenPost</Button>
				<Button href="/tools/post-preview-generator" variant="outline" size="lg">
					Open the preview tool
				</Button>
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell">
		<div class="grid gap-2 border-b pb-5 sm:grid-cols-[0.65fr_1.35fr] sm:items-end">
			<h2 class="text-2xl font-semibold tracking-[-0.025em]">Publishing destinations</h2>
			<p class="text-sm leading-6 text-muted-foreground">
				Normal provider state stays quiet. Approval and setup requirements appear where action is
				needed.
			</p>
		</div>

		<div>
			{#each platforms as platform (platform.slug)}
				<a
					href={`/platforms/${platform.slug}`}
					class="focus-ring group grid min-h-32 gap-4 border-b py-6 md:grid-cols-[2.5rem_0.55fr_1.1fr_auto] md:items-center md:gap-6"
				>
					<span class="grid size-10 place-items-center rounded-lg bg-muted">
						<PlatformIcon platform={platform.short} class="size-5" />
					</span>
					<span>
						<strong class="text-lg">{platform.name}</strong>
						<span class="mt-1 block text-xs text-muted-foreground">{platform.auth}</span>
					</span>
					<span class="text-sm leading-6 text-muted-foreground">{platform.description}</span>
					<span class="flex items-center justify-between gap-4">
						{#if approvalPlatforms.has(platform.slug)}
							<span
								class="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
							>
								<ShieldAlert class="size-3.5" aria-hidden="true" />
								Provider approval
							</span>
						{/if}
						<ArrowRight
							class="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground"
							aria-hidden="true"
						/>
					</span>
				</a>
			{/each}
		</div>
	</div>
</section>
