<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowRight, Clapperboard, Images } from '@lucide/svelte';

	const editors = [
		{
			slug: 'social-media-video-editor',
			name: 'Video Editor',
			description: 'Cut, caption, and export a social video.',
			action: 'Edit a video',
			image: '/assets/screenshots/video-editor-dark.webp',
			alt: 'OpenPost Video Editor cutting a Study SOS screen recording',
			icon: Clapperboard
		},
		{
			slug: 'social-media-image-editor',
			name: 'Image Editor',
			description: 'Build a post, Story, carousel, or thumbnail.',
			action: 'Edit an image',
			image: '/assets/screenshots/image-editor-dark.webp',
			alt: 'OpenPost Image Editor with the OpenPost logo selected over a Lisbon tram photo',
			icon: Images
		}
	] as const;
</script>

<div class="editor-grid">
	{#each editors as editor (editor.slug)}
		{@const Icon = editor.icon}
		<a
			href={resolve(`/tools/${editor.slug}`)}
			class="editor-card focus-ring group"
			data-editor={editor.slug}
		>
			<span class="editor-shot">
				<img
					src={editor.image}
					alt={editor.alt}
					width="1440"
					height="960"
					loading="lazy"
					decoding="async"
				/>
			</span>
			<span class="editor-copy">
				<span class="editor-icon"><Icon aria-hidden="true" /></span>
				<span class="min-w-0 flex-1">
					<strong>{editor.name}</strong>
					<span>{editor.description}</span>
				</span>
				<span class="editor-action">
					{editor.action}
					<ArrowRight aria-hidden="true" />
				</span>
			</span>
		</a>
	{/each}
</div>

<style>
	.editor-grid {
		display: grid;
		gap: 1rem;
	}

	.editor-card {
		display: block;
		min-width: 0;
		overflow: hidden;
		border: 1px solid color-mix(in oklch, var(--foreground) 13%, transparent);
		border-radius: 1rem;
		background: var(--card);
		color: var(--foreground);
		transition:
			transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
			border-color 180ms ease;
	}

	.editor-card:hover {
		transform: translateY(-0.2rem);
		border-color: color-mix(in oklch, var(--primary) 42%, var(--border));
	}

	.editor-shot {
		display: block;
		aspect-ratio: 3 / 2;
		overflow: hidden;
		border-bottom: 1px solid color-mix(in oklch, var(--foreground) 12%, transparent);
		background: oklch(0.12 0.008 52);
	}

	.editor-shot img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
		transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.editor-card:hover .editor-shot img,
	.editor-card:focus-visible .editor-shot img {
		transform: scale(1.015);
	}

	.editor-copy {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 1.1rem;
	}

	.editor-icon {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--primary) 12%, transparent);
		color: var(--primary);
	}

	.editor-icon :global(svg) {
		width: 1.15rem;
		height: 1.15rem;
	}

	.editor-copy strong,
	.editor-copy > span > span {
		display: block;
	}

	.editor-copy strong {
		font-size: 1rem;
		font-weight: 650;
		letter-spacing: -0.015em;
	}

	.editor-copy > span > span {
		margin-top: 0.2rem;
		color: var(--muted-foreground);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.editor-action {
		display: none;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.35rem;
		color: var(--primary);
		font-size: 0.82rem;
		font-weight: 650;
	}

	.editor-action :global(svg) {
		width: 0.95rem;
		height: 0.95rem;
		transition: transform 180ms ease;
	}

	.editor-card:hover .editor-action :global(svg),
	.editor-card:focus-visible .editor-action :global(svg) {
		transform: translateX(0.2rem);
	}

	@media (min-width: 48rem) {
		.editor-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.editor-action {
			display: inline-flex;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.editor-card,
		.editor-shot img,
		.editor-action :global(svg) {
			transition: none;
		}

		.editor-card:hover,
		.editor-card:hover .editor-shot img,
		.editor-card:focus-visible .editor-shot img,
		.editor-card:hover .editor-action :global(svg),
		.editor-card:focus-visible .editor-action :global(svg) {
			transform: none;
		}
	}
</style>
