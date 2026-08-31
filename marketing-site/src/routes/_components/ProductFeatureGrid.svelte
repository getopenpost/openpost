<script lang="ts">
	import { CalendarRange, Layers3, LibraryBig } from '@lucide/svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
</script>

<div class="feature-grid">
	<Card class="feature-card feature-card-create">
		<CardContent class="feature-content feature-content-create">
			<div class="feature-copy">
				<span class="feature-icon"><Layers3 aria-hidden="true" /></span>
				<h3>Create in one place.</h3>
				<p>Write posts, threads, stories, and videos without rebuilding the idea for every app.</p>
			</div>
			<div class="feature-shot feature-shot-wide">
				<img
					src="/assets/screenshots/main-dark.png"
					alt="OpenPost publication composer"
					width="1440"
					height="960"
					loading="lazy"
					decoding="async"
				/>
			</div>
		</CardContent>
	</Card>

	<Card class="feature-card feature-card-adapt">
		<CardContent class="feature-content feature-content-stacked">
			<div class="feature-copy">
				<span class="feature-icon"><CalendarRange aria-hidden="true" /></span>
				<h3>Adapt every post.</h3>
				<p>Change the copy, media, and settings for each account before it goes live.</p>
			</div>
			<div class="feature-shot feature-shot-tall">
				<img
					src="/assets/screenshots/accounts-dark.png"
					alt="OpenPost connected account settings"
					width="1440"
					height="960"
					loading="lazy"
					decoding="async"
				/>
			</div>
		</CardContent>
	</Card>

	<Card class="feature-card feature-card-media">
		<CardContent class="feature-content feature-content-media">
			<div class="feature-copy">
				<span class="feature-icon"><LibraryBig aria-hidden="true" /></span>
				<h3>Reuse your media.</h3>
				<p>Keep images, videos, captions, and alt text ready for the next post.</p>
			</div>
			<div class="feature-shot feature-shot-media">
				<img
					src="/assets/screenshots/media-dark.png"
					alt="OpenPost media library"
					width="1440"
					height="960"
					loading="lazy"
					decoding="async"
				/>
			</div>
		</CardContent>
	</Card>
</div>

<style>
	.feature-grid {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.75rem;
	}

	:global(.feature-card) {
		min-width: 0;
		padding: 0;
		border: 1px solid color-mix(in oklch, var(--foreground) 11%, transparent);
		border-radius: 1rem;
		background: color-mix(in oklch, var(--card) 94%, var(--background));
		box-shadow: none;
		transition:
			border-color 180ms ease,
			transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(.feature-card:hover) {
		transform: translateY(-0.2rem);
		border-color: color-mix(in oklch, var(--foreground) 24%, var(--border));
	}

	:global(.feature-card-create) {
		grid-column: span 4;
	}

	:global(.feature-card-adapt) {
		grid-column: span 2;
	}

	:global(.feature-card-media) {
		grid-column: span 6;
	}

	:global(.feature-content) {
		min-height: 100%;
		padding: clamp(1.25rem, 2.5vw, 2rem);
	}

	:global(.feature-content-create) {
		display: grid;
		grid-template-columns: minmax(13rem, 0.72fr) minmax(0, 1.28fr);
		gap: clamp(1.5rem, 3vw, 3rem);
		align-items: center;
	}

	:global(.feature-content-stacked) {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	:global(.feature-content-media) {
		display: grid;
		grid-template-columns: minmax(13rem, 0.62fr) minmax(0, 1.38fr);
		gap: clamp(1.5rem, 4vw, 4rem);
		align-items: center;
	}

	.feature-copy {
		position: relative;
		z-index: 1;
	}

	.feature-icon {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--background);
		color: var(--primary);
	}

	.feature-icon :global(svg) {
		width: 1.2rem;
		height: 1.2rem;
	}

	.feature-copy h3 {
		margin-top: 1.5rem;
		font-size: clamp(1.6rem, 3vw, 2.35rem);
		font-weight: 700;
		line-height: 1.02;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}

	.feature-copy p {
		max-width: 34rem;
		margin-top: 1rem;
		color: var(--muted-foreground);
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.feature-shot {
		min-width: 0;
		overflow: hidden;
		border-radius: 0.875rem;
		background: oklch(0.13 0.01 52);
	}

	.feature-shot img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
		transition: transform 360ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(.feature-card:hover) .feature-shot img {
		transform: scale(1.015);
	}

	.feature-shot-wide {
		min-height: 22rem;
		align-self: stretch;
	}

	.feature-shot-tall {
		min-height: 18rem;
		flex: 1;
	}

	.feature-shot-tall img {
		width: 175%;
		max-width: none;
	}

	.feature-shot-media {
		aspect-ratio: 16 / 8;
	}

	@media (max-width: 63.99rem) {
		:global(.feature-card-create),
		:global(.feature-card-adapt) {
			grid-column: span 3;
		}

		:global(.feature-content-create),
		:global(.feature-content-media) {
			grid-template-columns: 1fr;
		}

		.feature-shot-media {
			aspect-ratio: 3 / 2;
		}

		.feature-shot-wide {
			min-height: auto;
			aspect-ratio: 3 / 2;
		}
	}

	@media (max-width: 47.99rem) {
		:global(.feature-card-create),
		:global(.feature-card-adapt),
		:global(.feature-card-media) {
			grid-column: 1 / -1;
		}

		.feature-shot-tall {
			min-height: auto;
			aspect-ratio: 3 / 2;
		}

		.feature-shot-tall img {
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.feature-card),
		.feature-shot img {
			transition: none;
		}
	}
</style>
