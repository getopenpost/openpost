<script lang="ts">
	import { onMount } from 'svelte';
	import Heart from '@lucide/svelte/icons/heart';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Repeat2 from '@lucide/svelte/icons/repeat-2';
	import Send from '@lucide/svelte/icons/send';
	import PlatformIcon from '$lib/components/platform-icon.svelte';

	type ResultSlide = {
		platform: 'tiktok' | 'x' | 'instagram';
		name: string;
		summary: string;
	};

	const slides: ResultSlide[] = [
		{
			platform: 'x',
			name: 'Audience growth',
			summary: 'A clear view of the posts and conversations that build an audience.'
		},
		{
			platform: 'tiktok',
			name: 'Video reach',
			summary: 'See which short videos earned attention after they went live.'
		},
		{
			platform: 'instagram',
			name: 'Content results',
			summary: 'Keep reach, interactions, and follower activity next to the work.'
		}
	];

	let activeIndex = $state(1);
	let autoplayStopped = $state(false);

	function positionFor(index: number) {
		const distance = (index - activeIndex + slides.length) % slides.length;
		if (distance === 0) return 'active';
		return distance === 1 ? 'next' : 'previous';
	}

	function selectSlide(index: number) {
		autoplayStopped = true;
		activeIndex = index;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const step = event.key === 'ArrowRight' ? 1 : -1;
		selectSlide((activeIndex + step + slides.length) % slides.length);
	}

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const timer = window.setInterval(() => {
			if (autoplayStopped || document.hidden) return;
			activeIndex = (activeIndex + 1) % slides.length;
		}, 5000);
		return () => window.clearInterval(timer);
	});
</script>

