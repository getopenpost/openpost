<!--
THESIS: OpenPost gives solo founders one content team for turning company work into destination-specific publishing without reopening every network.
OWN-WORLD: A dark launch stage gives way to a warm working page, with raised workshop-orange controls, framed product surfaces, and precise editorial pacing.
STORY: Understand the promise, inspect the result views, watch the real demo, see the product, choose a plan, and start.
FIRST VIEWPORT: One centered promise, one raised action, all supported networks in motion, and three overlapping result screens with no carousel chrome.
FORM: A focused product demonstration paced between dark studio stages, light working surfaces, and real product screenshots.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowRight, CalendarRange, Layers3, LockKeyhole } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import CreatorStories from './_components/CreatorStories.svelte';
	import DestinationComposerDemo from './_components/DestinationComposerDemo.svelte';
	import FloatingNetworkField from './_components/FloatingNetworkField.svelte';
	import FollowerGrowthPlanner from './_components/FollowerGrowthPlanner.svelte';
	import HeroResultsCarousel from './_components/HeroResultsCarousel.svelte';
	import LandingVideoDemo from './_components/LandingVideoDemo.svelte';
	import PostizSocialLogo from './_components/PostizSocialLogo.svelte';
	import PricingShowcase from './_components/PricingShowcase.svelte';
	import ScrollReveal from './_components/ScrollReveal.svelte';
	import { faqs, managedSignupUrl, platforms } from './_marketing';

	const productStories = [
		{
			eyebrow: 'One workspace',
			title: 'Create in one place.',
			description: 'Write posts and threads, schedule them, and see what published.',
			image: '/assets/screenshots/main-dark.png',
			alt: 'OpenPost publication composer with destination-specific versions',
			icon: Layers3
		},
		{
			eyebrow: 'Every platform',
			title: 'Adapt every post.',
			description: 'Change the copy, media, and settings for each platform before you publish.',
			image: '/assets/screenshots/accounts-dark.png',
			alt: 'OpenPost connected social accounts page',
			icon: LockKeyhole
		},
		{
			eyebrow: 'Media workspace',
			title: 'Reuse your media.',
			description: 'Keep assets and alt text ready for the next post.',
			image: '/assets/screenshots/media-dark.png',
			alt: 'OpenPost media library with reusable assets',
			icon: CalendarRange
		}
	] as const;

	const shortFaqs = faqs.slice(0, 4);
</script>

