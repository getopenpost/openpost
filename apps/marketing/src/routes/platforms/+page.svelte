<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import HeroAccent from '../_components/HeroAccent.svelte';
	import { platforms } from '../_marketing';
	import { getChannelStory } from './_stories';
	const channels = platforms.flatMap((platform) => {
		const story = getChannelStory(platform.slug);
		return story ? [{ ...platform, story }] : [];
	});
</script>

<section class="channels marketing-shell">
	<header>
		<h1>Your business.<br /><HeroAccent>Your channels.</HeroAccent></h1>
		<p>
			A product demo for TikTok. A lesson for LinkedIn. A new arrival for Instagram.<br
				class="hidden sm:block"
			/> Give each channel its own version, and keep the work together.
		</p>
	</header>
	<div class="channel-grid">
		{#each channels as platform, index (platform.slug)}
			<a
				href={`/platforms/${platform.slug}`}
				class="channel focus-ring"
				class:mint={index % 3 === 0}
				class:lilac={index % 3 === 1}
				class:blue={index % 3 === 2}
			>
				<div class="channel-heading">
					<PlatformIcon platform={platform.short} class="size-8" /><ArrowUpRight size={22} />
				</div>
				<h2>{platform.name}</h2>
				<p>{platform.story.title}</p>
				<span>Explore {platform.name}</span>
			</a>
		{/each}
	</div>
	<aside>
		<h2>Check your channels before you commit.</h2>
		<p>
			OpenPost Cloud posting has not completed its final live checks yet. Each channel page explains
			the current availability and account requirements. Pinterest and Telegram are not available.
		</p>
		<a href="/contact" class="focus-ring">Ask about your accounts <ArrowUpRight size={16} /></a>
	</aside>
</section>

<style>
	.channels {
		padding-block: 72px;
	}
	header {
		text-align: center;
		margin-bottom: 56px;
	}
	h1 {
		font-size: clamp(42px, 5.7vw, 78px);
		font-weight: 550;
		letter-spacing: -0.04em;
		line-height: 1.06;
	}
	header p {
		margin: 28px auto 0;
		max-width: 65ch;
		font-size: 18px;
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	.channel-grid {
		display: grid;
		gap: 20px;
	}
	.channel {
		min-width: 0;
		display: block;
		padding: 28px;
		border-radius: 16px;
	}
	.channel-heading {
		display: flex;
		justify-content: space-between;
	}
	.channel h2 {
		margin-top: 36px;
		font-size: 28px;
		font-weight: 550;
		letter-spacing: -0.025em;
	}
	.channel p {
		font-size: 16px;
		line-height: 1.6;
		margin-block: 12px 28px;
		max-width: 28ch;
	}
	.channel span {
		display: inline-block;
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 5px;
	}
	.channel:hover span {
		text-decoration-thickness: 2px;
	}
	.mint {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.lilac {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.blue {
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	aside {
		padding-top: 48px;
		max-width: 70ch;
	}
	aside h2 {
		font-size: 22px;
		font-weight: 550;
	}
	aside p {
		margin-top: 12px;
		color: var(--muted-foreground);
		font-size: 15px;
		line-height: 1.7;
	}
	aside a {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		border-radius: 4px;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	@media (min-width: 600px) {
		.channel-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 1024px) {
		.channel-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
