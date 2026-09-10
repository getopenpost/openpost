<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Play from '@lucide/svelte/icons/play';
	import { Button } from '$lib/components/ui/button';
	import PostizSocialLogo from './_components/PostizSocialLogo.svelte';
	import {
		demoVideoUrl,
		faqs,
		landingPlatforms,
		managedSignupUrl,
		managedTrialNote
	} from './_marketing';
	import HeroAccent from './_components/HeroAccent.svelte';
	import ProductDetails from './_components/ProductDetails.svelte';
	import ProductFeatures from './_components/ProductFeatures.svelte';
	import Resources from './_components/Resources.svelte';
	import CreatorStories from './_components/CreatorStories.svelte';
	import ProductTour from './_components/ProductTour.svelte';

	const shortFaqs = faqs.slice(0, 4);
</script>

<section class="landing-hero marketing-shell" aria-labelledby="hero-title">
	<div class="hero-intro">
		<h1 id="hero-title">
			You build the business.<br /><span>We’ll help you <HeroAccent>share it.</HeroAccent></span>
		</h1>
		<p>
			Write posts, edit your media, and plan what goes out.<br class="desktop-break" /> One workspace
			for every channel.
		</p>
		<div class="hero-actions">
			<Button href={managedSignupUrl} size="lg" class="landing-cta"
				>Start your free trial <ArrowRight data-icon="inline-end" /></Button
			>
			<a href={demoVideoUrl} class="focus-ring text-link" target="_blank" rel="noreferrer"
				><Play size={16} /> See it in action</a
			>
		</div>
		<div class="trial-note">{managedTrialNote}</div>
	</div>
	<ProductTour />
	<div class="platform-strip">
		<div class="platform-marks" aria-label="Explore supported platforms">
			{#each landingPlatforms as platform (platform.slug)}
				<a
					href={`/platforms/${platform.slug}`}
					aria-label={`${platform.name} publishing guide`}
					class="focus-ring"><PostizSocialLogo platform={platform.slug} /></a
				>
			{/each}
		</div>
		<a href="/platforms" class="focus-ring text-link"
			>See platform support <ArrowUpRight size={16} /></a
		>
	</div>
</section>

<ProductFeatures />

<ProductDetails />

<Resources />

<CreatorStories />

<section class="faq-section marketing-shell" aria-labelledby="faq-title">
	<div>
		<h2 id="faq-title">A few questions.</h2>
		<a href="/faq" class="focus-ring text-link">Read the FAQ <ArrowUpRight size={17} /></a>
	</div>
	<div class="faq-list">
		{#each shortFaqs as item (item.question)}
			<details>
				<summary>{item.question}<span aria-hidden="true">+</span></summary>
				<p>{item.answer}</p>
			</details>
		{/each}
	</div>
</section>

<section class="landing-close" aria-labelledby="closing-title">
	<div class="marketing-shell">
		<h2 id="closing-title">Make your next post<br />with OpenPost.</h2>
		<Button href={managedSignupUrl} size="lg" class="landing-cta"
			>Start your free trial <ArrowRight data-icon="inline-end" /></Button
		>
		<div class="trial-note">{managedTrialNote}</div>
		<a href="/pricing" class="focus-ring text-link">Compare plans <ArrowUpRight size={16} /></a>
	</div>
</section>

<style>
	.landing-hero {
		padding-top: 64px;
	}
	.hero-intro {
		text-align: center;
		margin-bottom: 40px;
	}
	h1 {
		font-size: clamp(40px, 5.7vw, 78px);
		font-weight: 550;
		letter-spacing: -0.04em;
		line-height: 1.06;
	}
	h1 span {
		color: var(--marketing-soft-ink);
	}
	.hero-intro > p {
		margin-top: 24px;
		font-size: 18px;
		line-height: 1.65;
		color: var(--muted-foreground);
	}
	.hero-actions {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 24px;
		margin-top: 24px;
	}
	:global(.landing-cta) {
		height: 48px;
		padding-inline: 24px;
		border-radius: 9px;
		font-size: 14px;
		background-image: var(--marketing-dither-pattern);
		background-size: 32px 32px;
	}
	.trial-note {
		margin-top: 12px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.text-link {
		color: inherit;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		border-radius: 5px;
		font-size: 14px;
		font-weight: 550;
		text-decoration: underline;
		text-decoration-color: var(--border);
		text-underline-offset: 5px;
	}
	.text-link:hover {
		text-decoration-color: currentColor;
	}
	.platform-strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 20px;
		padding-block: 32px 48px;
	}
	.platform-marks {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
	}
	.platform-marks a {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 6px;
	}
	.platform-marks :global(img) {
		width: 27px;
		height: 27px;
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		line-height: 1.12;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}
	.faq-section {
		display: grid;
		grid-template-columns: 0.8fr 1.2fr;
		gap: 64px;
		padding-block: 80px;
	}
	.faq-section .text-link {
		margin-top: 16px;
	}
	.faq-list details {
		border-bottom: 1px solid var(--border);
	}
	.faq-list summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		min-height: 64px;
		padding-block: 16px;
		font-size: 15px;
		font-weight: 550;
		cursor: pointer;
		list-style: none;
	}
	.faq-list summary::-webkit-details-marker {
		display: none;
	}
	.faq-list summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 4px;
	}
	.faq-list summary span {
		font-size: 22px;
		font-weight: 400;
	}
	.faq-list details[open] summary span {
		transform: rotate(45deg);
	}
	.faq-list p {
		padding-bottom: 20px;
		font-size: 14px;
		line-height: 1.75;
		color: var(--muted-foreground);
	}
	.landing-close {
		text-align: center;
		padding-block: 72px;
		background: var(--marketing-section);
	}
	.landing-close :global(.landing-cta) {
		margin-top: 28px;
	}
	.landing-close .text-link {
		margin-top: 12px;
	}
	@media (max-width: 760px) {
		.landing-hero {
			padding-top: 40px;
		}
		.hero-intro {
			margin-bottom: 28px;
		}
		h1 {
			font-size: clamp(34px, 7vw, 53px);
		}
		.hero-intro > p {
			font-size: 16px;
		}
		.hero-actions {
			gap: 12px;
			flex-wrap: wrap;
		}
		.platform-strip {
			justify-content: center;
			gap: 12px;
			padding-bottom: 32px;
		}
		.platform-marks {
			justify-content: center;
			gap: 8px;
		}
		.faq-section,
		.landing-close {
			padding-block: 48px;
		}
		.faq-section {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}

		.desktop-break {
			display: none;
		}
	}
</style>
