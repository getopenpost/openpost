<!--
THESIS: OpenPost gives solo founders one content team for turning company work into destination-specific publishing without reopening every network.
OWN-WORLD: A dark launch stage gives way to a warm working page, with focused orange controls, framed product surfaces, and precise editorial pacing.
STORY: Understand the promise, inspect the result views, watch the real demo, see the product, choose a plan, and start.
FIRST VIEWPORT: One centered promise, one clear action, edge-held network marks, and three overlapping result screens with no carousel chrome.
FORM: A focused product demonstration paced between dark studio stages, light working surfaces, and real product screenshots.
-->
<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import DestinationComposerDemo from './_components/DestinationComposerDemo.svelte';
	import EditorToolsShowcase from './_components/EditorToolsShowcase.svelte';
	import FloatingNetworkField from './_components/FloatingNetworkField.svelte';
	import HeroResultsCarousel from './_components/HeroResultsCarousel.svelte';
	import LandingVideoDemo from './_components/LandingVideoDemo.svelte';
	import PricingShowcase from './_components/PricingShowcase.svelte';
	import ProductFeatureGrid from './_components/ProductFeatureGrid.svelte';
	import ScrollReveal from './_components/ScrollReveal.svelte';
	import UtilityToolsGrid from './_components/UtilityToolsGrid.svelte';
	import { faqs, managedSignupUrl, type MarketingToolSlug } from './_marketing';

	const shortFaqs = faqs.slice(0, 4);
	const landingToolSlugs = [
		'post-preview-generator',
		'multi-platform-character-counter',
		'best-time-to-post-calculator',
		'utm-link-builder'
	] as const satisfies readonly MarketingToolSlug[];
</script>

<section class="hero overflow-hidden">
	<div class="marketing-shell relative pt-16 pb-16 text-center sm:pt-24 sm:pb-20 lg:pt-28">
		<h1 class="hero-title hero-enter hero-enter-1 mx-auto">
			Your socials, <span>on steroids.</span>
		</h1>
		<p class="hero-copy hero-enter hero-enter-2 mx-auto mt-6 max-w-3xl">
			Write once. Adjust for each channel. Publish on schedule.
		</p>
		<p
			class="hero-enter hero-enter-2 mx-auto mt-3 max-w-2xl text-sm font-semibold text-foreground/70"
		>
			For solo founders who want one workspace for social publishing.
		</p>
		<div class="hero-enter hero-enter-3 mt-8 flex justify-center">
			<Button href={managedSignupUrl} size="lg" class="hero-cta">
				Start 14-day trial
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
		<p class="hero-enter hero-enter-3 mt-3 text-sm font-medium text-foreground/75">
			$0 today. Card required.
		</p>

		<FloatingNetworkField />

		<div class="hero-enter hero-enter-4 relative z-10 mx-auto mt-10 max-w-5xl sm:mt-12">
			<HeroResultsCarousel />
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
			<h2 id="product-title" class="marketing-heading">
				One publication, shaped for each destination.
			</h2>
			<p class="marketing-copy mt-5">
				Write the idea once. Edit the copy, media, and settings for each account before you schedule
				it.
			</p>
			<p class="marketing-copy mt-3">
				Provider formats, permissions, and limits still vary by network.
			</p>
		</ScrollReveal>

		<ScrollReveal class="mt-12" delay={80}>
			<DestinationComposerDemo />
		</ScrollReveal>

		<ScrollReveal class="mt-20" delay={80}>
			<ProductFeatureGrid />
		</ScrollReveal>
	</div>
</section>

<section class="section-pad marketing-rule border-t" aria-labelledby="tools-title">
	<div class="marketing-shell">
		<ScrollReveal class="max-w-3xl">
			<h2 id="tools-title" class="marketing-heading">Free tools that do real work.</h2>
			<p class="marketing-copy mt-5">
				Edit the media, preview the post, check the copy, plan the week, or build a campaign link.
				No account needed.
			</p>
		</ScrollReveal>

		<ScrollReveal class="mt-12" delay={60}>
			<EditorToolsShowcase />
		</ScrollReveal>

		<ScrollReveal class="mt-5" delay={100}>
			<UtilityToolsGrid slugs={landingToolSlugs} />
		</ScrollReveal>

		<div class="mt-7 text-center">
			<Button href="/tools" variant="outline">
				See all free tools
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>
	</div>
</section>

<section class="section-pad marketing-rule border-t bg-muted/18" aria-labelledby="pricing-title">
	<div class="marketing-shell">
		<ScrollReveal class="mx-auto max-w-3xl text-center">
			<h2 id="pricing-title" class="marketing-heading mx-auto">Start with the limits you need.</h2>
		</ScrollReveal>

		<div class="mt-12"><PricingShowcase compact /></div>
		<div class="mt-7 text-center">
			<Button href="/pricing" variant="outline">See all plans</Button>
		</div>
	</div>
</section>

<section class="section-pad marketing-rule border-t bg-muted/18" aria-labelledby="faq-title">
	<div class="marketing-shell grid gap-12 lg:grid-cols-[0.65fr_1.35fr]">
		<ScrollReveal>
			<h2 id="faq-title" class="marketing-heading">Before you start.</h2>
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
		<h2
			id="closing-title"
			class="mx-auto max-w-4xl text-4xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-6xl"
		>
			Ready to publish?
		</h2>
		<p class="mx-auto mt-6 max-w-xl leading-7 text-white/62">
			Your first 14 days are free. $0 today, card required.
		</p>
		<div class="mt-8 flex flex-wrap justify-center gap-3">
			<Button href={managedSignupUrl} size="lg">
				Start 14-day trial
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
		box-shadow: 0 0.45rem 1.3rem oklch(0.4 0.13 43 / 0.24) !important;
		transition:
			transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			box-shadow 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
			background 140ms ease !important;
	}

	:global(.hero-cta:hover) {
		background: oklch(0.69 0.18 45) !important;
		box-shadow: 0 0.55rem 1.5rem oklch(0.4 0.13 43 / 0.28) !important;
	}

	:global(.hero-cta:active) {
		transform: translateY(1px) !important;
		box-shadow: 0 0.25rem 0.75rem oklch(0.4 0.13 43 / 0.2) !important;
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
