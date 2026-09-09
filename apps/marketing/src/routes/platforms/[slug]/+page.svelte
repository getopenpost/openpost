<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import HeroAccent from '../../_components/HeroAccent.svelte';
	import ProductScreenshot from '../../_components/ProductScreenshot.svelte';
	import PlatformPreview from '../_components/PlatformPreview.svelte';
	import {
		getPlatform,
		managedSignupUrl,
		managedTrialNote,
		supportMailUrl
	} from '../../_marketing';
	import { getChannelStory } from '../_stories';

	const platform = $derived.by(() => {
		const found = getPlatform(page.params.slug ?? '');
		if (!found) error(404, 'Platform not found');
		return found;
	});
	const story = $derived(getChannelStory(platform.slug));
</script>

<div class="marketing-shell channel-page">
	<a href="/platforms" class="focus-ring text-link"><ArrowLeft size={16} /> All channels</a>
	{#if story}
		<section class="channel-hero" aria-labelledby="channel-title">
			<div>
				<h1 id="channel-title">{story.title}</h1>
				<p class="marketing-copy">{story.intro}</p>
				<Button href={managedSignupUrl} size="lg"
					>Start your free trial <ArrowRight data-icon="inline-end" /></Button
				>
				<p class="trial-note">{managedTrialNote}</p>
				<aside class="availability" aria-label={`${platform.name} availability`}>
					<p>
						{platform.managedCertificationState === 'no_current_claim'
							? `${platform.name} posting is awaiting final live checks.`
							: `Posting is verified for ${platform.certifiedOutputProfiles.join(', ')}. Available options still depend on your account.`}
						<a href={supportMailUrl}>Ask us about availability</a> before you rely on it.
					</p>
				</aside>
			</div>
			<figure class="channel-example" data-agent-exclude>
				<p class="example-label">{story.angle}</p>
				<PlatformPreview {platform} {story} />
				<figcaption>Example post. Yours starts with your business.</figcaption>
			</figure>
		</section>
		<section class="channel-story">
			<div class="story-copy">
				{#each story.sections as section (section.title)}
					<article>
						<h2>{section.title}</h2>
						<p>{section.text}</p>
					</article>
				{/each}
			</div>
			<figure class="story-product">
				<ProductScreenshot
					src={`/assets/screenshots/${story.visual}-dark.webp`}
					alt={`OpenPost ${story.visual.replaceAll('-', ' ')} for preparing ${platform.name} content`}
					label={`${platform.name} workflow`}
				/>
				<figcaption>The tools for your next {platform.name} post, already together.</figcaption>
			</figure>
		</section>
		<section class="ideas-section">
			<h2>Three ideas for your<br /><HeroAccent>next post.</HeroAccent></h2>
			<ul>
				{#each story.ideas as idea (idea)}<li>
						<ArrowRight size={20} aria-hidden="true" />{idea}
					</li>{/each}
			</ul>
		</section>
		<section class="channel-faq" aria-labelledby="channel-questions">
			<div>
				<h2 id="channel-questions">A little more about<br />{platform.name}.</h2>
				<a href={platform.docsUrl} class="focus-ring text-link"
					>Help with connecting accounts <ArrowRight size={16} /></a
				>
			</div>
			<div>
				<details open>
					<summary>{story.question}</summary>
					<p>{story.answer}</p>
				</details>
				<details>
					<summary>What can I prepare for {platform.name}?</summary>
					<p>
						OpenPost includes these formats. Check the options available to your account before
						scheduling.
					</p>
					<ul>
						{#each platform.formats as format (format.name)}<li>
								<strong>{format.name}</strong>: {format.media}
							</li>{/each}
					</ul>
				</details>
				<details>
					<summary>Can I prepare posts for other channels too?</summary>
					<p>
						Yes. Start with one idea, select your accounts, then change the text and media for each
						channel. Your drafts and planned posts stay together in one calendar.
					</p>
					<a href="/platforms">Explore the other channels</a>
				</details>
				<details>
					<summary>Do I need to install anything?</summary>
					<p>
						No. OpenPost Cloud runs in your browser. You can also try the free image and video
						editors before creating an account. Full video editing works best in desktop Chrome or
						Edge.
					</p>
					<a href="/tools">Try the free tools</a>
				</details>
			</div>
		</section>
	{:else}
		<section class="channel-unavailable">
			<PlatformIcon platform={platform.short} class="size-10" />
			<h1>{platform.name} is not available yet.</h1>
			<p class="marketing-copy">
				You cannot connect or publish to {platform.name} in OpenPost right now. Explore the other channels,
				or contact us if this is the one your business needs.
			</p>
			<Button href="/platforms">Explore other channels <ArrowRight data-icon="inline-end" /></Button
			><a class="focus-ring text-link" href={supportMailUrl}>Ask about {platform.name}</a>
		</section>
	{/if}
</div>

<style>
	.channel-page {
		padding-top: 28px;
	}
	.channel-hero {
		display: grid;
		gap: 56px;
		align-items: center;
		padding: 40px 0 64px;
	}
	h1 {
		margin: 0 0 24px;
		max-width: 15ch;
		font-size: clamp(40px, 5vw, 70px);
		line-height: 1.06;
		letter-spacing: -0.04em;
		font-weight: 550;
		text-wrap: balance;
	}
	.channel-hero :global(.marketing-copy) {
		margin-bottom: 28px;
	}
	.trial-note {
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 12px;
	}
	.channel-example {
		padding: clamp(20px, 4vw, 48px);
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
		border-radius: 16px;
		min-width: 0;
	}
	.example-label {
		margin-bottom: 28px;
		max-width: 24ch;
		font-size: 26px;
		line-height: 1.2;
		font-weight: 550;
		letter-spacing: -0.025em;
	}
	figcaption {
		margin-top: 20px;
		font-size: 12px;
		line-height: 1.6;
	}
	.availability {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
		font-size: 13px;
		line-height: 1.7;
	}
	.availability p {
		color: var(--muted-foreground);
	}
	a:not(:global([data-slot='button'])) {
		text-underline-offset: 4px;
	}
	.availability a,
	.channel-faq a {
		color: var(--foreground);
		text-decoration: underline;
	}
	.channel-story {
		display: grid;
		gap: 48px;
		padding-block: 88px;
		align-items: center;
	}
	.story-copy {
		display: grid;
		gap: 40px;
	}
	h2 {
		font-size: clamp(28px, 3.2vw, 42px);
		line-height: 1.15;
		font-weight: 550;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}
	.story-copy h2 {
		font-size: 28px;
	}
	.story-copy p {
		margin-top: 14px;
		color: var(--muted-foreground);
		line-height: 1.75;
		max-width: 65ch;
	}
	.story-product {
		min-width: 0;
		padding: 20px;
		border-radius: 16px;
		background: var(--marketing-section);
	}
	.story-product figcaption {
		color: var(--muted-foreground);
	}
	.ideas-section {
		display: grid;
		gap: 36px;
		align-items: center;
		padding: clamp(24px, 5vw, 60px);
		border-radius: 16px;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.ideas-section li {
		display: flex;
		align-items: center;
		gap: 16px;
		padding-block: 20px;
		border-bottom: 1px solid color-mix(in oklch, currentColor 20%, transparent);
		line-height: 1.6;
	}
	.ideas-section :global(svg) {
		flex-shrink: 0;
	}
	.channel-faq {
		display: grid;
		gap: 40px;
		padding-block: 88px;
	}
	.channel-faq details {
		border-bottom: 1px solid var(--border);
		padding-block: 8px;
	}
	summary {
		padding-block: 16px;
		min-height: 48px;
		font-weight: 550;
		cursor: pointer;
	}
	.channel-faq p,
	.channel-faq ul {
		margin-bottom: 20px;
		color: var(--muted-foreground);
		font-size: 15px;
		line-height: 1.75;
	}
	.channel-faq li {
		margin-top: 10px;
	}
	.channel-faq details a {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
	}
	.text-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font-size: 14px;
		border-radius: 4px;
	}
	.channel-unavailable {
		padding-block: 64px 100px;
	}
	.channel-unavailable .marketing-copy {
		margin-bottom: 24px;
	}
	.channel-unavailable .text-link {
		margin-left: 24px;
	}
	@media (min-width: 960px) {
		.channel-hero {
			grid-template-columns: 1fr 1fr;
		}
		.channel-story {
			grid-template-columns: 0.85fr 1.15fr;
		}
		.ideas-section,
		.channel-faq {
			grid-template-columns: 0.9fr 1.1fr;
		}
	}
	@media (max-width: 600px) {
		.channel-hero {
			gap: 32px;
		}
		.channel-story,
		.channel-faq {
			padding-block: 56px;
		}
	}
</style>
