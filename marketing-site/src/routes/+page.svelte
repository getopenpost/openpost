<!--
THESIS: One publication becomes a deliberate version for every destination; the page refuses the generic feature-grid SaaS tour.
OWN-WORLD: Warm canvas, carbon type, scarce orange action, open editorial spacing, and real product or provider surfaces instead of decorative cards.
STORY: A creator understands the workflow, sees the destination result, chooses managed or self-hosted operation, and starts.
FIRST VIEWPORT: Outcome copy leads into a working destination editor whose controls and rendered post are both visible before the first major scroll.
FORM: Product-led publishing workspace; the destination transformation is the recurring visual and interaction device.
-->
<script lang="ts">
	import {
		ArrowRight,
		CalendarDays,
		Check,
		Github,
		Image,
		PenLine,
		Server,
		Settings2,
		Users
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import DestinationComposerDemo from './_components/DestinationComposerDemo.svelte';
	import {
		docsUrl,
		faqs,
		githubUrl,
		managedAccessSummary,
		managedSignupUrl,
		platforms,
		plans,
		selfHostingDocsUrl,
		siteUrl
	} from './_marketing';

	const workflow = [
		{
			title: 'Write the source',
			description: 'Start with the idea, media, and timing that every destination shares.'
		},
		{
			title: 'Tailor and preview',
			description: 'Adjust copy, format, media, and provider settings for each connected account.'
		},
		{
			title: 'Publish with a visible outcome',
			description:
				'Schedule through the durable queue and inspect success, failure, or retry state.'
		}
	] as const;

	const productViews = [
		{
			id: 'create',
			label: 'Create',
			title: 'Keep the source and every destination version together.',
			description:
				'The text-and-thread composer keeps shared content, account-specific changes, media, limits, and schedules in one editing flow.',
			image: '/assets/screenshots/main-dark.png',
			alt: 'OpenPost text-and-thread composer',
			icon: PenLine
		},
		{
			id: 'plan',
			label: 'Plan',
			title: 'See publications once, wherever they came from.',
			description:
				'Calendar and Posts use publications as the visible inventory, so each text post, Story, short video, or video appears once.',
			image: '/assets/screenshots/main-dark.png',
			alt: 'OpenPost composer beside the publication calendar',
			icon: CalendarDays
		},
		{
			id: 'accounts',
			label: 'Accounts',
			title: 'See each connected identity and any setup that needs action.',
			description:
				'Connected channels, account handles, Mastodon servers, and provider setup requirements remain visible before a post reaches the composer.',
			image: '/assets/screenshots/accounts-dark.png',
			alt: 'OpenPost social accounts page',
			icon: Users
		},
		{
			id: 'media',
			label: 'Media',
			title: 'Reuse approved media without rebuilding the asset list.',
			description:
				'The workspace media library keeps reusable files, alt text, dimensions, favorites, usage, and deletion state together.',
			image: '/assets/screenshots/media-dark.png',
			alt: 'OpenPost media library',
			icon: Image
		},
		{
			id: 'configure',
			label: 'Configure',
			title: 'Keep workspace and publishing defaults explicit.',
			description:
				'Workspace identity, timezone, posting schedule, retention, access, and billing settings stay in one predictable settings area.',
			image: '/assets/screenshots/settings-dark.png',
			alt: 'OpenPost general workspace settings',
			icon: Settings2
		}
	] as const;

	let activeProductView = $state<(typeof productViews)[number]['id']>('create');
	const currentProductView = $derived(
		productViews.find((view) => view.id === activeProductView) ?? productViews[0]
	);
	const featuredPlan = plans.find((plan) => plan.featured) ?? plans[1];
	const shortFaqs = faqs.slice(0, 3);
</script>

<svelte:head>
	<title>OpenPost - Create, preview, and publish for every social destination</title>
	<meta
		name="description"
		content="Create one social publication, tailor and preview every destination, then schedule through a visible queue. Use OpenPost managed or self-hosted."
	/>
	<link rel="canonical" href={siteUrl} />
	<meta name="robots" content="index, follow" />
	<meta property="og:url" content={siteUrl} />
	<meta
		property="og:title"
		content="OpenPost - Create, preview, and publish for every destination"
	/>
	<meta
		property="og:description"
		content="One source, a deliberate version for every destination, and a preview before anything publishes."
	/>
	<meta
		name="twitter:title"
		content="OpenPost - Create, preview, and publish for every destination"
	/>
	<meta
		name="twitter:description"
		content="Provider-aware social publishing, managed or self-hosted."
	/>
</svelte:head>

<section class="overflow-hidden border-b">
	<div class="marketing-shell py-14 sm:py-20 lg:py-24">
		<div class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
			<div>
				<p class="section-label">Provider-aware social publishing</p>
				<h1 class="marketing-title mt-4">Create once. Preview every destination.</h1>
			</div>
			<div class="lg:pb-1">
				<p class="marketing-copy">
					Write one publication, tailor the copy and format for each account, and see what people
					will receive before you schedule it.
				</p>
				<div class="mt-7 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">
						Try OpenPost
						<ArrowRight data-icon="inline-end" />
					</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="lg">Self-host</Button>
				</div>
				<p class="mt-4 max-w-xl text-xs leading-5 text-muted-foreground">
					{managedAccessSummary}
				</p>
			</div>
		</div>

		<div class="mt-10 sm:mt-14">
			<DestinationComposerDemo />
		</div>
	</div>
</section>

<section aria-label="Supported destinations" class="border-b bg-muted/20">
	<div class="marketing-shell py-5">
		<div class="flex items-center gap-5 overflow-x-auto">
			<p class="shrink-0 text-sm font-medium">Publish where your audience already is</p>
			<div class="flex min-w-max items-center gap-5 text-muted-foreground">
				{#each platforms as platform (platform.slug)}
					<a
						href={`/platforms/${platform.slug}`}
						class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm transition-colors hover:text-foreground"
					>
						<PlatformIcon platform={platform.short} class="size-4" />
						{platform.name}
					</a>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad" aria-labelledby="workflow-title">
	<div class="marketing-shell">
		<div class="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
			<div>
				<p class="section-label">The publishing flow</p>
				<h2 id="workflow-title" class="marketing-heading mt-4">
					One source. Deliberate destinations.
				</h2>
			</div>
			<p class="marketing-copy lg:justify-self-end">
				OpenPost preserves provider differences instead of pretending every network accepts the same
				post.
			</p>
		</div>
		<ol class="mt-12 grid border-y md:grid-cols-3">
			{#each workflow as step, index (step.title)}
				<li class="py-7 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
					<div class="flex items-center gap-3">
						<span
							class="grid size-7 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
						>
							{index + 1}
						</span>
						<h3 class="font-semibold">{step.title}</h3>
					</div>
					<p class="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
						{step.description}
					</p>
				</li>
			{/each}
		</ol>
	</div>
</section>

<section
	id="product"
	class="section-pad scroll-mt-24 border-y bg-muted/20"
	aria-labelledby="product-title"
>
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">The workspace</p>
			<h2 id="product-title" class="marketing-heading mt-4">
				The work around the post stays connected.
			</h2>
			<p class="marketing-copy mt-5">
				Every working surface keeps the current workspace and its publishing state in view.
			</p>
		</div>

		<div class="mt-10 overflow-hidden rounded-2xl border bg-card">
			<div
				class="flex gap-1 overflow-x-auto border-b p-2"
				role="group"
				aria-label="OpenPost product areas"
			>
				{#each productViews as view (view.id)}
					{@const Icon = view.icon}
					<button
						type="button"
						aria-pressed={activeProductView === view.id}
						class={[
							'focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
							activeProductView === view.id
								? 'bg-foreground text-background'
								: 'text-muted-foreground hover:bg-muted hover:text-foreground'
						]}
						onclick={() => (activeProductView = view.id)}
					>
						<Icon class="size-4" aria-hidden="true" />
						{view.label}
					</button>
				{/each}
			</div>
			<div class="grid lg:grid-cols-[0.72fr_1.28fr]" aria-live="polite">
				<div class="p-6 sm:p-9 lg:p-12">
					<h3
						class="max-w-lg text-2xl leading-tight font-semibold tracking-[-0.025em] text-balance sm:text-3xl"
					>
						{currentProductView.title}
					</h3>
					<p class="mt-4 max-w-lg leading-7 text-muted-foreground">
						{currentProductView.description}
					</p>
					<a
						href={docsUrl}
						class="focus-ring mt-7 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-primary"
					>
						See how it works
						<ArrowRight class="size-4" aria-hidden="true" />
					</a>
				</div>
				<figure class="min-w-0 border-t bg-[oklch(0.11_0.007_55)] p-3 lg:border-t-0 lg:border-l">
					<img
						src={currentProductView.image}
						alt={currentProductView.alt}
						class="block aspect-[16/10] w-full rounded-xl object-contain object-top"
						width="1440"
						height="900"
						loading="lazy"
						decoding="async"
					/>
				</figure>
			</div>
		</div>
	</div>
</section>

<section class="section-pad" aria-labelledby="deployment-title">
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[0.7fr_1.3fr]">
			<div>
				<p class="section-label">Choose how to run it</p>
				<h2 id="deployment-title" class="marketing-heading mt-4">
					The same product, managed or self-hosted.
				</h2>
			</div>
			<div class="grid border-y sm:grid-cols-2">
				<div class="py-7 sm:pr-8">
					<Check class="size-5 text-primary" aria-hidden="true" />
					<h3 class="mt-5 text-xl font-semibold">Managed OpenPost</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">
						Start with hosted accounts, storage, updates, and the publishing queue already operated
						for you.
					</p>
					<Button href={managedSignupUrl} class="mt-6">Start with {featuredPlan.name}</Button>
				</div>
				<div class="border-t py-7 sm:border-t-0 sm:border-l sm:pl-8">
					<Server class="size-5 text-primary" aria-hidden="true" />
					<h3 class="mt-5 text-xl font-semibold">Self-host OpenPost</h3>
					<p class="mt-3 text-sm leading-6 text-muted-foreground">
						Run the AGPL server as one binary or container with SQLite and local media by default.
						Redis is not required.
					</p>
					<div class="mt-6 flex flex-wrap gap-2">
						<Button href={selfHostingDocsUrl} variant="outline">Read the guide</Button>
						<Button href={githubUrl} variant="ghost">
							<Github data-icon="inline-start" />
							Source
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<section
	class="section-pad border-t bg-foreground text-background"
	aria-labelledby="pricing-close-title"
>
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
			<div>
				<p class="text-sm font-medium text-background/70">
					Managed plans start at {plans[0].price}/month
				</p>
				<h2
					id="pricing-close-title"
					class="mt-4 max-w-xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
				>
					Review the destination before you publish it.
				</h2>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={managedSignupUrl} size="lg">Try OpenPost</Button>
					<Button href="/pricing" variant="secondary" size="lg">Compare plans</Button>
				</div>
			</div>
			<div class="border-t border-background/20">
				{#each shortFaqs as item (item.question)}
					<details class="group border-b border-background/20 py-5">
						<summary
							class="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium"
						>
							{item.question}
							<span
								class="text-xl text-background/60 transition-transform group-open:rotate-45"
								aria-hidden="true">+</span
							>
						</summary>
						<p class="max-w-2xl pb-2 text-sm leading-6 text-background/70">
							{item.answer}
						</p>
					</details>
				{/each}
			</div>
		</div>
	</div>
</section>
