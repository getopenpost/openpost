<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ArrowRight,
		CheckCircle2,
		Clapperboard,
		Clock3,
		FileText,
		GitBranch,
		Images,
		Link2,
		MessageSquareText,
		PanelTop
	} from '@lucide/svelte';
	import { tools, type MarketingToolSlug } from '../_marketing';

	interface Props {
		slugs: readonly MarketingToolSlug[];
	}

	type MarketingTool = (typeof tools)[number];

	let { slugs }: Props = $props();

	const details = {
		'social-media-video-editor': { icon: Clapperboard, action: 'Edit a video' },
		'social-media-image-editor': { icon: Images, action: 'Edit an image' },
		'multi-platform-character-counter': { icon: FileText, action: 'Check every limit' },
		'post-preview-generator': { icon: PanelTop, action: 'Preview the post' },
		'thread-splitter': { icon: GitBranch, action: 'Split the draft' },
		'fediverse-handle-checker': { icon: CheckCircle2, action: 'Check a handle' },
		'linkedin-text-formatter': { icon: MessageSquareText, action: 'Clean the copy' },
		'best-time-to-post-calculator': { icon: Clock3, action: 'Plan the week' },
		'utm-link-builder': { icon: Link2, action: 'Build the link' }
	} satisfies Record<MarketingToolSlug, { icon: typeof FileText; action: string }>;

	const visibleTools = $derived(
		slugs
			.map((slug) => tools.find((tool) => tool.slug === slug))
			.filter((tool): tool is MarketingTool => Boolean(tool))
	);
</script>

<div class="utility-grid">
	{#each visibleTools as tool (tool.slug)}
		{@const detail = details[tool.slug]}
		{@const Icon = detail.icon}
		<a
			href={resolve(`/tools/${tool.slug}`)}
			class="utility-link focus-ring group"
			data-tool={tool.slug}
		>
			<span class="utility-icon"><Icon aria-hidden="true" /></span>
			<span>
				<strong>{tool.name}</strong>
				<span class="utility-description">{tool.description}</span>
			</span>
			<span class="utility-action">
				{detail.action}
				<ArrowRight aria-hidden="true" />
			</span>
		</a>
	{/each}
</div>

<style>
	.utility-grid {
		display: grid;
		gap: 1px;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--border);
	}

	.utility-link {
		display: flex;
		min-height: 12rem;
		flex-direction: column;
		align-items: flex-start;
		padding: 1.25rem;
		background: var(--background);
		color: var(--foreground);
		transition: background-color 160ms ease;
	}

	.utility-link:hover {
		background: color-mix(in oklch, var(--primary) 6%, var(--background));
	}

	.utility-link:focus-visible {
		position: relative;
		z-index: 1;
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	.utility-icon {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.7rem;
		background: color-mix(in oklch, var(--primary) 11%, transparent);
		color: var(--primary);
	}

	.utility-icon :global(svg) {
		width: 1.05rem;
		height: 1.05rem;
	}

	.utility-link strong,
	.utility-description {
		display: block;
	}

	.utility-link strong {
		margin-top: 1rem;
		font-size: 1rem;
		font-weight: 650;
		letter-spacing: -0.015em;
	}

	.utility-description {
		margin-top: 0.45rem;
		color: var(--muted-foreground);
		font-size: 0.84rem;
		line-height: 1.55;
	}

	.utility-action {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: auto;
		padding-top: 1.25rem;
		color: var(--primary);
		font-size: 0.82rem;
		font-weight: 650;
	}

	.utility-action :global(svg) {
		width: 0.95rem;
		height: 0.95rem;
		transition: transform 180ms ease;
	}

	.utility-link:hover .utility-action :global(svg),
	.utility-link:focus-visible .utility-action :global(svg) {
		transform: translateX(0.2rem);
	}

	@media (min-width: 40rem) {
		.utility-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.utility-link:nth-child(odd):last-child {
			grid-column: 1 / -1;
		}
	}

	@media (min-width: 64rem) {
		.utility-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.utility-link[data-tool='post-preview-generator'],
		.utility-link[data-tool='utm-link-builder'] {
			grid-column: span 2;
		}

		.utility-link:nth-child(odd):last-child {
			grid-column: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.utility-link,
		.utility-action :global(svg) {
			transition: none;
		}

		.utility-link:hover .utility-action :global(svg),
		.utility-link:focus-visible .utility-action :global(svg) {
			transform: none;
		}
	}
</style>
