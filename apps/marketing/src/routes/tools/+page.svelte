<script lang="ts">
	import { ArrowRight, Search, ShieldCheck } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import HeroAccent from '../_components/HeroAccent.svelte';
	import ToolThumbnail from './ToolThumbnail.svelte';
	import { tools, getToolCategory } from '../_marketing';

	const categories = [
		'All tools',
		'Images',
		'Video',
		'Previews',
		'Convert',
		'Writing & planning'
	] as const;
	type Category = (typeof categories)[number];
	let category = $state<Category>('All tools');
	let query = $state('');
	const summaries = new Map([
		['background-remover', 'Erase the background and download a transparent PNG.'],
		['image-color-picker', 'Pick a color, copy its code, or extract a palette.'],
		['paste-image', 'Paste an image from your clipboard and download it as a file.'],
		['logo-maker', 'Choose an icon and colors. Download your logo as PNG or SVG.'],
		['quick-cut', 'Trim and join compatible video segments without re-encoding.'],
		['image-converter', 'Convert PNG, JPEG, and WebP images at their original size.']
	]);
	const featured = [
		'social-media-image-editor',
		'social-media-video-editor',
		'post-preview-generator'
	];
	const directoryTools = [...tools].sort(
		(a, b) => Number(featured.includes(b.slug)) - Number(featured.includes(a.slug))
	);
	const filtered = $derived(
		directoryTools.filter(
			(tool) =>
				(category === 'All tools' || getToolCategory(tool.slug) === category) &&
				`${tool.name} ${tool.slug.replaceAll('-', ' ')} ${tool.description} ${summaries.get(tool.slug) ?? ''}`
					.toLowerCase()
					.includes(query.trim().toLowerCase())
		)
	);
</script>

<section class="tools-directory marketing-shell" aria-labelledby="tools-title">
	<header>
		<h1 id="tools-title">Free tools.<br /><HeroAccent>Ready when you are.</HeroAccent></h1>
		<p class="intro">
			Remove a background, pick a color, convert a file, or make your next post. Open a tool and get
			straight to work.
		</p>
		<p class="privacy">
			<ShieldCheck size={18} aria-hidden="true" /> No account required. Image tools run on your device,
			with no watermark or paid download.
		</p>
	</header>
	<div class="directory-controls">
		<div class="search-field">
			<Search size={18} aria-hidden="true" /><Input
				aria-label="Search free tools"
				type="search"
				bind:value={query}
				placeholder="Search tools, formats, or tasks"
			/>
		</div>
		<div class="categories" role="group" aria-label="Filter tools by category">
			{#each categories as item (item)}
				<Button
					variant={category === item ? 'secondary' : 'ghost'}
					aria-pressed={category === item}
					onclick={() => (category = item)}>{item}</Button
				>
			{/each}
		</div>
	</div>
	<p class="result-count" role="status">
		{filtered.length}
		{filtered.length === 1 ? 'tool' : 'tools'}
	</p>
	{#each categories.slice(1) as group (group)}
		{@const entries = filtered.filter((tool) => getToolCategory(tool.slug) === group)}
		{#if entries.length}
			<section class="tool-group" aria-label={group}>
				<h2>{group === 'Convert' ? 'Image converters' : group}</h2>
				<div class="tool-grid" class:illustrated={group === 'Images' || group === 'Video'}>
					{#each entries as tool (tool.slug)}
						<a class="tool-card focus-ring" href={`/tools/${tool.slug}`}>
							<div class="tool-visual"><ToolThumbnail slug={tool.slug} /></div>
							<div class="tool-copy">
								<h3>{tool.name}</h3>
								<p>
									{summaries.get(tool.slug) ??
										(group === 'Convert'
											? 'Change formats without resizing your image.'
											: tool.description)}
								</p>
							</div>
							<ArrowRight class="tool-arrow" size={18} aria-hidden="true" />
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
	{#if !filtered.length}
		<div class="empty">
			<h2>No tools match that search.</h2>
			<p>Try a format such as PNG, or choose another category.</p>
			<Button
				variant="outline"
				onclick={() => {
					query = '';
					category = 'All tools';
				}}>Show all tools</Button
			>
		</div>
	{/if}
</section>

<style>
	.tools-directory {
		padding-block: 48px 80px;
	}
	header {
		max-width: 800px;
		padding-bottom: 36px;
	}
	h1 {
		font-size: clamp(2.5rem, 5vw, 4rem);
		line-height: 1.08;
		letter-spacing: -0.035em;
		font-weight: 600;
	}
	.intro {
		margin-top: 24px;
		max-width: 62ch;
		color: var(--muted-foreground);
		font-size: 18px;
		line-height: 1.6;
	}
	.privacy {
		display: flex;
		align-items: start;
		gap: 8px;
		margin-top: 20px;
		color: var(--muted-foreground);
		font-size: 14px;
		line-height: 1.6;
	}
	.privacy :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.directory-controls {
		border-block: 1px solid var(--border);
		padding-block: 20px;
		display: grid;
		gap: 16px;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: 520px;
	}
	.search-field :global(svg) {
		flex-shrink: 0;
		color: var(--muted-foreground);
	}
	.categories {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.result-count {
		margin-block: 16px 28px;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.tool-group {
		margin-bottom: 48px;
	}
	.tool-group > h2 {
		font-size: 23px;
		letter-spacing: -0.02em;
		font-weight: 600;
		margin-bottom: 20px;
	}
	.tool-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
		gap: 16px;
	}
	.tool-card {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		align-content: start;
		align-items: start;
		gap: 16px;
		position: relative;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--background);
	}
	.tool-card:hover {
		background: var(--marketing-section);
		border-color: var(--muted-foreground);
	}
	.tool-visual {
		height: 72px;
		overflow: hidden;
		border-radius: 8px;
	}
	.tool-copy {
		min-width: 0;
	}
	.tool-card h3 {
		font-size: 17px;
		font-weight: 600;
		line-height: 1.35;
		text-wrap: pretty;
	}
	.tool-card p {
		margin-top: 6px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.tool-card :global(.tool-arrow) {
		display: none;
	}
	.illustrated .tool-card {
		display: flex;
		flex-direction: column;
		padding: 0;
		gap: 0;
	}
	.illustrated .tool-visual {
		width: 100%;
		height: 176px;
		border-radius: 11px 11px 0 0;
	}
	.illustrated .tool-copy {
		padding: 20px 44px 20px 20px;
	}
	.illustrated :global(.tool-arrow) {
		display: block;
		position: absolute;
		right: 20px;
		top: 198px;
	}
	@media (min-width: 1000px) {
		.tool-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 599px) {
		.tool-grid {
			grid-template-columns: 1fr;
			gap: 12px;
		}
		.tool-card,
		.illustrated .tool-card {
			display: grid;
			grid-template-columns: 64px minmax(0, 1fr);
			padding: 16px;
			gap: 12px;
		}
		.tool-visual,
		.illustrated .tool-visual {
			height: 64px;
			width: 64px;
			border-radius: 6px;
		}
		.illustrated .tool-copy {
			padding: 0;
		}
		.illustrated :global(.tool-arrow) {
			display: none;
		}
		.tool-card h3 {
			font-size: 16px;
		}
	}
	.empty {
		padding-block: 32px;
	}
	.empty h2 {
		font-size: 22px;
		font-weight: 600;
	}
	.empty p {
		margin-block: 12px 24px;
		color: var(--muted-foreground);
	}
	@media (max-width: 389px) {
		h1 {
			font-size: 2.25rem;
		}
	}
	@media (max-width: 340px) {
		h1 {
			font-size: 1.9rem;
		}
	}
</style>
