<!--
THESIS: Make the managed product and its price legible before sign-in; refuse a second full marketing site.
OWN-WORLD: Warm canvas, Carbon Ink, one orange action, hairline divisions, and compact factual pricing.
STORY: A visitor understands OpenPost, sees what every plan costs, and can start a trial or inspect the full product site.
FIRST VIEWPORT: Brand and sign-in above a split offer; the entry price and trial terms sit beside the primary action.
FORM: A concise public verification page inside the established OpenPost world, shaped directly from the approval requirements.
-->
<script lang="ts">
	import { ArrowRight, CalendarClock, ChartNoAxesCombined, PanelsTopLeft } from '@lucide/svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import { hostedPlans, type HostedPlanID } from '$lib/billing';
	import { m } from '$lib/paraglide/messages';

	const productSite = 'https://openpost.social';
	const planBestFor: Record<HostedPlanID, () => string> = {
		starter: m.public_home_plan_starter_best_for,
		founder: m.public_home_plan_founder_best_for,
		pro: m.public_home_plan_pro_best_for,
		team: m.public_home_plan_team_best_for,
		agency: m.public_home_plan_agency_best_for
	};
	const features = [
		{
			icon: PanelsTopLeft,
			title: m.public_home_create_title(),
			description: m.public_home_create_description()
		},
		{
			icon: CalendarClock,
			title: m.public_home_publish_title(),
			description: m.public_home_publish_description()
		},
		{
			icon: ChartNoAxesCombined,
			title: m.public_home_review_title(),
			description: m.public_home_review_description()
		}
	] as const;
</script>

<svelte:head>
	<title>{m.public_home_meta_title()}</title>
	<meta name="description" content={m.public_home_meta_description()} />
	<link rel="canonical" href="https://app.openpost.social/" />
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
	<header class="border-b">
		<div
			class="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
		>
			<a
				href={productSite}
				class="inline-flex min-h-11 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
				aria-label={m.public_home_product_site_label()}
			>
				<Logo width={36} height={28} decorative />
				<span class="font-brand text-sm leading-none font-semibold tracking-[-0.02em]"
					>OpenPost</span
				>
			</a>
			<div class="flex items-center gap-1.5">
				<Button href="/login" variant="ghost" size="sm">{m.landing_sign_in()}</Button>
				<Button
					href="/register?plan=founder&billing_period=monthly"
					size="sm"
					class="hidden sm:inline-flex"
				>
					{m.public_home_start_trial()}
					<ArrowRight data-icon="inline-end" />
				</Button>
				<LanguageSwitcher compact />
			</div>
		</div>
	</header>

	<main>
		<section class="border-b py-14 sm:py-20 lg:py-24" aria-labelledby="public-home-title">
			<div
				class="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-end lg:px-8"
			>
				<div>
					<p class="text-sm font-semibold text-primary">{m.public_home_kicker()}</p>
					<h1
						id="public-home-title"
						class="mt-4 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
					>
						{m.public_home_title()}
					</h1>
					<p class="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
						{m.public_home_description()}
					</p>
					<div class="mt-8 flex flex-wrap gap-3">
						<Button href="/register?plan=founder&billing_period=monthly" size="lg">
							{m.public_home_start_trial()}
							<ArrowRight data-icon="inline-end" />
						</Button>
						<Button href={`${productSite}/pricing`} variant="outline" size="lg">
							{m.public_home_full_pricing()}
						</Button>
					</div>
				</div>

				<div class="border-y py-6 lg:border-t-0 lg:border-b-0 lg:border-l lg:py-2 lg:pl-10">
					<p class="text-sm font-medium text-muted-foreground">{m.public_home_plans_from()}</p>
					<p class="mt-2 text-5xl font-semibold tracking-[-0.035em]">
						$15<span class="text-base font-normal tracking-normal text-muted-foreground"
							>/{m.public_home_month()}</span
						>
					</p>
					<p class="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
						{m.public_home_trial_terms()}
					</p>
				</div>
			</div>
		</section>

		<section
			class="border-b bg-muted/20 py-12 sm:py-16"
			aria-labelledby="public-home-workflow-title"
		>
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
				<h2 id="public-home-workflow-title" class="sr-only">{m.public_home_workflow_title()}</h2>
				<ul class="grid gap-8 md:grid-cols-3 md:gap-0">
					{#each features as feature, index (feature.title)}
						{@const Icon = feature.icon}
						<li
							class={[
								'md:px-8',
								index === 0 && 'md:pl-0',
								index === features.length - 1 && 'md:pr-0',
								index > 0 && 'md:border-l'
							]}
						>
							<Icon class="size-5 text-primary" strokeWidth={1.8} aria-hidden="true" />
							<h3 class="mt-4 text-base font-semibold">{feature.title}</h3>
							<p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
								{feature.description}
							</p>
						</li>
					{/each}
				</ul>
			</div>
		</section>

		<section class="py-12 sm:py-16 lg:py-20" aria-labelledby="public-home-pricing-title">
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
				<div class="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
					<div>
						<h2
							id="public-home-pricing-title"
							class="text-2xl font-semibold tracking-tight sm:text-3xl"
						>
							{m.public_home_pricing_title()}
						</h2>
						<p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
							{m.public_home_pricing_description()}
						</p>
					</div>
					<a
						href={`${productSite}/pricing`}
						class="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						{m.public_home_compare_plans()}
						<ArrowRight class="size-4" aria-hidden="true" />
					</a>
				</div>

				<div
					class="mt-7 grid overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-5"
				>
					{#each hostedPlans as plan (plan.id)}
						<article
							class="flex min-h-full flex-col bg-card p-5 not-last:border-b sm:odd:border-r lg:not-last:border-r lg:not-last:border-b-0"
						>
							<h3 class="text-sm font-semibold">{plan.name}</h3>
							<p class="mt-3 text-2xl font-semibold tracking-tight">
								${plan.monthlyPriceUSD}<span
									class="text-xs font-normal tracking-normal text-muted-foreground"
									>/{m.public_home_month()}</span
								>
							</p>
							<p class="mt-3 text-xs leading-5 text-muted-foreground">{planBestFor[plan.id]()}</p>
						</article>
					{/each}
				</div>
			</div>
		</section>
	</main>

	<footer class="border-t bg-muted/20">
		<div
			class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8"
		>
			<p>{m.public_home_footer()}</p>
			<nav class="flex flex-wrap gap-x-5 gap-y-2" aria-label={m.public_home_legal_label()}>
				<a
					class="inline-flex min-h-11 items-center rounded-md hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					href={`${productSite}/terms`}>{m.public_home_terms()}</a
				>
				<a
					class="inline-flex min-h-11 items-center rounded-md hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					href={`${productSite}/privacy`}>{m.public_home_privacy()}</a
				>
				<a
					class="inline-flex min-h-11 items-center rounded-md hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					href={`${productSite}/refunds`}>{m.public_home_refunds()}</a
				>
			</nav>
		</div>
	</footer>
</div>
