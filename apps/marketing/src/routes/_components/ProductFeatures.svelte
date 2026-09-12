<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ThemeImage from './ThemeImage.svelte';
	const features = [
		{
			title: 'Your media library',
			icon: '/assets/brand/features/media.svg',
			text: 'Keep templates, brand assets, and fonts ready to reuse. Find files with tags, collections, and favorites. Draft alt text with AI.',
			href: 'https://docs.openpo.st/guides/media',
			link: 'Organize your media'
		},
		{
			title: 'Grow your network',
			icon: '/assets/brand/features/grow.svg',
			text: 'Find people to follow on Bluesky and Mastodon. Review recommendations and mutual connections, then choose who to follow.',
			href: 'https://docs.openpo.st/guides/results',
			link: 'Explore Grow'
		},
		{
			title: 'Auto repost',
			icon: '/assets/brand/features/repost.svg',
			text: 'Give a post another turn. Set delays and engagement rules, with overrides for individual posts.',
			href: 'https://docs.openpo.st/guides/scheduling',
			link: 'Set repost rules'
		},
		{
			title: 'Inbox and DMs',
			icon: '/assets/brand/features/inbox.svg',
			text: 'Follow conversations and reply to comments and messages from supported connected accounts.',
			href: 'https://docs.openpo.st/guides/results',
			link: 'See inbox support'
		},
		{
			title: 'Connect your tools',
			icon: '/assets/brand/features/automation.svg',
			text: 'Bring OpenPost into the tools you already use. Draft with your AI assistant or connect a workflow in n8n.',
			href: 'https://docs.openpo.st/guides/automation',
			link: 'Connect your tools'
		},
		{
			title: 'Teams and security',
			icon: '/assets/brand/features/workspaces.svg',
			text: 'Separate workspaces and member roles. Sign in with passkeys or two-factor authentication and manage active sessions.',
			href: 'https://docs.openpo.st/guides/workspaces',
			link: 'Explore account security'
		}
	];
</script>

