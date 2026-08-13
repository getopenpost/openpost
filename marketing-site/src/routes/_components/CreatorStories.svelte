<script lang="ts">
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { Button } from '$lib/components/ui/button';

	interface Story {
		id: string;
		name: string;
		role: string;
		avatar?: string;
		platform: string;
		content: string;
	}

	const stories: readonly Story[] = [
		{
			id: 'launch',
			name: 'Solo founder',
			role: 'Product launch',
			avatar: '/assets/testimonial-portraits/maya-ribeiro.webp',
			platform: 'linkedin',
			content:
				'Turn a product update into a LinkedIn post, an X thread, and a short video. Keep each version tied to the same launch.'
		},
		{
			id: 'week',
			name: 'Creator',
			role: 'Weekly planning',
			platform: 'instagram',
			content: 'Draft the week, pick each destination, and schedule every post from one calendar.'
		},
		{
			id: 'formats',
			name: 'Product team',
			role: 'Campaign production',
			avatar: '/assets/testimonial-portraits/jordan-ellis.webp',
			platform: 'youtube',
			content:
				'Keep the source idea beside the text, image, Story, short-video, and video versions it becomes.'
		},
		{
			id: 'community',
			name: 'Community lead',
			role: 'Replies and inbox',
			platform: 'mastodon',
			content: 'Read and answer conversations without losing the post or account behind them.'
		},
		{
			id: 'workspace',
			name: 'Small team',
			role: 'Shared workspace',
			avatar: '/assets/testimonial-portraits/priya-nair.webp',
			platform: 'tiktok',
			content:
				'Share drafts, media, schedules, and publishing status without passing files between tools.'
		},
		{
			id: 'results',
			name: 'Founder',
			role: 'Performance review',
			platform: 'x',
			content:
				'See what published, what failed, and what earned attention while the work is still fresh.'
		},
		{
			id: 'media',
			name: 'Social manager',
			role: 'Media library',
			platform: 'facebook',
			content:
				'Reuse approved images, video, captions, and alt text without hunting through old folders.'
		},
		{
			id: 'threads',
			name: 'Writer',
			role: 'Long-form ideas',
			platform: 'threads',
			content:
				'Split one longer idea into a clear thread, then review every reply before it goes live.'
		},
		{
			id: 'automation',
			name: 'Developer',
			role: 'API and automation',
			platform: 'discord',
			content:
				'Create drafts from scripts and AI tools while OpenPost keeps account access and publishing rules in one place.'
		}
	] as const;

	let expanded = $state(false);
	const clampClasses = [
		'line-clamp-3',
		'line-clamp-4',
		'line-clamp-3',
		'line-clamp-2',
		'line-clamp-4',
		'line-clamp-3',
		'line-clamp-3',
		'line-clamp-2',
		'line-clamp-4'
	];
</script>

<section class="stories" aria-labelledby="stories-title">
	<div class="marketing-shell">
		<header class="stories-heading">
			<p class="section-label">Illustrative workflows</p>
			<h2 id="stories-title">Built around common publishing work.</h2>
			<p>
				These fictional examples show how launches, weekly planning, media, replies, and results can
				stay in the same workspace.
			</p>
		</header>

		<div class="proof-wrap">
			<div class:proof-collapsed={!expanded} class="proof-cols">
				{#each stories as story, index (story.id)}
					<article class="proof-item">
						<header class="proof-head">
							<div class="proof-who">
								<span class="avatar">
									{#if story.avatar}
										<img src={story.avatar} alt="" />
									{:else}
										<span>{story.name.charAt(0)}</span>
									{/if}
								</span>
								<div class="proof-meta">
									<h3>{story.name}</h3>
									<p>{story.role}</p>
								</div>
							</div>
							<span class="proof-source" aria-label={`${story.platform} workflow`}>
								<PlatformIcon platform={story.platform} />
							</span>
						</header>
						<p class={`proof-copy ${expanded ? '' : clampClasses[index]}`}>
							{story.content}
						</p>
					</article>
				{/each}
			</div>

			{#if !expanded}
				<div class="proof-reveal">
					<Button variant="secondary" onclick={() => (expanded = true)}>Show more stories</Button>
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	.stories {
		padding-block: clamp(5rem, 9vw, 8.5rem);
		background: color-mix(in oklch, var(--muted) 38%, var(--background));
	}

	.stories-heading {
		display: flex;
		max-width: 44rem;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		margin: 0 auto clamp(2.5rem, 5vw, 4rem);
		text-align: center;
	}

	.stories-heading h2 {
		font-size: clamp(2.35rem, 4.5vw, 4rem);
		font-weight: 710;
		line-height: 1;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.stories-heading > p:last-child {
		max-width: 38rem;
		color: var(--muted-foreground);
		line-height: 1.7;
	}

	.proof-wrap {
		position: relative;
	}

	.proof-cols {
		columns: 1;
		column-gap: 1.25rem;
	}

	.proof-collapsed {
		max-height: 35rem;
		overflow: hidden;
	}

	.proof-item {
		break-inside: avoid;
		margin-bottom: 1.25rem;
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
		box-shadow: 0 1rem 2.8rem -2.3rem color-mix(in oklch, var(--foreground) 32%, transparent);
	}

	.proof-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.proof-who {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.75rem;
	}

	.avatar {
		display: grid;
		width: 2.4rem;
		height: 2.4rem;
		flex: none;
		overflow: hidden;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 0.8rem;
		font-weight: 700;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.proof-meta {
		min-width: 0;
		line-height: 1.25;
	}

	.proof-meta h3 {
		font-size: 0.88rem;
		font-weight: 650;
	}

	.proof-meta p {
		margin-top: 0.15rem;
		color: var(--muted-foreground);
		font-size: 0.78rem;
	}

	.proof-source {
		display: grid;
		width: 2rem;
		height: 2rem;
		flex: none;
		place-items: center;
		color: var(--muted-foreground);
	}

	.proof-source :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.proof-copy {
		margin-top: 1.25rem;
		color: color-mix(in oklch, var(--foreground) 72%, transparent);
		font-size: 0.96rem;
		line-height: 1.75;
	}

	.proof-reveal {
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		display: flex;
		align-items: end;
		justify-content: center;
		padding-block: 6rem 1.5rem;
		background: linear-gradient(
			to top,
			color-mix(in oklch, var(--muted) 38%, var(--background)),
			color-mix(in oklch, var(--background) 70%, transparent) 62%,
			transparent
		);
	}

	@media (min-width: 48rem) {
		.proof-cols {
			columns: 2;
		}
	}

	@media (min-width: 64rem) {
		.proof-cols {
			columns: 3;
		}

		.proof-collapsed {
			max-height: 27rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.proof-collapsed {
			max-height: none;
			overflow: visible;
		}

		.proof-reveal {
			display: none;
		}
	}
</style>
