<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	let {
		children,
		class: className = '',
		delay = 0
	}: { children: Snippet; class?: string; delay?: number } = $props();

	const reveal: Attachment<HTMLElement> = (node) => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			node.dataset.revealVisible = 'true';
			return;
		}
		node.dataset.revealReady = 'true';
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				node.dataset.revealVisible = 'true';
				observer.disconnect();
			},
			{ threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	};
</script>

<div class={className} style:--reveal-delay={`${delay}ms`} {@attach reveal}>
	{@render children()}
</div>

<style>
	:global(div[data-reveal-ready='true']) {
		opacity: 0;
		transform: translateY(1.1rem);
		filter: blur(5px);
		clip-path: inset(0 0 8% 0 round 0.75rem);
		transition:
			opacity 620ms cubic-bezier(0.16, 1, 0.3, 1),
			transform 680ms cubic-bezier(0.16, 1, 0.3, 1),
			filter 620ms cubic-bezier(0.16, 1, 0.3, 1),
			clip-path 680ms cubic-bezier(0.16, 1, 0.3, 1);
		transition-delay: var(--reveal-delay);
	}

	:global(div[data-reveal-visible='true']) {
		opacity: 1;
		transform: none;
		filter: none;
		clip-path: inset(0 0 0 0 round 0.75rem);
	}

	@media (prefers-reduced-motion: reduce) {
		div {
			opacity: 1;
			transform: none;
			filter: none;
			clip-path: none;
			transition: none;
		}
	}
</style>