<section id="features" class="product-features marketing-shell" aria-labelledby="features-title">
	<div class="section-heading">
		<h2 id="features-title">From the first idea<br />to the next conversation.</h2>
		<p>Write, schedule, publish, and follow up.<br />Keep it all in one workspace.</p>
	</div>
	<article class="schedule feature-panel">
		<div class="copy">
			<h3 class="feature-heading">
				<img
					src="/assets/brand/features/calendar.svg"
					alt=""
					width="44"
					height="44"
					loading="lazy"
				/><span>A posting rhythm<br />you can keep.</span>
			</h3>
			<p>
				Pick a time or use your next free posting slot. Plan the week in your calendar, stagger
				channels, and get a reminder when the queue runs low.
			</p>
			<a class="focus-ring" href="https://docs.openpo.st/guides/scheduling"
				>Plan your publishing <ArrowUpRight size={17} /></a
			>
		</div>
		<div class="visual mint">
			<ThemeImage
				lightSrc="/assets/screenshots/calendar-detail-light.webp"
				darkSrc="/assets/screenshots/calendar-detail-dark.webp"
				alt="OpenPost calendar showing scheduled publications across channels"
				width={2272}
				height={1600}
				loading="lazy"
			/>
		</div>
	</article>
	<div class="feature-pair">
		<article class="feature-panel ai">
			<div class="copy">
				<h3 class="feature-heading">
					<img
						src="/assets/brand/features/ideas.svg"
						alt=""
						width="44"
						height="44"
						loading="lazy"
					/><span>Start with an idea.<br />Or find one with Ideate.</span>
				</h3>
				<p>
					Explore ideas and compare directions. Use Social Sets to choose an account group, build
					drafts for each channel, and review every version.
				</p>
				<a class="focus-ring" href="https://docs.openpo.st/guides/publishing#build-with-ai"
					>Explore AI writing <ArrowUpRight size={17} /></a
				>
			</div>
			<ol class="idea-steps" aria-label="Build with AI">
				<li>
					<span>01</span>
					<div>
						<strong>Find your idea</strong><small>Start from a brief or a blank page.</small>
					</div>
				</li>
				<li>
					<span>02</span>
					<div>
						<strong>Choose a direction</strong><small>Compare five ways to tell the story.</small>
					</div>
				</li>
				<li>
					<span>03</span>
					<div>
						<strong>Make each channel fit</strong><small
							>Review the drafts, then make them yours.</small
						>
					</div>
				</li>
			</ol>
		</article>
		<article class="feature-panel memes">
			<div class="copy">
				<h3 class="feature-heading">
					<img
						src="/assets/brand/features/memes.svg"
						alt=""
						width="44"
						height="44"
						loading="lazy"
					/><span>Sometimes a meme<br />says it better.</span>
				</h3>
				<p>
					Pick a template, write the captions, and swap in your images. Save the result to Media or
					attach it to your post.
				</p>
				<a class="focus-ring" href="https://docs.openpo.st/guides/media#add-media-to-a-post"
					>Make a meme <ArrowUpRight size={17} /></a
				>
			</div>
			<div class="visual lilac">
				<ThemeImage
					lightSrc="/assets/screenshots/meme-creator-detail-light.webp"
					darkSrc="/assets/screenshots/meme-creator-detail-dark.webp"
					alt="OpenPost meme creator with editable captions and a rendered Drakeposting preview"
					width={2764}
					height={1920}
					loading="lazy"
				/>
			</div>
		</article>
	</div>
	<article class="analytics feature-panel">
		<div class="copy">
			<h3 class="feature-heading">
				<img
					src="/assets/brand/features/analytics.svg"
					alt=""
					width="44"
					height="44"
					loading="lazy"
				/><span>See what people respond to.</span>
			</h3>
			<p>
				Follow views, reach, engagement, and audience changes. Compare posts using the metrics your
				connected platforms provide, then repurpose a post into a fresh draft.
			</p>
			<a class="focus-ring" href="https://docs.openpo.st/guides/results"
				>Explore analytics <ArrowUpRight size={17} /></a
			>
		</div>
		<div class="visual blue">
			<ThemeImage
				lightSrc="/assets/screenshots/analytics-detail-light.webp"
				darkSrc="/assets/screenshots/analytics-detail-dark.webp"
				alt="Daily views chart in OpenPost analytics"
				width={2108}
				height={578}
				loading="lazy"
			/>
		</div>
	</article>
	<div class="more-features">
		{#each features as feature (feature.title)}
			<article>
				<h3 class="feature-heading">
					<img src={feature.icon} alt="" width="36" height="36" loading="lazy" /><span
						>{feature.title}</span
					>
				</h3>
				<p>{feature.text}</p>
				<a class="focus-ring" href={feature.href}>{feature.link} <ArrowUpRight size={16} /></a>
			</article>
		{/each}
	</div>
</section>

<style>
	.product-features {
		padding-block: 72px 24px;
		scroll-margin-top: 4rem;
	}
	.section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 32px;
		margin-bottom: 36px;
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		line-height: 1.12;
		letter-spacing: -0.035em;
	}
	h3 {
		font-size: clamp(25px, 2.5vw, 34px);
		font-weight: 550;
		line-height: 1.18;
		letter-spacing: -0.025em;
	}
	p {
		color: var(--muted-foreground);
		font-size: 16px;
		line-height: 1.65;
		max-width: 52ch;
	}
	.copy p {
		margin-top: 16px;
	}
	.feature-heading {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.feature-heading img {
		flex: none;
	}
	.feature-heading span {
		min-width: 0;
	}
	.feature-panel {
		overflow: hidden;
		border-radius: 16px;
		background: var(--card);
		background-image: var(--marketing-dither-pattern);
		background-size: 32px 32px;
	}
	.copy {
		padding: 32px;
	}
	a {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font-size: 14px;
		text-decoration: underline;
		text-underline-offset: 5px;
		border-radius: 4px;
		margin-top: 12px;
	}
	.schedule,
	.analytics {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
		align-items: center;
		gap: 12px;
	}
	.visual {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(20px, 3vw, 40px);
		margin: 12px;
		border-radius: 12px;
	}
	.visual :global(img) {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 8px;
	}
	.mint {
		background: var(--marketing-mint);
	}
	.lilac {
		background: var(--marketing-lilac);
	}
	.blue {
		background: var(--marketing-blue);
	}
	.feature-pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
		margin-block: 24px;
	}
	.feature-pair article {
		display: flex;
		flex-direction: column;
	}
	.memes .visual {
		margin-top: auto;
	}
	.idea-steps {
		list-style: none;
		display: grid;
		gap: 12px;
		margin: 32px 32px 32px;
		padding: 16px 0 0;
	}
	.idea-steps li {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 18px;
		background: var(--marketing-lilac);
		border-radius: 10px;
	}
	.idea-steps li > span {
		font-size: 12px;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	.idea-steps strong {
		display: block;
		font-size: 15px;
		font-weight: 550;
	}
	.idea-steps small {
		display: block;
		font-size: 13px;
		line-height: 1.5;
		margin-top: 3px;
		color: var(--foreground);
	}
	.more-features {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 32px;
		margin-top: 48px;
	}
	.more-features article {
		display: flex;
		flex-direction: column;
		align-items: start;
	}
	.more-features h3 {
		font-size: 20px;
		margin-block: 0 12px;
	}
	.more-features p {
		font-size: 14px;
		flex: 1;
	}
	@media (max-width: 960px) {
		.more-features {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 760px) {
		.product-features {
			padding-block: 48px 0;
		}
		.section-heading {
			display: grid;
			gap: 20px;
		}
		.schedule,
		.analytics,
		.feature-pair {
			grid-template-columns: minmax(0, 1fr);
		}
		.copy {
			padding: 24px;
		}
		.visual {
			padding: 20px;
		}
		.idea-steps {
			margin: 0 24px 24px;
		}
	}
	@media (max-width: 480px) {
		.more-features {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
	}
</style>
