<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import PostizSocialLogo from './PostizSocialLogo.svelte';
	const platforms = ['bluesky', 'linkedin', 'instagram', 'youtube', 'mastodon'] as const;
</script>

<section class="resources marketing-shell" aria-labelledby="resources-title">
	<h2 id="resources-title">A few useful starting points.</h2>
	<div class="resource-grid">
		<a href="/tools" class="tools focus-ring">
			<div class="card-heading">
				<h3>Free tools</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>Edit media, split a thread, or check a post before you send it.</p>
			<div class="tool-art" aria-hidden="true">
				<img
					src="/assets/brand/features/image-editor.svg"
					alt=""
					width="112"
					height="112"
					loading="lazy"
				/>
				<img
					src="/assets/brand/features/video-editor.svg"
					alt=""
					width="112"
					height="112"
					loading="lazy"
				/>
				<img
					src="/assets/brand/features/compose.svg"
					alt=""
					width="112"
					height="112"
					loading="lazy"
				/>
			</div>
		</a>
		<a href="/guides" class="guides focus-ring">
			<div class="card-heading">
				<h3>Publishing guides</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>Practical answers for scheduling, editing, and sharing your work.</p>
			<div class="guide-art" aria-hidden="true">
				<span>Write</span><span>Edit</span><span>Publish</span>
			</div>
		</a>
		<a href="/developers" class="developers focus-ring">
			<div class="card-heading">
				<h3>Connect your tools</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>Work through the API, CLI, MCP, or n8n.</p>
			<div class="developer-art" aria-hidden="true">
				<span>API</span><span>CLI</span><span>MCP</span>
			</div>
		</a>
		<a href="/platforms" class="platforms focus-ring">
			<div class="card-heading">
				<h3>Know your channels</h3>
				<ArrowUpRight size={24} />
			</div>
			<p>Formats, limits, and setup for each platform.</p>
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
	a {
		display: block;
		border-radius: 14px;
		padding: 28px;
		overflow: hidden;
		min-width: 0;
	}
	.tools {
		grid-row: span 2;
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.guides {
		grid-column: span 2;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.developers {
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.platforms {
		background: var(--marketing-section);
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
	.tool-art {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: center;
		gap: 16px;
		margin: 42px 0 4px;
	}
	.tool-art img {
		width: 100%;
		height: auto;
		max-width: 128px;
	}
	.tool-art img:last-child {
		margin-left: 65%;
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
		a {
			padding: 24px;
		}
		.tool-art {
			display: flex;
			gap: 16px;
			margin-top: 28px;
		}
		.tool-art img {
			width: calc((100% - 32px) / 3);
		}
		.tool-art img:last-child {
			margin: 0;
		}
	}
</style>
