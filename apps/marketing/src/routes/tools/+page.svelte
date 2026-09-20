<script lang="ts">
	import { ArrowRight, Search, ShieldCheck } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import HeroAccent from '../_components/HeroAccent.svelte';
	import { tools, getToolCategory } from '../_marketing';

	const categories = ['All tools', 'Images', 'Video', 'Convert', 'Writing & planning'] as const;
	type Category = (typeof categories)[number];
	let category = $state<Category>('All tools');
	let query = $state('');
	const filtered = $derived(
		tools.filter(
			(tool) =>
				(category === 'All tools' || getToolCategory(tool.slug) === category) &&
				`${tool.name} ${tool.slug.replaceAll('-', ' ')} ${tool.description}`
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
		<div class="categories" aria-label="Filter tools by category">
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
				<div class="tool-list">
					{#each entries as tool (tool.slug)}
						<a class="tool-row focus-ring" href={`/tools/${tool.slug}`}>
							<span
								><h3>{tool.name}</h3>
								<p>{tool.description}</p></span
							><ArrowRight size={20} aria-hidden="true" />
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
		display: grid;
		gap: 12px;
		margin-bottom: 44px;
	}
	.tool-group > h2 {
		font-size: 23px;
		letter-spacing: -0.02em;
		font-weight: 600;
		padding-top: 16px;
	}
	.tool-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		border-bottom: 1px solid var(--border);
		padding: 20px 12px;
		border-radius: 4px;
	}
	.tool-row:hover {
		background: var(--marketing-section);
	}
	.tool-row h3 {
		font-size: 17px;
		font-weight: 600;
	}
	.tool-row p {
		max-width: 68ch;
		margin-top: 6px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.tool-row :global(svg) {
		flex-shrink: 0;
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
	@media (min-width: 768px) {
		.tool-group {
			grid-template-columns: minmax(160px, 0.3fr) minmax(0, 1fr);
			gap: 32px;
		}
	}
	@media (max-width: 389px) {
		h1 {
			font-size: 2.25rem;
		}
		.tool-row {
			padding-inline: 0;
			gap: 12px;
		}
	}
</style>
