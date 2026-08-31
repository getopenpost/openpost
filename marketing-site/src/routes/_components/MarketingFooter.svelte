<script lang="ts">
	import { resolve } from '$app/paths';
	import Github from '@lucide/svelte/icons/github';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Logo from '$lib/components/Logo.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { marketingNavigation, platforms } from '../_marketing';

	const groups = marketingNavigation.footerGroups.map((group) => ({
		...group,
		links:
			group.title === 'Documentation'
				? [
						...group.links,
						...platforms.slice(0, 3).map((platform) => ({
							label: `${platform.name} guide`,
							href: `/platforms/${platform.slug}`
						}))
					]
				: group.links
	}));

	function externalHref(source: string) {
		return { href: new URL(source).href } as const;
	}

	function navigationLink(label: string) {
		const item = marketingNavigation.footerGroups
			.flatMap((group) => group.links)
			.find((candidate) => candidate.label === label);
		if (!item) throw new Error(`Missing marketing navigation item: ${label}`);
		return item.href;
	}
</script>

<footer class="border-t bg-muted/30">
	<div class="marketing-shell grid gap-12 py-14 lg:grid-cols-[1.15fr_1.85fr] lg:py-16">
		<div>
			<a
				href={resolve('/')}
				class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
				aria-label="OpenPost home"
			>
				<Logo width={36} height={28} decorative />
				<span class="font-brand text-sm leading-none font-semibold tracking-[-0.02em]"
					>OpenPost</span
				>
			</a>
			<p class="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
				The content workspace for solo founders. Create once, adapt for each destination, and keep
				publishing state clear.
			</p>
			<div class="mt-5 flex flex-wrap gap-x-5">
				<a
					href={navigationLink('GitHub source')}
					target="_blank"
					rel="noreferrer"
					class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					<Github class="size-4" />
					GitHub source
				</a>
				<a
					{...externalHref(navigationLink('Discord community'))}
					target="_blank"
					rel="noreferrer"
					class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					<MessageCircle class="size-4" />
					Discord
				</a>
			</div>
			<div
				class="platform-guides mt-6 text-muted-foreground"
				aria-label="Platform publishing guides"
			>
				{#each platforms as platform (platform.slug)}
					<a
						href={resolve(`/platforms/${platform.slug}`)}
						class="focus-ring inline-flex size-11 items-center justify-center rounded-md text-muted-foreground/75 transition-colors hover:text-primary"
						aria-label={`${platform.name} guide`}
					>
						<PlatformIcon platform={platform.short} class="size-4" />
					</a>
				{/each}
			</div>
		</div>

		<div class="grid gap-8 sm:grid-cols-3">
			{#each groups as group (group.title)}
				<div>
					<h2 class="text-sm font-semibold">{group.title}</h2>
					<ul class="mt-3 grid gap-1">
						{#each group.links as link (link.href)}
							<li>
								{#if link.href.startsWith('https://')}
									<a
										{...externalHref(link.href)}
										class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
									>
										{link.label}
									</a>
								{:else}
									<a
										href={resolve(link.href as '/')}
										class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
									>
										{link.label}
									</a>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>

	<div class="border-t">
		<div
			class="marketing-shell flex flex-col gap-3 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
		>
			<span>© 2026 OpenPost</span>
			<span class="flex flex-wrap items-center gap-x-5 gap-y-1">
				<span class="hidden sm:inline">Made for YOUR company</span>
				<button
					type="button"
					class="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md transition-colors hover:text-foreground"
					aria-pressed={soundPreferences.enabled}
					aria-label={soundPreferences.enabled
						? 'Mute interface sounds'
						: 'Enable interface sounds'}
					onclick={() => soundPreferences.setEnabled(!soundPreferences.enabled)}
				>
					{#if soundPreferences.enabled}<Volume2 class="size-3.5" />{:else}<VolumeX
							class="size-3.5"
						/>{/if}
					Sound
				</button>
				<a
					class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
					href={resolve('/privacy')}>Privacy</a
				>
				<a
					class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
					href={resolve('/terms')}>Terms</a
				>
				<a
					class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
					href={resolve('/refunds')}>Refunds</a
				>
				<a
					class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
					href={resolve('/trust')}>Trust</a
				>
			</span>
		</div>
	</div>
</footer>

<style>
	.platform-guides {
		display: grid;
		grid-template-columns: repeat(5, 2.75rem);
		gap: 0.25rem;
	}

	@media (min-width: 30rem) {
		.platform-guides {
			grid-template-columns: repeat(7, 2.75rem);
		}
	}
</style>
