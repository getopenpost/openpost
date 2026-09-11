<script lang="ts">
	import { resolve } from '$app/paths';
	import AsciiWordmark from './AsciiWordmark.svelte';
	import HeroAccent from './HeroAccent.svelte';
	import ThemeImage from './ThemeImage.svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { Button } from '$lib/components/ui/button';
	import Github from '@lucide/svelte/icons/github';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import {
		marketingNavigation,
		platforms,
		managedSignupUrl,
		managedTrialNote
	} from '../_marketing';
	import { openTelemetryPreferences } from '@openpost/telemetry';

	const groups = marketingNavigation.footerGroups;

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

<footer class="marketing-footer">
	<div class="footer-sendoff marketing-shell">
		<div class="sendoff-copy">
			<h2>Go make something<br /><HeroAccent>worth sharing.</HeroAccent></h2>
			<Button href={managedSignupUrl} size="lg"
				>Try OpenPost <ArrowUpRight data-icon="inline-end" /></Button
			>
			<p>{managedTrialNote}</p>
		</div>
		<img
			class="paper-plane"
			src="/assets/marketing/paper-plane.webp"
			alt=""
			width="1000"
			height="667"
			loading="lazy"
		/>
	</div>
	<div class="footer-links">
		<div class="footer-wordmark marketing-shell"><AsciiWordmark /></div>
		<div class="marketing-shell grid gap-12 py-14 lg:grid-cols-[1.15fr_1.85fr] lg:py-16">
			<div>
				<a
					href={resolve('/')}
					class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
					aria-label="OpenPost home"
				>
					<ThemeImage
						lightSrc="/assets/brand/logo.svg"
						darkSrc="/assets/brand/logo-dark.svg"
						alt=""
						width={28}
						height={28}
						class="shrink-0"
					/>
					<span class="font-brand text-sm leading-none font-semibold tracking-[-0.02em]"
						>OpenPost</span
					>
				</a>
				<p class="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
					Write posts, edit images and videos, and plan your week. More time for the business you’re
					building.
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
					{#each platforms.filter((platform) => !['pinterest', 'telegram'].includes(platform.slug)) as platform (platform.slug)}
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

			<div class="grid grid-cols-2 gap-8 sm:grid-cols-3">
				{#each groups as group (group.title)}
					<div>
						<h2 class="text-sm font-semibold">{group.title}</h2>
						<ul class="footer-nav mt-3 grid">
							{#each group.links as link (link.href)}
								<li>
									{#if link.href.startsWith('https://')}
										<a
											{...externalHref(link.href)}
											class="focus-ring inline-flex min-h-9 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground [@media(pointer:coarse)]:min-h-11"
										>
											{link.label}
										</a>
									{:else}
										<a
											href={resolve(link.href as '/')}
											class="focus-ring inline-flex min-h-9 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground [@media(pointer:coarse)]:min-h-11"
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
	</div>
	<div class="border-t">
		<div
			class="marketing-shell flex flex-col gap-3 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
		>
			<span>© 2026 OpenPost</span>
			<span class="flex flex-wrap items-center gap-x-5 gap-y-1">
				<span class="hidden sm:inline">Made in Porto. For your business.</span>
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
				<button
					type="button"
					class="focus-ring inline-flex min-h-11 items-center rounded-md transition-colors hover:text-foreground"
					onclick={openTelemetryPreferences}
				>
					Analytics choices
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
	.marketing-footer {
		margin-top: 64px;
		background: var(--marketing-section);
		border-top: 1px solid var(--border);
	}
	.footer-sendoff {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		min-height: 330px;
		padding-block: 64px;
	}
	.sendoff-copy {
		position: relative;
		z-index: 1;
	}
	.sendoff-copy h2 {
		font-size: clamp(32px, 4vw, 56px);
		letter-spacing: -0.035em;
		font-weight: 550;
		line-height: 1.12;
		margin-bottom: 28px;
	}
	.sendoff-copy p {
		margin-top: 12px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.paper-plane {
		position: absolute;
		width: min(54%, 660px);
		height: auto;
		right: -8px;
		top: auto;
		bottom: -64px;
		z-index: 1;
		pointer-events: none;
	}
	.footer-links {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
		border-top: 1px solid color-mix(in oklch, var(--marketing-mint-ink) 15%, transparent);
	}
	.footer-wordmark {
		padding-top: 64px;
	}
	.footer-links :global(.text-muted-foreground),
	.footer-links :global(.text-muted-foreground\/75) {
		color: color-mix(in oklch, var(--marketing-mint-ink) 80%, var(--marketing-mint));
	}
	@media (max-width: 700px) {
		.footer-sendoff {
			display: block;
			padding-top: 36px;
			padding-bottom: 200px;
		}
		.paper-plane {
			width: min(85%, 400px);
			top: auto;
			bottom: -48px;
			right: 0;
		}
		.footer-links > :global(.marketing-shell:first-child) {
			padding-top: 72px;
		}
	}

	.footer-nav a {
		min-height: 32px;
	}
	@media (pointer: coarse) {
		.footer-nav a {
			min-height: 44px;
		}
	}

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
