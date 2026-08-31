<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Play from '@lucide/svelte/icons/play';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { demoVideoEmbedUrl, demoVideoUrl } from '../_marketing';

	let open = $state(false);
</script>

<section class="demo-section" aria-labelledby="demo-title">
	<div class="marketing-shell demo-shell">
		<div class="demo-copy">
			<p class="demo-kicker">Product tour</p>
			<h2 id="demo-title">See how a post gets published.</h2>
			<p>Draft it, tailor each account version, and schedule it.</p>
			<Button
				href={demoVideoUrl}
				target="_blank"
				rel="noreferrer"
				variant="outline"
				class="youtube-button"
			>
				Open on YouTube
				<ExternalLink data-icon="inline-end" />
			</Button>
		</div>

		<Dialog.Root bind:open>
			<div class="demo-frame">
				<div class="frame-bar" aria-hidden="true">
					<span></span><span></span><span></span>
					<strong>openpost.social / product tour</strong>
				</div>
				<Dialog.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="demo-trigger"
							aria-label="Play the OpenPost product demo"
							data-cuelume-press="press"
							data-cuelume-release="release"
						>
							<img
								src="/assets/screenshots/main-dark.png"
								alt="OpenPost publishing workspace"
								width="1440"
								height="960"
								loading="lazy"
								decoding="async"
							/>
							<span class="demo-shade" aria-hidden="true"></span>
							<span class="play-button" aria-hidden="true"><Play /></span>
							<span class="play-label">Watch the demo</span>
						</button>
					{/snippet}
				</Dialog.Trigger>
			</div>

			<Dialog.Content
				showCloseButton={false}
				class="video-dialog bg-black p-0 text-white ring-white/20"
			>
				<Dialog.Title class="sr-only">OpenPost product demo</Dialog.Title>
				<Dialog.Description class="sr-only">
					A four-minute walkthrough of drafting, adapting, scheduling, and publishing with OpenPost.
				</Dialog.Description>
				<Dialog.Close>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="video-close"
							aria-label="Close product demo"
							data-cuelume-release="droplet"
						>
							<X />
						</button>
					{/snippet}
				</Dialog.Close>
				{#if open}
					<iframe
						src={demoVideoEmbedUrl}
						title="OpenPost product demo"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowfullscreen
					></iframe>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	</div>
</section>

<style>
	.demo-section {
		position: relative;
		overflow: hidden;
		border-block: 1px solid var(--border);
		background: color-mix(in oklch, var(--muted) 38%, var(--background));
		color: var(--foreground);
	}

	.demo-section::before {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 74% 46%, oklch(0.56 0.16 45 / 0.28), transparent 34rem);
		content: '';
		pointer-events: none;
	}

	.demo-shell {
		position: relative;
		display: grid;
		gap: clamp(2.5rem, 6vw, 6rem);
		align-items: center;
		padding-block: clamp(5rem, 10vw, 9rem);
	}

	.demo-copy {
		max-width: 34rem;
	}

	.demo-kicker {
		color: oklch(0.76 0.14 50);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.demo-copy h2 {
		margin-top: 1rem;
		font-size: clamp(2.5rem, 4.8vw, 4.2rem);
		font-weight: 720;
		line-height: 0.96;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.demo-copy > p:not(.demo-kicker) {
		max-width: 31rem;
		margin: 1.5rem 0 2rem;
		color: var(--muted-foreground);
		font-size: 1.05rem;
		line-height: 1.7;
	}

	.demo-copy :global(.youtube-button) {
		background: var(--card);
	}

	.demo-frame {
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 0.18);
		border-radius: 1.25rem;
		background: black;
		box-shadow:
			0 2rem 5rem rgb(0 0 0 / 0.48),
			0 7px 0 oklch(0.4 0.13 43);
	}

	.frame-bar {
		display: flex;
		height: 2.8rem;
		align-items: center;
		gap: 0.42rem;
		padding-inline: 1rem;
		border-bottom: 1px solid rgb(255 255 255 / 0.1);
		background: oklch(0.19 0.008 52);
	}

	.frame-bar span {
		width: 0.62rem;
		height: 0.62rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.18);
	}

	.frame-bar span:first-child {
		background: oklch(0.67 0.18 45);
	}

	.frame-bar strong {
		margin-left: auto;
		color: rgb(255 255 255 / 0.36);
		font-family: ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 500;
	}

	.demo-trigger {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border: 0;
	}

	:global([data-slot='dialog-content'].video-dialog) {
		position: fixed;
		display: block;
		width: min(72rem, calc(100vw - 2rem));
		height: min(40.5rem, calc((100vw - 2rem) * 9 / 16), calc(100dvh - 2rem));
		max-width: none;
		max-height: calc(100dvh - 2rem);
		overflow: hidden;
		aspect-ratio: auto;
		border-radius: 1rem;
		box-shadow: 0 2.5rem 8rem rgb(0 0 0 / 0.58);
	}

	:global([data-slot='dialog-content'].video-dialog iframe) {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: inherit;
	}

	.video-close {
		position: absolute;
		z-index: 2;
		top: 0.75rem;
		right: 0.75rem;
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid rgb(255 255 255 / 0.22);
		border-radius: 50%;
		background: rgb(14 13 12 / 0.82);
		color: white;
		box-shadow: 0 4px 0 rgb(0 0 0 / 0.72);
		cursor: pointer;
		transition:
			transform 100ms ease,
			box-shadow 100ms ease,
			background 100ms ease;
	}

	:global(.dark) .demo-section {
		border-color: rgb(255 255 255 / 0.08);
		background: oklch(0.13 0.01 52);
		color: white;
	}

	:global(.dark) .demo-copy > p:not(.demo-kicker) {
		color: rgb(255 255 255 / 0.65);
	}

	:global(.dark) .demo-copy :global(.youtube-button) {
		border-color: rgb(255 255 255 / 0.24);
		background: rgb(255 255 255 / 0.94);
		color: oklch(0.16 0.01 52);
	}

	.video-close:hover {
		transform: translateY(-1px);
		background: rgb(40 36 33 / 0.94);
		box-shadow: 0 5px 0 rgb(0 0 0 / 0.72);
	}

	.video-close:active {
		transform: translateY(3px);
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.72);
	}

	.video-close :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
	}

	.demo-trigger {
		position: relative;
		overflow: hidden;
		padding: 0;
		background: black;
		color: white;
		cursor: pointer;
	}

	.demo-trigger img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top;
		transition:
			transform 280ms cubic-bezier(0.16, 1, 0.3, 1),
			filter 180ms ease;
	}

	.demo-trigger:hover img {
		transform: scale(1.015);
		filter: brightness(0.82);
	}

	.demo-shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(0 0 0 / 0.58), transparent 62%);
	}

	.play-button {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		width: clamp(4.5rem, 9vw, 6.5rem);
		height: clamp(4.5rem, 9vw, 6.5rem);
		place-items: center;
		border-radius: 50%;
		background: oklch(0.68 0.17 45);
		color: oklch(0.13 0.01 52);
		box-shadow:
			0 6px 0 oklch(0.4 0.13 43),
			0 1.5rem 3rem rgb(0 0 0 / 0.38);
		transform: translate(-50%, -50%);
		transition:
			transform 120ms ease,
			box-shadow 120ms ease;
	}

	.play-button :global(svg) {
		width: 32%;
		height: 32%;
		fill: currentColor;
	}

	.demo-trigger:hover .play-button {
		transform: translate(-50%, calc(-50% - 3px));
		box-shadow:
			0 9px 0 oklch(0.4 0.13 43),
			0 1.8rem 3.5rem rgb(0 0 0 / 0.42);
	}

	.demo-trigger:active .play-button {
		transform: translate(-50%, calc(-50% + 4px));
		box-shadow: 0 1px 0 oklch(0.4 0.13 43);
	}

	.play-label {
		position: absolute;
		bottom: 1.2rem;
		left: 1.2rem;
		font-size: 0.78rem;
		font-weight: 700;
	}

	@media (min-width: 64rem) {
		.demo-shell {
			grid-template-columns: 0.62fr 1.38fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.demo-trigger img,
		.play-button,
		.video-close {
			transition: none;
		}
	}
</style>
