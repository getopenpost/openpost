<script lang="ts">
	import { ditherSurface } from '@openpost/dither';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import PostizSocialLogo from './PostizSocialLogo.svelte';
	import { tools } from '../_marketing';
	const featuredTools = [
		'social-media-image-editor',
		'social-media-video-editor',
		'thread-splitter',
		'multi-platform-character-counter'
	].map((slug) => tools.find((tool) => tool.slug === slug)!);
	const platforms = ['bluesky', 'linkedin', 'instagram', 'youtube', 'mastodon'] as const;
</script>

<section class="resources marketing-shell" aria-labelledby="resources-title">
	<h2 id="resources-title">A few useful starting points.</h2>
	<div class="resource-grid">
		<div data-dither-panel use:ditherSurface class="tools">
			<a href="/tools" class="card-heading tool-heading focus-ring">
				<h3>Free tools</h3>
				<ArrowUpRight size={24} />
			</a>
			<p>Edit media, split a thread, or check a post before you send it.</p>
			<ul class="tool-list">
				{#each featuredTools as tool (tool.slug)}
					<li><a class="focus-ring" href={`/tools/${tool.slug}`}>{tool.name}</a></li>
				{/each}
			</ul>
		</div>
		<a data-dither-panel use:ditherSurface href="/guides" class="guides focus-ring">
			<div class="card-heading">
				<h3>Publishing guides</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>Practical answers for scheduling, editing, and sharing your work.</p>
			<div class="guide-art" aria-hidden="true">
				<span>Write</span><span>Edit</span><span>Publish</span>
			</div>
		</a>
		<a
			data-dither-panel
			use:ditherSurface
			href="https://openpo.st/docs/guides/quickstart"
			class="developers focus-ring"
			data-sveltekit-reload
		>
			<div class="card-heading">
				<h3>A little help</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>From your first draft to your next video. Find a guide when you need one.</p>
			<div class="developer-art" aria-hidden="true">
				<span>Ideas</span><span>How-tos</span><span>Answers</span>
			</div>
		</a>
		<a data-dither-panel use:ditherSurface href="/platforms" class="platforms focus-ring">
			<div class="card-heading">
				<h3>Know your channels</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>Ideas, formats, and posting options for your business.</p>
			<div class="platform-art" aria-hidden="true">
				{#each platforms as platform (platform)}<PostizSocialLogo {platform} />{/each}
			</div>
		</a>
	</div>
</section>

<style>
	.resources {
		padding-block: 72px;
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		line-height: 1.12;
		letter-spacing: -0.035em;
		margin-bottom: 36px;
	}
	.resource-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 20px;
	}
	.resource-grid > a,
	.tools {
		display: block;
		border-radius: 14px;
		padding: 28px;
		overflow: hidden;
		min-width: 0;
	}
	.tools {
		grid-row: span 2;
		background-color: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.guides {
		grid-column: span 2;
		background-color: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.developers {
		background-color: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.platforms {
		background-color: var(--marketing-section);
		color: var(--foreground);
	}
	.card-heading {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 16px;
	}
	.card-heading :global(svg) {
		flex-shrink: 0;
	}
	h3 {
		font-size: 24px;
		letter-spacing: -0.025em;
		font-weight: 550;
		line-height: 1.2;
	}
	p {
		margin-top: 12px;
		line-height: 1.65;
		font-size: 15px;
		max-width: 48ch;
	}
	.tool-heading {
		color: inherit;
	}
	.tool-list {
		margin-top: 32px;
		list-style: none;
		padding: 0;
	}
	.tool-list li + li {
		border-top: 1px solid color-mix(in oklch, currentColor 18%, transparent);
	}
	.tool-list a {
		display: flex;
		align-items: center;
		min-height: 52px;
		padding-block: 12px;
		font-size: 17px;
		font-weight: 500;
		line-height: 1.4;
		color: inherit;
	}
	.tool-list a:hover {
		text-decoration: underline;
		text-underline-offset: 4px;
	}

	.guide-art {
		display: flex;
		gap: 16px;
		margin-top: 28px;
		flex-wrap: wrap;
		font-size: clamp(26px, 3vw, 40px);
		font-weight: 550;
		letter-spacing: -0.03em;
	}
	.guide-art span {
		white-space: nowrap;
	}
	.guide-art span + span::before {
		content: '/';
		margin-right: 16px;
		opacity: 0.5;
	}
	.developer-art {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		font-size: 25px;
		font-weight: 550;
		margin-top: 32px;
	}
	.platform-art {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
		margin-top: 32px;
	}
	.platform-art :global(img) {
		width: 30px;
		height: 30px;
	}
	a:hover h3 {
		text-decoration: underline;
		text-underline-offset: 5px;
	}
	@media (max-width: 760px) {
		.resources {
			padding-block: 48px;
		}
		.resource-grid {
			grid-template-columns: minmax(0, 1fr);
			gap: 16px;
		}
		.tools,
		.guides {
			grid-row: auto;
			grid-column: auto;
		}
		.resource-grid > a,
		.tools {
			padding: 24px;
		}
	}
</style>
