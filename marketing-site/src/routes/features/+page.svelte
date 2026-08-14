<!--
THESIS: The feature hub is a maintained workshop map: each station explains one real job, its proof, and the boundary that keeps the claim honest.
OWN-WORLD: Warm canvas, carbon type, hairline rules, dark product frames, and one orange route line extend the established OpenPost marketing system.
STORY: See the whole publishing loop, inspect each job, check provider and plan limits, then choose a plan or open the exact guide.
FIRST VIEWPORT: A direct promise and action sit beside a compact six-station index with current implementation and certification counts.
FORM: A workshop bench of alternating capability stations, candidate three from the established-world surface roll, staged around one continuous workflow rail (seed 6ac593c7).
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ArrowRight,
		BarChart3,
		CalendarCheck2,
		Check,
		Code2,
		ExternalLink,
		Image,
		Images,
		ShieldCheck,
		UsersRound
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		featureGroups,
		managedSignupUrl,
		platforms,
		publicProviderCertification
	} from '../_marketing';

	function isExternal(href: string) {
		return href.startsWith('https://');
	}

	function linkAttributes(href: string) {
		return { href: href.startsWith('/') ? resolve(href as '/') : href };
	}

	const featureIcons: Record<(typeof featureGroups)[number]['id'], typeof Images> = {
		compose: Images,
		schedule: CalendarCheck2,
		'media-editing': Image,
		'analytics-inbox': BarChart3,
		teams: UsersRound,
		automation: Code2
	};
</script>