<section class="hero overflow-hidden">
	<div class="marketing-shell relative pt-16 pb-9 text-center sm:pt-24 sm:pb-11 lg:pt-28">
		<h1 class="hero-title hero-enter hero-enter-1 mx-auto">
			Your socials, <span>on steroids.</span>
		</h1>
		<p class="hero-copy hero-enter hero-enter-2 mx-auto mt-6 max-w-3xl">
			Create better content, adapt it for every platform,<br class="hidden sm:block" /> and publish it
			everywhere from one workspace.
		</p>
		<p class="hero-enter hero-enter-2 mx-auto mt-4 max-w-2xl text-sm text-white/70">
			This page is for solo founders evaluating one workspace for social publishing.
		</p>
		<div class="hero-enter hero-enter-3 mt-8 flex justify-center">
			<Button href={managedSignupUrl} size="lg" class="hero-cta">
				Hop on
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>

		<FloatingNetworkField />

		<div class="hero-enter hero-enter-4 relative z-10 mx-auto mt-10 max-w-5xl sm:mt-12">
			<HeroResultsCarousel />
		</div>
	</div>

	<div class="customer-proof border-t py-5 sm:py-6">
		<p>Built for the networks you use</p>
		<div class="supported-marks" aria-label="Implemented social platform adapters">
			{#each platforms as platform (platform.slug)}
				<a href={resolve(`/platforms/${platform.slug}`)} aria-label={`${platform.name} guide`}>
					<PostizSocialLogo platform={platform.slug} />
				</a>
			{/each}
		</div>
	</div>
</section>

<LandingVideoDemo />

<section
	id="product"
	class="section-pad marketing-rule scroll-mt-24 border-y bg-muted/18"
	aria-labelledby="product-title"
>
	<div class="marketing-shell">
		<ScrollReveal class="max-w-3xl">
			<p class="section-label">The workspace</p>
			<h2 id="product-title" class="marketing-heading">Everything you need to publish.</h2>
			<p class="marketing-copy mt-5">
				Write once, tune the version for each account, preview it, and schedule it without leaving
				the page.
			</p>
		</ScrollReveal>

		<ScrollReveal class="mt-12" delay={80}>
			<DestinationComposerDemo />
		</ScrollReveal>

		<div class="mt-20 grid gap-20 lg:gap-28">
			{#each productStories as story, index (story.title)}
				{@const Icon = story.icon}
				<article class="product-story" class:product-story-reverse={index % 2 === 1}>
					<ScrollReveal class="product-copy" delay={70}>
						<div
							class="grid size-10 place-items-center rounded-xl border bg-background text-primary shadow-sm"
						>
							<Icon class="size-5" aria-hidden="true" />
						</div>
						<p class="section-label mt-6">{story.eyebrow}</p>
						<h3
							class="mt-4 max-w-lg text-3xl leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-4xl"
						>
							{story.title}
						</h3>
						<p class="mt-5 max-w-xl leading-7 text-muted-foreground">
							{story.description}
						</p>
					</ScrollReveal>
					<ScrollReveal class="product-shot" delay={index % 2 === 0 ? 140 : 60}>
						<img
							src={story.image}
							alt={story.alt}
							width="1440"
							height="900"
							loading="lazy"
							decoding="async"
						/>
					</ScrollReveal>
				</article>
			{/each}
		</div>
	</div>
</section>

<CreatorStories />

<FollowerGrowthPlanner />

<section class="section-pad marketing-rule border-t bg-muted/18" aria-labelledby="pricing-title">
	<div class="marketing-shell">
		<ScrollReveal class="mx-auto max-w-3xl text-center">
			<p class="section-label">Managed plans</p>
			<h2 id="pricing-title" class="marketing-heading mx-auto mt-4">Pick your plan.</h2>
		</ScrollReveal>

		<div class="mt-12"><PricingShowcase compact /></div>
		<div class="mt-7 text-center">
			<Button href="/pricing" variant="outline">Compare all managed plans</Button>
		</div>
	</div>
</section>

<section class="section-pad marketing-rule border-t bg-muted/18" aria-labelledby="faq-title">
	<div class="marketing-shell grid gap-12 lg:grid-cols-[0.65fr_1.35fr]">
		<ScrollReveal>
			<p class="section-label">Questions</p>
			<h2 id="faq-title" class="marketing-heading mt-4">Before you start.</h2>
		</ScrollReveal>
		<div class="marketing-rule border-t">
			{#each shortFaqs as item, index (item.question)}
				<ScrollReveal delay={index * 45}>
					<details class="group marketing-rule border-b py-5">
						<summary
							class="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium"
						>
							{item.question}
							<span
								class="text-xl text-muted-foreground transition-transform group-open:rotate-45"
								aria-hidden="true">+</span
							>
						</summary>
						<p class="max-w-2xl pr-10 pb-2 text-sm leading-6 text-muted-foreground">
							{item.answer}
						</p>
					</details>
				</ScrollReveal>
			{/each}
			<div class="pt-6 text-right">
				<Button href="/faq" variant="outline">
					Read every question
					<ArrowRight data-icon="inline-end" />
				</Button>
			</div>
		</div>
	</div>
</section>

<section
	class="closing-section overflow-hidden text-center text-white"
	aria-labelledby="closing-title"
>
	<div class="closing-cells" aria-hidden="true"></div>
	<ScrollReveal class="marketing-shell relative py-24 sm:py-32">
		<p class="font-mono text-xs font-semibold tracking-[0.16em] text-primary uppercase">OpenPost</p>
		<h2
			id="closing-title"
			class="mx-auto mt-5 max-w-4xl text-4xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-6xl"
		>
			Start publishing.
		</h2>
		<p class="mx-auto mt-6 max-w-xl leading-7 text-white/62">
			Create, adapt, and schedule every post from one place.
		</p>
		<div class="mt-8 flex flex-wrap justify-center gap-3">
			<Button href={managedSignupUrl} size="lg">
				Start your 14-day trial
				<ArrowRight data-icon="inline-end" />
			</Button>
			<Button href="/pricing" variant="secondary" size="lg">See pricing</Button>
		</div>
	</ScrollReveal>
</section>

<style>
	.hero {
		position: relative;
		background:
			radial-gradient(
				circle at 50% 42%,
				color-mix(in oklch, var(--primary) 16%, transparent),
				transparent 31rem
			),
			linear-gradient(
				to bottom,
				color-mix(in oklch, var(--card) 72%, var(--background)),
				var(--background)
			);
	}

	.hero::before {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(
			color-mix(in oklch, var(--foreground) 14%, transparent) 0.6px,
			transparent 0.6px
		);
		background-size: 1.7rem 1.7rem;
		mask-image: linear-gradient(to bottom, black, transparent 74%);
		opacity: 0.22;
		content: '';
		pointer-events: none;
	}

	.hero-title {
		max-width: 64rem;
		font-family: 'Manrope Variable', Manrope, sans-serif;
		font-size: clamp(3.1rem, 7vw, 6rem);
		font-weight: 760;
		line-height: 0.94;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.hero-title span {
		color: oklch(0.72 0.16 48);
	}

	.hero-copy {
		font-size: clamp(1.05rem, 1.7vw, 1.35rem);
		font-weight: 520;
		line-height: 1.55;
		letter-spacing: -0.018em;
		color: var(--muted-foreground);
	}

	.hero-enter {
		animation: hero-enter 720ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.hero-enter-1 {
		animation-delay: 40ms;
	}
	.hero-enter-2 {
		animation-delay: 100ms;
	}
	.hero-enter-3 {
		animation-delay: 180ms;
	}
	.hero-enter-4 {
		animation-delay: 250ms;
	}
	:global(.hero-cta) {
		border-color: oklch(0.74 0.16 48) !important;
		background: oklch(0.65 0.18 45) !important;
		color: oklch(0.13 0.01 52) !important;
		font-weight: 750 !important;
		box-shadow:
			0 5px 0 oklch(0.4 0.13 43),
			0 1rem 2.4rem oklch(0.55 0.17 45 / 0.26) !important;
		transition:
			transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			box-shadow 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			background 140ms ease !important;
	}

	:global(.hero-cta:hover) {
		transform: translateY(-2px) !important;
		background: oklch(0.69 0.18 45) !important;
		box-shadow:
			0 7px 0 oklch(0.4 0.13 43),
			0 1.2rem 2.8rem oklch(0.55 0.17 45 / 0.32) !important;
	}

	:global(.hero-cta:active) {
		transform: translateY(4px) !important;
		box-shadow:
			0 1px 0 oklch(0.4 0.13 43),
			0 0.5rem 1.2rem oklch(0.55 0.17 45 / 0.18) !important;
	}

	.customer-proof {
		position: relative;
		display: grid;
		gap: 0.8rem;
		text-align: center;
	}

	.customer-proof > p {
		color: var(--muted-foreground);
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.supported-marks {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.35rem;
		width: min(100% - 2rem, 38rem);
		margin: 0.3rem auto 0;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.supported-marks a {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border-radius: 0.8rem;
		color: var(--muted-foreground);
		transition:
			color 120ms ease,
			background 120ms ease,
			transform 120ms ease;
	}

	.supported-marks a:hover {
		transform: translateY(-2px);
		background: var(--muted);
		color: var(--foreground);
	}

	.supported-marks :global(img) {
		display: block;
		width: 2rem;
		height: 2rem;
		object-fit: contain;
	}

	.product-story {
		display: grid;
		gap: 2.5rem;
		align-items: center;
	}

	:global(.product-shot) {
		min-width: 0;
		overflow: hidden;
		padding: clamp(0.55rem, 1.4vw, 0.9rem);
		border: 1px solid color-mix(in oklch, var(--foreground) 16%, transparent);
		border-radius: 1.35rem;
		background: oklch(0.13 0.01 52);
		box-shadow: 0 1.6rem 4.5rem color-mix(in oklch, var(--foreground) 12%, transparent);
	}

	:global(.product-shot) img {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 10;
		border-radius: 0.8rem;
		object-fit: contain;
		object-position: top;
	}

	:global(.dark) .hero {
		background:
			radial-gradient(circle at 50% 43%, oklch(0.5 0.15 45 / 0.2), transparent 31rem),
			oklch(0.115 0.008 52);
	}

	:global(.dark) .hero::before {
		background-image: radial-gradient(rgb(255 255 255 / 0.13) 0.6px, transparent 0.6px);
	}

	:global(.dark) .hero-copy {
		color: rgb(255 255 255 / 0.72);
	}

	:global(.dark) .hero-title {
		color: white;
	}

	:global(.dark) .customer-proof > p {
		color: rgb(255 255 255 / 0.4);
	}

	:global(.dark) .supported-marks {
		border-color: rgb(255 255 255 / 0.08);
	}

	:global(.dark) .supported-marks a {
		color: rgb(255 255 255 / 0.5);
	}

	:global(.dark) .supported-marks a:hover {
		background: rgb(255 255 255 / 0.06);
		color: white;
	}

	.closing-section {
		position: relative;
		background: oklch(0.13 0.012 50);
	}

	.closing-cells {
		position: absolute;
		inset: 0;
		opacity: 0.25;
		background-image:
			linear-gradient(oklch(0.68 0.16 44 / 0.32) 1px, transparent 1px),
			linear-gradient(90deg, oklch(0.68 0.16 44 / 0.32) 1px, transparent 1px);
		background-size: 2.4rem 2.4rem;
		mask-image: radial-gradient(circle at center, black, transparent 68%);
	}

	@keyframes hero-enter {
		from {
			opacity: 0;
			transform: translateY(1rem);
			filter: blur(5px);
		}
		to {
			opacity: 1;
			transform: none;
			filter: none;
		}
	}

	@media (min-width: 64rem) {
		.product-story {
			grid-template-columns: 0.75fr 1.25fr;
			gap: 5rem;
		}
		.product-story-reverse {
			grid-template-columns: 1.25fr 0.75fr;
		}
		.product-story-reverse :global(.product-copy) {
			order: 2;
		}
		.product-story-reverse :global(.product-shot) {
			order: 1;
		}
	}

	@media (max-width: 47.99rem) {
		.hero-title {
			font-size: clamp(3rem, 15vw, 4.6rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-enter {
			animation: none;
		}
	}
</style>
