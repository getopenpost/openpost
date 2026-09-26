<script lang="ts">
	import {
		ArrowRight,
		AtSign,
		CalendarClock,
		ClipboardPaste,
		FileImage,
		Flower2,
		LetterText,
		Link,
		MessageSquareText,
		Scissors,
		Split,
		Type,
		WandSparkles
	} from '@lucide/svelte';
	import { previewTools, imageConversions, imageFormats } from '@openpost/social-images';
	import { PlatformGlyph } from '@openpost/social-preview';
	import ThemeImage from '../_components/ThemeImage.svelte';
	import type { MarketingToolSlug } from '../_marketing';

	let { slug }: { slug: MarketingToolSlug } = $props();
	const platform = $derived(previewTools.find((tool) => tool.slug === slug)?.platform);
	const conversion = $derived(imageConversions.find((tool) => tool.slug === slug));
	const inputFormat = $derived(
		imageFormats.find((format) => format.id === conversion?.input)?.name
	);
	const outputFormat = $derived(
		imageFormats.find((format) => format.id === conversion?.output)?.name
	);
	const editor = $derived(
		slug === 'social-media-image-editor'
			? 'image-editor'
			: slug === 'social-media-video-editor'
				? 'video-editor'
				: undefined
	);
	const icons = new Map([
		['background-remover', WandSparkles],
		['paste-image', ClipboardPaste],
		['image-converter', FileImage],
		['multi-platform-character-counter', LetterText],
		['thread-splitter', Split],
		['fediverse-handle-checker', AtSign],
		['linkedin-text-formatter', Type],
		['best-time-to-post-calculator', CalendarClock],
		['utm-link-builder', Link]
	]);
	const Icon = $derived(icons.get(slug) ?? MessageSquareText);
</script>

<div
	class="thumbnail"
	class:screenshot={editor}
	class:checkerboard={slug === 'background-remover'}
	class:mint={slug === 'image-color-picker' || slug === 'logo-maker'}
	class:blue={slug === 'quick-cut'}
	aria-hidden="true"
>
	{#if editor}
		<ThemeImage
			lightSrc={`/assets/screenshots/${editor}-light.webp`}
			darkSrc={`/assets/screenshots/${editor}-dark.webp`}
			alt=""
			width={2880}
			height={1920}
		/>
	{:else if platform}
		<PlatformGlyph {platform} />
	{:else if conversion}
		<span class="formats">{inputFormat}<ArrowRight size={16} />{outputFormat}</span>
	{:else if slug === 'image-color-picker'}
		<div class="palette">
			<img
				src="/assets/marketing/studio-cup.webp"
				alt=""
				width="1536"
				height="1024"
				loading="lazy"
				decoding="async"
			/>
			<div class="swatches"><i></i><i></i><i></i><i></i></div>
		</div>
	{:else if slug === 'logo-maker'}
		<div class="logo-example"><Flower2 /><span>Bloom</span></div>
	{:else if slug === 'quick-cut'}
		<div class="cut-example">
			<Scissors />
			<div><span></span><span></span><span></span></div>
		</div>
	{:else if slug === 'post-preview-generator'}
		<div class="networks">
			<PlatformGlyph platform="x" /><PlatformGlyph platform="instagram" /><PlatformGlyph
				platform="linkedin"
			/>
		</div>
	{:else}
		<Icon strokeWidth={1.5} />
	{/if}
</div>

<style>
	.thumbnail {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--marketing-section);
		color: var(--foreground);
	}
	.thumbnail > :global(svg) {
		width: 42%;
		height: 42%;
		max-width: 52px;
		max-height: 52px;
	}
	.screenshot {
		background: var(--marketing-blue);
		padding: 16px 16px 0;
	}
	.screenshot :global(img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
		border-radius: 6px 6px 0 0;
	}
	.checkerboard {
		background-color: var(--background);
		background-image: conic-gradient(
			var(--marketing-section) 25%,
			transparent 0 50%,
			var(--marketing-section) 0 75%,
			transparent 0
		);
		background-size: 24px 24px;
	}
	.mint {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.blue {
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.formats {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		font-weight: 650;
	}
	.palette {
		width: 56%;
		max-width: 180px;
		border-radius: 6px;
		overflow: hidden;
	}
	.palette img {
		width: 100%;
		height: auto;
		aspect-ratio: 2;
		object-fit: cover;
	}
	.swatches {
		display: flex;
		height: 22px;
	}
	.swatches i {
		flex: 1;
		background: #e9c68d;
	}
	.swatches i:nth-child(2) {
		background: #a88057;
	}
	.swatches i:nth-child(3) {
		background: #f6ebd1;
	}
	.swatches i:nth-child(4) {
		background: #443d33;
	}
	.logo-example {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: clamp(14px, 2vw, 28px);
		font-weight: 600;
		letter-spacing: -0.025em;
	}
	.logo-example :global(svg) {
		width: 40px;
		height: 40px;
		stroke-width: 1.5;
	}
	.cut-example {
		width: 65%;
		max-width: 240px;
		display: grid;
		gap: 16px;
		justify-items: center;
	}
	.cut-example > :global(svg) {
		width: 28px;
		height: 28px;
	}
	.cut-example > div {
		display: flex;
		gap: 8px;
		width: 100%;
		height: 32px;
	}
	.cut-example span {
		width: 40%;
		border: 1px solid currentColor;
		border-radius: 4px;
		background: color-mix(in oklch, currentColor 12%, transparent);
	}
	.cut-example span:nth-child(2) {
		width: 20%;
		border-style: dashed;
		background: transparent;
	}
	.networks {
		display: flex;
		gap: 8px;
	}
	.networks :global(svg) {
		width: 20px;
		height: 20px;
	}
	@media (max-width: 599px) {
		.formats {
			flex-direction: column;
			gap: 0;
			font-size: 11px;
		}
		.formats :global(svg) {
			width: 12px;
			height: 12px;
			transform: rotate(90deg);
		}
		.screenshot {
			padding: 0;
		}
		.screenshot :global(img) {
			object-position: center;
			border-radius: 0;
		}
		.palette {
			width: 80%;
		}
		.swatches {
			height: 12px;
		}
		.logo-example {
			flex-direction: column;
			gap: 2px;
			font-size: 12px;
		}
		.logo-example :global(svg) {
			width: 28px;
			height: 28px;
		}
		.cut-example {
			gap: 8px;
		}
		.cut-example > div {
			height: 16px;
			gap: 3px;
		}
		.networks {
			flex-wrap: wrap;
			justify-content: center;
			max-width: 56px;
			gap: 6px;
		}
	}
</style>