<div class="results-carousel" role="group" aria-label="Social publishing result previews">
	<p class="sr-only" aria-live="polite">Showing {slides[activeIndex].name}</p>
	<div class="phone-stage">
		{#each slides as slide, index (slide.platform)}
			{@const position = positionFor(index)}
			<button
				type="button"
				class={['phone-position', `phone-${position}`]}
				aria-label={`Show ${slide.name}`}
				aria-pressed={index === activeIndex}
				data-active={index === activeIndex ? 'true' : undefined}
				data-cuelume-release="page"
				onclick={() => selectSlide(index)}
				onkeydown={handleKeydown}
			>
				<span class="phone-shell">
					<span class="phone-hardware" aria-hidden="true">
						<span>9:41</span>
						<span class="dynamic-island"></span>
						<span>● ▮</span>
					</span>

					{#if slide.platform === 'tiktok'}
						<span class="result-screen tiktok-screen">
							<span class="screen-brand">
								<PlatformIcon platform="tiktok" class="size-4" />
								TikTok Studio
								<small>Preview</small>
							</span>
							<span class="video-card">
								<span class="video-art" aria-hidden="true">
									<span class="video-art-brand"><i>OP</i> OpenPost</span>
									<strong>Create once.</strong>
									<strong>Adapt each version.</strong>
									<span class="publishing-path"><i></i><i></i><i></i><i></i><i></i></span>
								</span>
								<span class="video-shade"></span>
								<span class="video-copy">
									<strong>One publication. Each destination.</strong>
									<span>@openpost · Product update</span>
								</span>
								<span class="video-actions" aria-hidden="true">
									<span><Heart /> 8.4K</span>
									<span><MessageCircle /> 326</span>
									<span><Send /> 184</span>
								</span>
							</span>
							<span class="result-panel">
								<span>
									<small>Video views</small>
									<strong>128.4K</strong>
								</span>
								<span class="trend">+24.8%</span>
							</span>
							<span class="result-bars" aria-hidden="true">
								{#each [28, 48, 36, 67, 53, 82, 74, 94, 86] as height, bar (bar)}
									<i style:--bar={`${height}%`}></i>
								{/each}
							</span>
						</span>
					{:else if slide.platform === 'x'}
						<span class="result-screen x-screen">
							<span class="screen-brand">
								<PlatformIcon platform="x" class="size-4" />
								Audience
								<small>Preview</small>
							</span>
							<span class="profile-block">
								<span class="profile-mark">OP</span>
								<strong>OpenPost</strong>
								<span>@openpost</span>
								<small>Your socials, on steroids.</small>
							</span>
							<span class="follower-row">
								<span><strong>12.8K</strong><small>Followers</small></span>
								<span><strong>846</strong><small>Following</small></span>
								<span><strong>4.9%</strong><small>Growth</small></span>
							</span>
							<span class="post-card">
								<span class="post-author"
									><b>OP</b><strong>OpenPost</strong><small>· 2h</small></span
								>
								<span class="post-copy"
									>A product update can become a week of useful posts without losing the original
									idea.</span
								>
								<span class="post-stats" aria-hidden="true">
									<span><MessageCircle /> 48</span>
									<span><Repeat2 /> 126</span>
									<span><Heart /> 1.2K</span>
								</span>
							</span>
							<span class="impression-total">
								<small>Post impressions</small>
								<strong>84,290</strong>
							</span>
						</span>
					{:else}
						<span class="result-screen instagram-screen">
							<span class="screen-brand">
								<PlatformIcon platform="instagram" class="size-4" />
								Insights
								<small>Preview</small>
							</span>
							<span class="insight-period">Last 30 days</span>
							<span class="reach-ring">
								<span><strong>64.2K</strong><small>Accounts reached</small></span>
							</span>
							<span class="insight-grid">
								<span><small>Interactions</small><strong>8,421</strong><em>+18%</em></span>
								<span><small>Profile activity</small><strong>3,906</strong><em>+12%</em></span>
							</span>
							<span class="top-content">
								<strong>Top content</strong>
								<span class="content-thumbs" aria-hidden="true">
									<i></i><i></i><i></i>
								</span>
							</span>
						</span>
					{/if}

					<span class="phone-home" aria-hidden="true"></span>
				</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.results-carousel {
		position: relative;
		outline: none;
	}

	.phone-stage {
		position: relative;
		height: clamp(31rem, 62vw, 42rem);
		perspective: 90rem;
	}

	.phone-position {
		position: absolute;
		top: 0;
		left: 50%;
		width: clamp(14rem, 27vw, 20rem);
		padding: 0;
		border: 0;
		border-radius: 2.6rem;
		background: transparent;
		color: white;
		cursor: pointer;
		pointer-events: auto;
		transition:
			transform 560ms cubic-bezier(0.16, 1, 0.3, 1),
			opacity 420ms ease,
			filter 420ms ease;
	}

	.phone-position:focus-visible {
		outline: 3px solid oklch(0.78 0.14 50);
		outline-offset: 0.45rem;
	}

	.phone-position:active {
		transition-duration: 110ms;
	}

	.phone-active {
		z-index: 3;
		transform: translateX(-50%) translateY(0) rotateY(0deg);
	}

	.phone-previous {
		z-index: 1;
		transform: translateX(calc(-50% - clamp(10rem, 25vw, 18rem))) translateY(4.7rem) rotateY(11deg)
			rotateZ(-2.5deg) scale(0.84);
		filter: brightness(0.48) saturate(0.7);
	}

	.phone-next {
		z-index: 2;
		transform: translateX(calc(-50% + clamp(10rem, 25vw, 18rem))) translateY(4.7rem) rotateY(-11deg)
			rotateZ(2.5deg) scale(0.84);
		filter: brightness(0.48) saturate(0.7);
	}

	.phone-previous:hover,
	.phone-next:hover {
		filter: brightness(0.62) saturate(0.85);
	}

	.phone-shell {
		position: relative;
		display: block;
		overflow: hidden;
		aspect-ratio: 9 / 19.1;
		padding: 0.48rem;
		border: 1px solid rgb(255 255 255 / 0.34);
		border-radius: inherit;
		background: linear-gradient(
			145deg,
			oklch(0.38 0.01 55),
			oklch(0.12 0.006 55) 18% 84%,
			oklch(0.4 0.01 55)
		);
		box-shadow:
			0 2.8rem 5rem rgb(0 0 0 / 0.52),
			inset 0 0 0 1px rgb(255 255 255 / 0.16);
	}

	.result-screen {
		position: relative;
		display: flex;
		height: 100%;
		flex-direction: column;
		overflow: hidden;
		border-radius: 2.12rem;
		background: oklch(0.16 0.008 55);
		color: white;
		text-align: left;
	}

	.phone-hardware {
		position: absolute;
		z-index: 8;
		top: 0.95rem;
		left: 1.2rem;
		right: 1.2rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.58rem;
		font-weight: 700;
	}

	.dynamic-island {
		width: 30%;
		height: 1.2rem;
		border-radius: 999px;
		background: black;
	}

	.phone-home {
		position: absolute;
		z-index: 9;
		bottom: 0.75rem;
		left: 50%;
		width: 34%;
		height: 0.24rem;
		transform: translateX(-50%);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.78);
	}

	.screen-brand {
		display: flex;
		min-height: 4.4rem;
		align-items: flex-end;
		gap: 0.45rem;
		padding: 0 1rem 0.8rem;
		border-bottom: 1px solid rgb(255 255 255 / 0.1);
		font-size: 0.76rem;
		font-weight: 700;
	}

	.screen-brand small {
		margin-left: auto;
		padding: 0.16rem 0.34rem;
		border: 1px solid rgb(255 255 255 / 0.16);
		border-radius: 0.35rem;
		background: rgb(255 255 255 / 0.08);
		color: rgb(255 255 255 / 0.72);
		font-size: 0.46rem;
		font-weight: 750;
		letter-spacing: 0.08em;
		line-height: 1;
		text-transform: uppercase;
	}

	.video-card {
		position: relative;
		display: block;
		overflow: hidden;
		min-height: 58%;
		background: oklch(0.1 0.005 55);
	}

	.video-art {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 1.25rem 1rem 5rem;
		background:
			radial-gradient(circle at 82% 22%, oklch(0.75 0.16 48 / 0.36), transparent 26%),
			linear-gradient(145deg, oklch(0.25 0.08 35), oklch(0.11 0.008 52) 64%);
	}

	.video-art-brand {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		margin-bottom: 1.15rem;
		color: rgb(255 255 255 / 0.64);
		font-size: 0.56rem;
		font-weight: 700;
	}

	.video-art-brand i {
		display: grid;
		width: 1.35rem;
		height: 1.35rem;
		place-items: center;
		border-radius: 0.35rem;
		background: oklch(0.67 0.18 45);
		color: oklch(0.14 0.008 52);
		font-size: 0.45rem;
		font-style: normal;
		font-weight: 850;
	}

	.video-art > strong {
		max-width: 9ch;
		font-size: clamp(1rem, 2vw, 1.45rem);
		line-height: 0.96;
		letter-spacing: -0.04em;
	}

	.video-art > strong + strong {
		color: oklch(0.72 0.16 48);
	}

	.publishing-path {
		display: flex;
		align-items: center;
		gap: 0.28rem;
		margin-top: 1.35rem;
	}

	.publishing-path i {
		width: 1.25rem;
		height: 1.25rem;
		border: 1px solid rgb(255 255 255 / 0.14);
		border-radius: 0.38rem;
		background: rgb(255 255 255 / 0.08);
	}

	.publishing-path i:first-child {
		position: relative;
		margin-right: 0.55rem;
		background: oklch(0.67 0.18 45);
	}

	.publishing-path i:first-child::after {
		position: absolute;
		top: 50%;
		left: calc(100% + 0.08rem);
		width: 0.65rem;
		height: 1px;
		background: rgb(255 255 255 / 0.34);
		content: '';
	}

	.video-shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(0 0 0 / 0.88), transparent 56%);
	}

	.video-copy {
		position: absolute;
		right: 2.8rem;
		bottom: 1rem;
		left: 0.85rem;
		display: grid;
		gap: 0.28rem;
	}

	.video-copy strong {
		font-size: 0.72rem;
	}

	.video-copy span {
		color: rgb(255 255 255 / 0.68);
		font-size: 0.58rem;
	}

	.video-actions {
		position: absolute;
		right: 0.55rem;
		bottom: 0.9rem;
		display: grid;
		gap: 0.58rem;
		font-size: 0.47rem;
		text-align: center;
	}

	.video-actions span {
		display: grid;
		justify-items: center;
		gap: 0.18rem;
	}

	.video-actions :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.result-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1rem 0.35rem;
	}

	.result-panel span:first-child,
	.impression-total {
		display: grid;
		gap: 0.2rem;
	}

	.result-panel small,
	.impression-total small,
	.follower-row small,
	.insight-grid small,
	.reach-ring small {
		color: rgb(255 255 255 / 0.52);
		font-size: 0.56rem;
	}

	.result-panel strong,
	.impression-total strong {
		font-size: 1.25rem;
		letter-spacing: -0.03em;
	}

	.trend,
	.insight-grid em {
		color: oklch(0.8 0.15 145);
		font-size: 0.58rem;
		font-style: normal;
		font-weight: 700;
	}

	.result-bars {
		display: flex;
		height: 3.8rem;
		align-items: flex-end;
		gap: 0.24rem;
		padding: 0.5rem 1rem 1rem;
	}

	.result-bars i {
		width: 100%;
		height: var(--bar);
		border-radius: 0.18rem 0.18rem 0 0;
		background: oklch(0.66 0.17 45);
	}

	.x-screen {
		background: oklch(0.12 0.004 255);
	}

	.profile-block {
		display: grid;
		justify-items: center;
		gap: 0.16rem;
		padding: 1.2rem 1rem 0.8rem;
	}

	.profile-mark,
	.post-author b {
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: oklch(0.66 0.17 45);
		color: oklch(0.16 0.008 55);
		font-weight: 800;
	}

	.profile-mark {
		width: 3.5rem;
		height: 3.5rem;
		margin-bottom: 0.35rem;
		font-size: 1rem;
	}

	.profile-block strong {
		font-size: 0.92rem;
	}

	.profile-block span,
	.profile-block small {
		color: rgb(255 255 255 / 0.52);
		font-size: 0.56rem;
	}

	.follower-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin: 0 0.75rem;
		padding: 0.8rem 0;
		border-block: 1px solid rgb(255 255 255 / 0.1);
	}

	.follower-row > span {
		display: grid;
		gap: 0.18rem;
		text-align: center;
	}

	.follower-row strong {
		font-size: 0.78rem;
	}

	.post-card {
		display: grid;
		gap: 0.7rem;
		margin: 0.85rem 0.75rem 0;
		padding: 0.8rem;
		border: 1px solid rgb(255 255 255 / 0.1);
		border-radius: 0.85rem;
		background: rgb(255 255 255 / 0.035);
	}

	.post-author {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.57rem;
	}

	.post-author b {
		width: 1.3rem;
		height: 1.3rem;
		font-size: 0.48rem;
	}

	.post-author small {
		color: rgb(255 255 255 / 0.42);
	}

	.post-copy {
		font-size: 0.62rem;
		line-height: 1.45;
	}

	.post-stats {
		display: flex;
		justify-content: space-between;
		color: rgb(255 255 255 / 0.52);
		font-size: 0.5rem;
	}

	.post-stats span {
		display: flex;
		align-items: center;
		gap: 0.22rem;
	}

	.post-stats :global(svg) {
		width: 0.72rem;
		height: 0.72rem;
	}

	.impression-total {
		margin: auto 1rem 1.6rem;
		padding: 0.9rem;
		border-radius: 0.8rem;
		background: oklch(0.66 0.17 45 / 0.12);
	}

	.instagram-screen {
		background: oklch(0.16 0.018 335);
	}

	.insight-period {
		align-self: flex-start;
		margin: 0.9rem 1rem 0;
		padding: 0.34rem 0.55rem;
		border: 1px solid rgb(255 255 255 / 0.12);
		border-radius: 0.5rem;
		color: rgb(255 255 255 / 0.68);
		font-size: 0.55rem;
	}

	.reach-ring {
		display: grid;
		width: 8rem;
		height: 8rem;
		place-items: center;
		align-self: center;
		margin-top: 1.3rem;
		border-radius: 50%;
		background: conic-gradient(oklch(0.68 0.18 42) 0 82%, rgb(255 255 255 / 0.09) 82%);
	}

	.reach-ring::before {
		position: absolute;
		width: 6.7rem;
		height: 6.7rem;
		border-radius: 50%;
		background: oklch(0.16 0.018 335);
		content: '';
	}

	.reach-ring span {
		z-index: 1;
		display: grid;
		gap: 0.18rem;
		text-align: center;
	}

	.reach-ring strong {
		font-size: 1.2rem;
	}

	.insight-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.45rem;
		margin: 1.2rem 0.75rem 0;
	}

	.insight-grid > span {
		display: grid;
		gap: 0.2rem;
		padding: 0.72rem;
		border-radius: 0.7rem;
		background: rgb(255 255 255 / 0.06);
	}

	.insight-grid strong {
		font-size: 0.82rem;
	}

	.top-content {
		display: grid;
		gap: 0.55rem;
		margin: 1rem 0.75rem 1.6rem;
		font-size: 0.62rem;
	}

	.content-thumbs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.35rem;
	}

	.content-thumbs i {
		aspect-ratio: 1;
		border-radius: 0.45rem;
		background:
			linear-gradient(150deg, transparent 44%, rgb(0 0 0 / 0.28) 45%), oklch(0.64 0.16 43);
	}

	.content-thumbs i:nth-child(2) {
		background: linear-gradient(25deg, transparent 46%, rgb(0 0 0 / 0.28) 47%), oklch(0.5 0.13 255);
	}

	.content-thumbs i:nth-child(3) {
		background: linear-gradient(145deg, transparent 48%, rgb(0 0 0 / 0.3) 49%), oklch(0.5 0.12 155);
	}

	@media (max-width: 39.99rem) {
		.phone-stage {
			height: 31.5rem;
		}

		.phone-position {
			width: 14.2rem;
		}

		.phone-previous {
			transform: translateX(calc(-50% - 9.8rem)) translateY(3.8rem) rotateY(11deg) rotateZ(-2.5deg)
				scale(0.77);
		}

		.phone-next {
			transform: translateX(calc(-50% + 9.8rem)) translateY(3.8rem) rotateY(-11deg) rotateZ(2.5deg)
				scale(0.77);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.phone-position {
			transition: none;
		}
	}
</style>
