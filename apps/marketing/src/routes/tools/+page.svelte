<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import EditorToolsShowcase from '../_components/EditorToolsShowcase.svelte';
	import UtilityToolsGrid from '../_components/UtilityToolsGrid.svelte';
	import type { MarketingToolSlug } from '../_marketing';

	const utilityToolSlugs = [
		'post-preview-generator',
		'multi-platform-character-counter',
		'thread-splitter',
		'utm-link-builder',
		'linkedin-text-formatter',
		'best-time-to-post-calculator',
		'fediverse-handle-checker'
	] as const satisfies readonly MarketingToolSlug[];
</script>

<section class="tools-hero border-b" aria-labelledby="tools-title">
	<div class="marketing-shell py-16 sm:py-24">
		<h1
			id="tools-title"
			class="max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
		>
			Finish the post before you sign up.
		</h1>
		<p class="marketing-copy mt-6">
			For creators preparing a post before signing up. Edit the media, check each platform, plan the
			week, and build the link. Every tool works before you sign up.
		</p>
		<p class="mt-5 inline-flex items-start gap-2 text-sm leading-6 text-muted-foreground">
			<LockKeyhole class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
			Drafts stay local unless a tool clearly offers a live network check.
		</p>
	</div>
</section>

<section class="section-pad" aria-labelledby="media-tools-title">
	<div class="marketing-shell">
		<div class="section-intro">
			<h2 id="media-tools-title">Make the media.</h2>
			<p>Use the same editors as OpenPost, without an account or a watermark.</p>
		</div>
		<div class="mt-8">
			<EditorToolsShowcase />
		</div>

		<section class="mt-20 sm:mt-28" aria-labelledby="utility-tools-title">
			<div class="section-intro">
				<h2 id="utility-tools-title">Finish the details.</h2>
				<p>Check the copy, preview the post, plan the time, and track the link.</p>
			</div>
			<div class="mt-8">
				<UtilityToolsGrid slugs={utilityToolSlugs} />
			</div>
		</section>
	</div>
</section>

<style>
	.tools-hero {
		background:
			radial-gradient(
				circle at 78% 36%,
				color-mix(in oklch, var(--primary) 9%, transparent),
				transparent 25rem
			),
			color-mix(in oklch, var(--muted) 22%, var(--background));
	}

	.section-intro {
		display: grid;
		gap: 0.75rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
	}

	.section-intro h2 {
		font-size: clamp(1.8rem, 3vw, 2.6rem);
		font-weight: 650;
		line-height: 1.05;
		letter-spacing: -0.03em;
	}

	.section-intro p {
		max-width: 42rem;
		color: var(--muted-foreground);
		font-size: 0.95rem;
		line-height: 1.6;
	}

	@media (min-width: 48rem) {
		.section-intro {
			grid-template-columns: minmax(12rem, 0.55fr) minmax(0, 1.45fr);
			align-items: end;
		}
	}
</style>