<section class="features-hero border-b">
	<div class="marketing-shell grid gap-12 py-16 sm:py-24 lg:grid-cols-[1fr_24rem] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">Features</p>
			<h1 class="marketing-title mt-5">One system for the whole publishing job.</h1>
			<p class="mt-5 text-sm font-medium text-foreground">
				This page is for founders and teams evaluating the complete OpenPost workflow.
			</p>
			<p class="marketing-copy mt-7">
				Create a source idea, adapt it for each account, prepare the media, schedule the work,
				inspect the result, and keep the same boundaries when a teammate or tool helps.
			</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={managedSignupUrl} size="lg">
					Start a 14-day trial
					<ArrowRight data-icon="inline-end" />
				</Button>
				<Button href="/pricing" variant="outline" size="lg">Compare plans</Button>
			</div>
		</div>

		<aside class="feature-index" aria-labelledby="feature-index-title">
			<p id="feature-index-title" class="text-sm font-semibold">Inside OpenPost</p>
			<nav class="mt-4" aria-label="Feature sections">
				<ul>
					{#each featureGroups as feature (feature.id)}
						<li>
							<a class="focus-ring" href={`#${feature.id}`}>
								<span aria-hidden="true"></span>
								{feature.label}
							</a>
						</li>
					{/each}
				</ul>
			</nav>
			<dl class="mt-6 grid grid-cols-2 gap-4 border-t pt-5">
				<div>
					<dt>Implemented adapters</dt>
					<dd>{platforms.length}</dd>
				</div>
				<div>
					<dt>Current exact Hosted service claims</dt>
					<dd>{publicProviderCertification.currentClaimCount}</dd>
				</div>
			</dl>
		</aside>
	</div>
</section>

<section class="feature-workbench" aria-labelledby="workbench-title">
	<div class="marketing-shell workbench-layout">
		<div class="workbench-intro">
			<p class="section-label">The working loop</p>
			<h2 id="workbench-title" class="marketing-heading mt-4">
				Every station keeps its limits visible.
			</h2>
			<p class="marketing-copy mt-5">
				Product scope comes from the current application and documentation. Provider implementation
				does not become a Hosted service availability claim without current certification evidence.
			</p>
		</div>

		<div class="feature-rail">
			{#each featureGroups as feature (feature.id)}
				{@const Icon = featureIcons[feature.id]}
				<article
					id={feature.id}
					class="feature-station scroll-mt-28"
					data-feature-station={feature.id}
				>
					<div class="station-copy">
						<div class="station-heading">
							<span class="station-icon"><Icon aria-hidden="true" /></span>
							<p>{feature.label}</p>
						</div>
						<h3>{feature.title}</h3>
						<p class="station-outcome">{feature.outcome}</p>

						<ul class="station-scope">
							{#each feature.scope as item (item)}
								<li><Check aria-hidden="true" /><span>{item}</span></li>
							{/each}
						</ul>

						<aside class="station-limit">
							<p><strong>Current boundary</strong></p>
							<p>{feature.limit}</p>
						</aside>

						<div class="station-actions">
							<a
								class="focus-ring station-link"
								{...linkAttributes(feature.docsUrl)}
								target={isExternal(feature.docsUrl) ? '_blank' : undefined}
								rel={isExternal(feature.docsUrl) ? 'noreferrer' : undefined}
							>
								Read the guide
								{#if isExternal(feature.docsUrl)}<ExternalLink
										aria-hidden="true"
									/>{:else}<ArrowRight aria-hidden="true" />{/if}
							</a>
							<a
								class="focus-ring station-link station-link-secondary"
								{...linkAttributes(feature.next.href)}
								target={isExternal(feature.next.href) ? '_blank' : undefined}
								rel={isExternal(feature.next.href) ? 'noreferrer' : undefined}
							>
								{feature.next.label}
								{#if isExternal(feature.next.href)}<ExternalLink
										aria-hidden="true"
									/>{:else}<ArrowRight aria-hidden="true" />{/if}
							</a>
						</div>
					</div>

					<div class="station-proof">
						{#if feature.proof.kind === 'image'}
							<figure>
								<img
									src={feature.proof.src}
									alt={feature.proof.alt}
									width="1440"
									height="900"
									loading="lazy"
									decoding="async"
								/>
								<figcaption>Current OpenPost product surface</figcaption>
							</figure>
						{:else}
							<a
								class="focus-ring proof-document"
								{...linkAttributes(feature.proof.href)}
								target="_blank"
								rel="noreferrer"
							>
								<span><ShieldCheck aria-hidden="true" /></span>
								<strong>{feature.proof.label}</strong>
								<small>Open the maintained documentation <ExternalLink aria-hidden="true" /></small>
							</a>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="provider-boundary border-y" aria-labelledby="provider-boundary-title">
	<div class="marketing-shell grid gap-10 py-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
		<div>
			<p class="section-label">Provider truth</p>
			<h2
				id="provider-boundary-title"
				class="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance"
			>
				Implementation and current Hosted service availability are different facts.
			</h2>
		</div>
		<div>
			<p class="text-lg leading-8 text-muted-foreground">
				OpenPost has {platforms.length} provider adapters in the product catalogue.
				{publicProviderCertification.summary} Account type, provider review, granted permissions, runtime
				controls, and current live tests can still change what one account can publish.
			</p>
			<div class="mt-6 flex flex-wrap gap-3">
				<Button href="/platforms">Check formats and limits</Button>
				<Button href="/faq" variant="outline">Read common questions</Button>
			</div>
		</div>
	</div>
</section>

<section class="section-pad text-center" aria-labelledby="features-close-title">
	<div class="marketing-shell">
		<p class="section-label">Choose the next step</p>
		<h2 id="features-close-title" class="marketing-heading mx-auto mt-4">
			Start with the limits you need now.
		</h2>
		<p class="marketing-copy mx-auto mt-5">
			Every Hosted service plan includes the publishing workflow. Workspaces, connected accounts,
			scheduled posts, media storage, seats, and team roles determine which plan fits.
		</p>
		<div class="mt-8 flex flex-wrap justify-center gap-3">
			<Button href="/pricing" size="lg">Compare every plan</Button>
			<Button href={managedSignupUrl} variant="outline" size="lg">Start the trial</Button>
		</div>
	</div>
</section>

<style>
	.features-hero {
		background:
			radial-gradient(
				circle at 72% 24%,
				color-mix(in oklch, var(--primary) 12%, transparent),
				transparent 24rem
			),
			var(--background);
	}

	.feature-index {
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: color-mix(in oklch, var(--card) 92%, var(--background));
	}

	.feature-index ul {
		display: grid;
		gap: 0.15rem;
	}

	.feature-index a {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.7rem;
		padding-inline: 0.5rem;
		border-radius: 0.5rem;
		color: var(--muted-foreground);
		font-size: 0.82rem;
		font-weight: 550;
	}

	.feature-index a:hover {
		background: color-mix(in oklch, var(--muted) 55%, transparent);
		color: var(--foreground);
	}

	.feature-index a > span {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 0.12rem;
		background: var(--primary);
	}

	.feature-index dt {
		color: var(--muted-foreground);
		font-size: 0.68rem;
		line-height: 1.4;
	}

	.feature-index dd {
		margin-top: 0.3rem;
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.feature-workbench {
		padding-block: clamp(5rem, 9vw, 9rem);
	}

	.workbench-layout {
		display: grid;
		gap: 4rem;
	}

	.workbench-intro {
		max-width: 46rem;
	}

	.feature-rail {
		position: relative;
		display: grid;
	}

	.feature-rail::before {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 1.1rem;
		width: 1px;
		background: color-mix(in oklch, var(--primary) 42%, var(--border));
		content: '';
	}

	.feature-station {
		position: relative;
		display: grid;
		min-width: 0;
		gap: 2.25rem;
		padding: 0 0 5rem 3.5rem;
	}

	.feature-station:last-child {
		padding-bottom: 0;
	}

	.feature-station::before {
		position: absolute;
		top: 0.8rem;
		left: 0.68rem;
		width: 0.9rem;
		height: 0.9rem;
		border: 3px solid var(--background);
		border-radius: 0.22rem;
		background: var(--primary);
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--primary) 60%, var(--border));
		content: '';
	}

	.station-heading {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--primary);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.station-icon {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		background: var(--card);
	}

	.station-icon :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.station-copy h3 {
		max-width: 20ch;
		margin-top: 1.25rem;
		font-size: clamp(2rem, 4vw, 3.35rem);
		font-weight: 650;
		line-height: 1.02;
		letter-spacing: -0.038em;
		text-wrap: balance;
	}

	.station-outcome {
		max-width: 66ch;
		margin-top: 1.2rem;
		color: var(--muted-foreground);
		line-height: 1.75;
	}

	.station-scope {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.station-scope li {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		color: var(--muted-foreground);
		font-size: 0.86rem;
		line-height: 1.55;
	}

	.station-scope :global(svg) {
		width: 1rem;
		height: 1rem;
		flex: none;
		margin-top: 0.15rem;
		color: var(--primary);
	}

	.station-limit {
		max-width: 66ch;
		margin-top: 1.5rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--muted) 36%, var(--background));
		font-size: 0.8rem;
		line-height: 1.55;
	}

	.station-limit p + p {
		margin-top: 0.25rem;
		color: var(--muted-foreground);
	}

	.station-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1.25rem;
		margin-top: 1.4rem;
	}

	.station-link {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.45rem;
		border-radius: 0.5rem;
		color: var(--primary);
		font-size: 0.82rem;
		font-weight: 650;
	}

	.station-link-secondary {
		color: var(--foreground);
	}

	.station-link :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.station-proof {
		min-width: 0;
	}

	.station-proof figure,
	.proof-document {
		overflow: hidden;
		border: 1px solid color-mix(in oklch, white 12%, transparent);
		border-radius: 1rem;
		background: oklch(0.16 0.01 50);
		color: white;
		box-shadow: 0 1.5rem 4rem color-mix(in oklch, var(--foreground) 12%, transparent);
	}

	.station-proof img {
		display: block;
		width: 100%;
		height: auto;
	}

	.station-proof figcaption {
		padding: 0.8rem 1rem;
		border-top: 1px solid color-mix(in oklch, white 10%, transparent);
		color: color-mix(in oklch, white 62%, transparent);
		font-size: 0.7rem;
	}

	.proof-document {
		display: grid;
		min-height: 18rem;
		align-content: end;
		gap: 0.75rem;
		padding: clamp(1.4rem, 4vw, 2.5rem);
	}

	.proof-document > span {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid color-mix(in oklch, white 20%, transparent);
		border-radius: 0.75rem;
		color: var(--primary);
	}

	.proof-document > span :global(svg) {
		width: 1.2rem;
		height: 1.2rem;
	}

	.proof-document strong {
		max-width: 18ch;
		font-size: clamp(1.7rem, 4vw, 2.6rem);
		line-height: 1.05;
		letter-spacing: -0.03em;
	}

	.proof-document small {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: color-mix(in oklch, white 62%, transparent);
		font-size: 0.76rem;
	}

	.proof-document small :global(svg) {
		width: 0.85rem;
		height: 0.85rem;
	}

	.provider-boundary {
		background: color-mix(in oklch, var(--muted) 32%, var(--background));
	}

	@media (min-width: 64rem) {
		.feature-station {
			grid-template-columns: minmax(0, 0.92fr) minmax(24rem, 1.08fr);
			align-items: center;
			gap: clamp(3rem, 7vw, 7rem);
			padding-bottom: 7rem;
		}

		.feature-station:nth-child(even) .station-copy {
			grid-column: 2;
		}

		.feature-station:nth-child(even) .station-proof {
			grid-row: 1;
			grid-column: 1;
		}
	}

	@media (max-width: 39.99rem) {
		.feature-station {
			padding-left: 2.7rem;
		}

		.feature-rail::before {
			left: 0.65rem;
		}

		.feature-station::before {
			left: 0.22rem;
		}

		.station-actions {
			display: grid;
			justify-items: start;
		}
	}
</style>
