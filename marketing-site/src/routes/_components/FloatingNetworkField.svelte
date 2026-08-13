<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import PostizSocialLogo from './PostizSocialLogo.svelte';
	import type { PostizSocialLogo as PostizSocialLogoName } from './postiz-social-logos';

	type NetworkMark =
		| {
				kind: 'platform';
				name: string;
				platform: PostizSocialLogoName;
				x: string;
				y: string;
				color: string;
				delay: string;
				rotate: string;
				size?: string;
				quietOnPhone?: boolean;
		  }
		| {
				kind: 'image';
				name: string;
				src: string;
				x: string;
				y: string;
				color: string;
				delay: string;
				rotate: string;
				size?: string;
				quietOnPhone?: boolean;
		  };

	const marks: NetworkMark[] = [
		{
			kind: 'platform',
			name: 'X',
			platform: 'x',
			x: '5%',
			y: '10%',
			color: '#f7f4ec',
			delay: '-0.8s',
			rotate: '-8deg'
		},
		{
			kind: 'platform',
			name: 'YouTube',
			platform: 'youtube',
			x: '2%',
			y: '62%',
			color: '#ff3b30',
			delay: '-2.2s',
			rotate: '8deg',
			size: '4.7rem'
		},
		{
			kind: 'platform',
			name: 'Mastodon',
			platform: 'mastodon',
			x: '14%',
			y: '37%',
			color: '#8c8dff',
			delay: '-4.7s',
			rotate: '6deg',
			quietOnPhone: true
		},
		{
			kind: 'platform',
			name: 'LinkedIn',
			platform: 'linkedin',
			x: '19%',
			y: '78%',
			color: '#73a7ff',
			delay: '-1.6s',
			rotate: '-5deg',
			quietOnPhone: true
		},
		{
			kind: 'platform',
			name: 'Bluesky',
			platform: 'bluesky',
			x: '91%',
			y: '12%',
			color: '#54a9ff',
			delay: '-3.4s',
			rotate: '9deg',
			size: '4.8rem'
		},
		{
			kind: 'platform',
			name: 'Instagram',
			platform: 'instagram',
			x: '94%',
			y: '63%',
			color: '#ff7b85',
			delay: '-5.2s',
			rotate: '-7deg'
		},
		{
			kind: 'platform',
			name: 'TikTok',
			platform: 'tiktok',
			x: '82%',
			y: '39%',
			color: '#f7f4ec',
			delay: '-2.8s',
			rotate: '5deg',
			quietOnPhone: true
		},
		{
			kind: 'platform',
			name: 'Threads',
			platform: 'threads',
			x: '76%',
			y: '82%',
			color: '#f7f4ec',
			delay: '-0.2s',
			rotate: '-6deg',
			quietOnPhone: true
		},
		{
			kind: 'platform',
			name: 'Facebook',
			platform: 'facebook',
			x: '8%',
			y: '88%',
			color: '#7aa5ff',
			delay: '-6.2s',
			rotate: '7deg',
			quietOnPhone: true
		},
		{
			kind: 'platform',
			name: 'Discord',
			platform: 'discord',
			x: '88%',
			y: '91%',
			color: '#9b91ff',
			delay: '-4.1s',
			rotate: '5deg',
			quietOnPhone: true
		},
		{
			kind: 'image',
			name: 'ChatGPT',
			src: '/assets/ai-logos/chatgpt.png',
			x: '25%',
			y: '23%',
			color: '#f7f4ec',
			delay: '-5.8s',
			rotate: '-7deg',
			quietOnPhone: true
		},
		{
			kind: 'image',
			name: 'Claude',
			src: '/assets/ai-logos/claude.png',
			x: '72%',
			y: '17%',
			color: '#d69b78',
			delay: '-1.1s',
			rotate: '7deg',
			quietOnPhone: true
		}
	];

	let field: HTMLDivElement;
	let animationFrame = 0;
	let isVisible = false;
	let markElements: HTMLElement[] = [];

	function setRepulsion(pointerX: number, pointerY: number) {
		const positions = markElements.map((element) => {
			const rect = element.getBoundingClientRect();
			return { element, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		});

		for (const { element, x, y } of positions) {
			const dx = x - pointerX;
			const dy = y - pointerY;
			const distance = Math.hypot(dx, dy);
			const radius = 190;
			if (distance === 0 || distance >= radius) {
				element.style.setProperty('--repel-x', '0px');
				element.style.setProperty('--repel-y', '0px');
				continue;
			}
			const force = (1 - distance / radius) * 34;
			element.style.setProperty('--repel-x', `${(dx / distance) * force}px`);
			element.style.setProperty('--repel-y', `${(dy / distance) * force}px`);
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (
			!field ||
			!isVisible ||
			event.pointerType !== 'mouse' ||
			matchMedia('(prefers-reduced-motion: reduce)').matches
		)
			return;
		cancelAnimationFrame(animationFrame);
		animationFrame = requestAnimationFrame(() => setRepulsion(event.clientX, event.clientY));
	}

	function resetRepulsion() {
		if (!field) return;
		cancelAnimationFrame(animationFrame);
		for (const element of markElements) {
			element.style.setProperty('--repel-x', '0px');
			element.style.setProperty('--repel-y', '0px');
		}
	}

	onMount(() => {
		markElements = Array.from(field.querySelectorAll<HTMLElement>('[data-floating-mark]'));
		const observer = new IntersectionObserver(([entry]) => {
			isVisible = entry.isIntersecting;
			if (!isVisible) resetRepulsion();
		});
		observer.observe(field);
		return () => observer.disconnect();
	});

	onDestroy(() => {
		if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animationFrame);
	});
</script>

<svelte:window onpointermove={handlePointerMove} onblur={resetRepulsion} />

<div bind:this={field} class="floating-network-field" aria-hidden="true">
	{#each marks as mark (mark.name)}
		<span
			data-floating-mark
			class:quiet-on-phone={mark.quietOnPhone}
			class="network-orbit"
			style={`--x:${mark.x};--y:${mark.y};--brand:${mark.color};--delay:${mark.delay};--turn:${mark.rotate};--mark-size:${mark.size ?? '4rem'}`}
		>
			<span class="network-card">
				{#if mark.kind === 'platform'}
					<PostizSocialLogo platform={mark.platform} />
				{:else}
					<img src={mark.src} alt="" />
				{/if}
			</span>
		</span>
	{/each}
</div>

<style>
	.floating-network-field {
		position: absolute;
		z-index: 6;
		inset: 12.5rem 0 1rem;
		pointer-events: none;
	}

	.network-orbit {
		--repel-x: 0px;
		--repel-y: 0px;
		position: absolute;
		top: var(--y);
		left: var(--x);
		width: var(--mark-size);
		height: var(--mark-size);
		transform: translate3d(calc(-50% + var(--repel-x)), calc(-50% + var(--repel-y)), 0);
		transition: transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
		will-change: transform;
	}

	.network-card {
		display: grid;
		width: 100%;
		height: 100%;
		place-items: center;
		border: 1px solid color-mix(in oklch, var(--foreground) 14%, transparent);
		border-radius: 1.1rem;
		background: color-mix(in oklch, var(--card) 92%, transparent);
		color: var(--brand);
		box-shadow: 0 1.2rem 2.8rem color-mix(in oklch, var(--foreground) 22%, transparent);
		animation: drift 6.8s ease-in-out var(--delay) infinite;
		transform: rotate(var(--turn));
		will-change: transform;
	}

	.network-card :global(svg),
	.network-card img {
		display: block;
		width: 52%;
		height: 52%;
		object-fit: contain;
	}

	:global(.dark) .network-card {
		border-color: rgb(255 255 255 / 0.13);
		background: oklch(0.2 0.012 52 / 0.92);
		box-shadow: 0 1.2rem 2.8rem rgb(0 0 0 / 0.38);
	}

	.network-card img {
		width: 66%;
		height: 66%;
		filter: saturate(0.88) brightness(1.08);
	}

	@keyframes drift {
		0%,
		100% {
			transform: translate3d(0, 0, 0) rotate(var(--turn));
		}
		50% {
			transform: translate3d(0.35rem, -0.8rem, 0) rotate(calc(var(--turn) + 2deg));
		}
	}

	@media (max-width: 47.99rem) {
		.floating-network-field {
			inset: 16rem 0 0;
		}

		.network-orbit {
			--mark-size: 2.45rem !important;
		}

		.network-orbit.quiet-on-phone {
			opacity: 0.78;
		}

		.network-orbit:nth-child(1) { top: 7%; left: 5%; }
		.network-orbit:nth-child(2) { top: 14%; left: 96%; }
		.network-orbit:nth-child(3) { top: 28%; left: 4%; }
		.network-orbit:nth-child(4) { top: 31%; left: 95%; }
		.network-orbit:nth-child(5) { top: 47%; left: 3%; }
		.network-orbit:nth-child(6) { top: 50%; left: 97%; }
		.network-orbit:nth-child(7) { top: 66%; left: 4%; }
		.network-orbit:nth-child(8) { top: 69%; left: 96%; }
		.network-orbit:nth-child(9) { top: 85%; left: 6%; }
		.network-orbit:nth-child(10) { top: 88%; left: 94%; }
		.network-orbit:nth-child(11) { top: 2%; left: 25%; }
		.network-orbit:nth-child(12) { top: 3%; left: 76%; }
	}

	@media (prefers-reduced-motion: reduce) {
		.network-orbit {
			transition: none;
		}

		.network-card {
			animation: none;
		}
	}
</style>
