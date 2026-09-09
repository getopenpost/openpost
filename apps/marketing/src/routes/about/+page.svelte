<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Button } from '$lib/components/ui/button';
	import HeroAccent from '../_components/HeroAccent.svelte';
	import { managedSignupUrl, githubUrl, supportMailUrl } from '../_marketing';
</script>

<article class="about marketing-shell">
	<header>
		<h1>A business to run.<br /><HeroAccent>A story to tell.</HeroAccent></h1>
		<p>
			You made something useful. Now people need to hear about it.<br class="hidden sm:block" /> OpenPost
			helps you do that without making social media your whole job.
		</p>
	</header>
	<section class="about-story">
		<div>
			<h2>Built for the person<br />doing a bit of everything.</h2>
			<p>
				When you run a small business, the product, customers, and content often land on the same
				desk. A quick update becomes a writing job, an image to edit, a video to trim, and several
				apps to open.
			</p>
			<p>
				OpenPost puts that work in one place. Start with what you’re building or learning. Write the
				post, make the media, and plan when to share it. Keep your drafts and assets ready for next
				time.
			</p>
			<p>
				The point is simple: spend less time repeating the work, and more time doing the work worth
				sharing.
			</p>
		</div>
		<aside>
			<h2>Independent.<br />Made in Porto.</h2>
			<p>OpenPost is built and operated by Rodrigo Dias in Porto, Portugal.</p>
			<p>
				It is a small, independent product for people building businesses of their own. Questions
				and feedback reach the person making it.
			</p>
			<a href={supportMailUrl} class="focus-ring">Say hello <ArrowRight size={16} /></a>
		</aside>
	</section>
	<section class="about-values">
		<h2>Useful tools.<br />Your decisions.</h2>
		<div>
			<h3>Make it yours.</h3>
			<p>
				AI can help with a draft. You choose the words, images, and timing. Your business should
				sound like you.
			</p>
			<h3>See what happened.</h3>
			<p>
				Know what is drafted, planned, published, or needs attention. When a channel cannot do
				something, OpenPost should tell you.
			</p>
			<h3>Keep your options.</h3>
			<p>
				Use OpenPost in the cloud, or run the open-source software on your own server. The source is
				public.
			</p>
			<a href={githubUrl} class="focus-ring"
				>Explore the open-source project <ArrowRight size={16} /></a
			>
		</div>
	</section>
	<div class="about-action">
		<Button href={managedSignupUrl} size="lg"
			>Try OpenPost <ArrowRight data-icon="inline-end" /></Button
		><a href="/#features" class="focus-ring">See what you can make <ArrowRight size={16} /></a>
	</div>
</article>

<style>
	.about {
		padding-block: 72px;
	}
	header {
		text-align: center;
	}
	h1 {
		font-size: clamp(42px, 5.7vw, 78px);
		line-height: 1.06;
		font-weight: 550;
		letter-spacing: -0.04em;
	}
	header > p {
		margin: 28px auto 0;
		max-width: 64ch;
		font-size: 18px;
		line-height: 1.7;
		color: var(--muted-foreground);
	}
	.about-story,
	.about-values {
		display: grid;
		gap: 48px;
		padding-block: 72px;
	}
	h2 {
		font-size: clamp(30px, 3.5vw, 44px);
		line-height: 1.15;
		font-weight: 550;
		letter-spacing: -0.03em;
	}
	p {
		line-height: 1.8;
		color: var(--muted-foreground);
		margin-top: 20px;
		max-width: 65ch;
	}
	aside {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
		padding: 36px;
		border-radius: 16px;
		align-self: start;
	}
	aside p {
		color: inherit;
	}
	aside h2 {
		font-size: 32px;
	}
	a:not(:global([data-slot='button'])) {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		min-height: 44px;
		margin-top: 12px;
		font-size: 14px;
		text-decoration: underline;
		text-underline-offset: 5px;
		border-radius: 4px;
	}
	.about-values {
		border-block: 1px solid var(--border);
	}
	h3 {
		font-size: 23px;
		font-weight: 550;
	}
	h3:not(:first-child) {
		margin-top: 32px;
	}
	.about-action {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 24px;
		margin-top: 40px;
	}
	.about-action a {
		margin-top: 0;
	}
	@media (min-width: 900px) {
		.about-story {
			grid-template-columns: 1.2fr 0.8fr;
			gap: 96px;
		}
		.about-values {
			grid-template-columns: 0.8fr 1.2fr;
			gap: 96px;
		}
	}
</style>
