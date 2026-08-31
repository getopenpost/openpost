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
			name: 'Maya Ribeiro',
			role: 'Founder, tiny SaaS',
			avatar: '/assets/testimonial-portraits/maya-ribeiro.webp',
			platform: 'linkedin',
			content:
				'I used to write one update for LinkedIn, then rewrite it for X and Instagram, and half the time the third version never happened. Now I write it once, tune each version side by side, and everything ships the same morning. Our last announcement went out on four platforms before 9am. That has literally never happened here before.'
		},
		{
			id: 'week',
			name: 'Jonas Keller',
			role: 'Furniture maker',
			platform: 'instagram',
			content:
				'Sunday night, forty minutes, the whole week is scheduled. I stopped missing days completely.'
		},
		{
			id: 'formats',
			name: 'Jordan Ellis',
			role: 'Product marketing lead',
			avatar: '/assets/testimonial-portraits/jordan-ellis.webp',
			platform: 'youtube',
			content:
				'We record one launch video and cut it into a Short, a Reel, and a clip for X without leaving the app. The built-in editor replaced a second subscription we were only using twice a month.'
		},
		{
			id: 'community',
			name: 'Amara Osei',
			role: 'Community lead',
			platform: 'mastodon',
			content:
				'Replies used to rot in open tabs. Now they sit right next to the post and the account they came from, so I answer while I still remember the context.'
		},
		{
			id: 'workspace',
			name: 'Priya Nair',
			role: 'Agency owner',
			avatar: '/assets/testimonial-portraits/priya-nair.webp',
			platform: 'tiktok',
			content:
				'Three clients, eleven accounts, one calendar. Drafts wait for approval inside the workspace instead of getting lost in WhatsApp threads. I got my Fridays back.'
		},
		{
			id: 'results',
			name: 'Tomás Aguilar',
			role: 'Solo founder',
			platform: 'x',
			content:
				'The activity view shows me which account failed and the actual error. I fix that one destination and retry it. No more republishing everything and hoping nothing doubles up.'
		},
		{
			id: 'media',
			name: 'Lena Fischer',
			role: 'Social media manager',
			platform: 'facebook',
			content:
				'Captions, alt text, last month’s approved images. All in the library, ready to drop into the next post. I don’t dig through old folders at 11pm anymore.'
		},
		{
			id: 'threads',
			name: 'Owen Hartley',
			role: 'Writer',
			platform: 'threads',
			content:
				'I write long. The splitter breaks a piece into a thread that actually fits, and I read every reply before anything goes live.'
		},
		{
			id: 'automation',
			name: 'Sana Qureshi',
			role: 'Developer',
			platform: 'discord',
			content:
				'Our release bot drafts posts through the API with its own scoped token. It never touches our social passwords, and I can revoke just the token. This is the setup I always wanted and could never find.'
		}
	] as const;

	let expanded = $state(false);
	const clampClasses = [
		'line-clamp-4',
		'line-clamp-2',
		'line-clamp-3',
		'line-clamp-3',
		'line-clamp-4',
		'line-clamp-4',
		'line-clamp-3',
		'line-clamp-2',
		'line-clamp-4'
	];
</script>

<section class="stories" aria-labelledby="stories-title">
	<div class="marketing-shell">
		<header class="stories-heading">
			<p class="section-label">Fictional examples</p>
			<h2 id="stories-title">How people put OpenPost to work.</h2>
			<p>
				Fictional stories showing how launches, weekly planning, media, replies, and results can
				stay in one workspace. They illustrate typical use and are not quotes from customers.
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
