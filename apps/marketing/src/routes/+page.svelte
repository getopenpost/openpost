<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Play from '@lucide/svelte/icons/play';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '$lib/components/ui/button';
	import PublicationStory from './_components/PublicationStory.svelte';
	import PostizSocialLogo from './_components/PostizSocialLogo.svelte';
	import {
		demoVideoUrl,
		faqs,
		landingPlatforms,
		managedSignupUrl,
		managedTrialNote
	} from './_marketing';
	import ScrollReveal from './_components/ScrollReveal.svelte';

	const shortFaqs = faqs.slice(0, 4);
</script>

<section class="landing-hero" aria-labelledby="hero-title">
	<div class="marketing-shell">
		<div class="hero-intro">
			<h1 id="hero-title">You build the business.<br /><span>We’ll help you share it.</span></h1>
			<p>
				Your ideas, your voice, every channel.<br class="desktop-break" /> Meet the content workspace
				that keeps up with you.
			</p>
			<div class="hero-actions">
				<Button href={managedSignupUrl} size="lg" class="landing-cta"
					>Start your free trial <ArrowRight data-icon="inline-end" /></Button
				>
				<a href={demoVideoUrl} class="watch-link focus-ring" target="_blank" rel="noreferrer"
					><span><Play size={13} fill="currentColor" /></span> See it in action</a
				>
			</div>
			<div class="trial-note">{managedTrialNote}</div>
		</div>
		<PublicationStory />
		<div class="platform-strip">
			<p>Make yourself at home.<br /><strong>Your channels are here.</strong></p>
			<div class="platform-marks" aria-label="Explore supported platforms">
				{#each landingPlatforms as platform (platform.slug)}<a
						href={`/platforms/${platform.slug}`}
						aria-label={`${platform.name} publishing guide`}
						class="focus-ring"><PostizSocialLogo platform={platform.slug} /></a
					>{/each}
			</div>
			<a href="/platforms" class="platform-details focus-ring"
				>See platform support <ArrowUpRight size={15} /></a
			>
		</div>
	</div>
</section>

<section id="product" class="intro-section marketing-shell" aria-labelledby="intro-title">
	<h2 id="intro-title">There’s a lot in your head.<br /><span>Let’s get it out there.</span></h2>
	<p>
		The launch you’ve been working on. A lesson from this week. That idea in your notes. OpenPost
		brings writing, media, and publishing into one place, so sharing your work becomes part of your
		day.
	</p>
</section>

<section class="workflow-section marketing-shell" aria-labelledby="workflow-title">
	<div class="workflow-copy">
		<h2 id="workflow-title">One good idea.<br />More ways to tell it.</h2>
		<p>
			A quick update on Bluesky. The full story on LinkedIn. Something visual for Instagram. Keep
			the idea together and give each version its own words, media, and timing.
		</p>
		<a class="focus-ring text-link" href="/features"
			>Meet your new workspace <ArrowUpRight size={18} /></a
		>
		<div class="workflow-note">
			<Check size={17} /><span>You review every version before it goes live.</span>
		</div>
	</div>
	<div class="rendition-visual" aria-label="Example: a launch adapted into three formats">
		<div class="source-idea">We’re opening early access.<span>One source idea</span></div>
		<svg class="branch-lines" viewBox="0 0 300 49" preserveAspectRatio="none" aria-hidden="true"
			><path d="M150 0V24M50 49V24H250V49M150 24V49" /></svg
		>
		<div class="rendition-formats">
			<div>
				<PostizSocialLogo platform="bluesky" /><strong>The update</strong>
				<p>We made a little space for your next good idea.</p>
				<span>Short & direct</span>
			</div>
			<div>
				<PostizSocialLogo platform="linkedin" /><strong>The story</strong>
				<p>Why we built Fieldnotes, and what we learned.</p>
				<span>Room for context</span>
			</div>
			<div>
				<PostizSocialLogo platform="instagram" /><strong>The visual</strong>
				<div class="mini-art">Make<br />some<br /><em>room.</em></div>
				<span>Made to be seen</span>
			</div>
		</div>
	</div>
</section>

<section class="studio-section" aria-labelledby="studio-title">
	<div class="marketing-shell">
		<div class="section-heading">
			<h2 id="studio-title">The content team.<br />Without the team.</h2>
			<p>Write the post. Make the image. Cut the video.<br />You’ve already got the tools.</p>
		</div>
		<div class="studio-grid">
			<a href="/tools/social-media-image-editor" class="studio-item image-studio focus-ring">
				<div class="studio-copy">
					<h3>Make it look like you.</h3>
					<p>Images, carousels, and thumbnails.<br />Your brand, down to the last detail.</p>
					<span>Open the Image Editor <ArrowUpRight size={17} /></span>
				</div>
				<div class="studio-screen">
					<img
						src="/assets/screenshots/image-editor-dark.webp"
						alt="OpenPost still editor with editable layers and color controls"
						width="1440"
						height="900"
						loading="lazy"
					/>
				</div>
			</a>
			<a href="/tools/social-media-video-editor" class="studio-item video-studio focus-ring">
				<div class="studio-copy">
					<h3>A good cut goes a long way.</h3>
					<p>Record, trim, caption, and export.<br />All in your browser.</p>
					<span>Open the Video Editor <ArrowUpRight size={17} /></span>
				</div>
				<div class="studio-screen">
					<img
						src="/assets/screenshots/video-editor-dark.webp"
						alt="OpenPost Video Editor showing a video preview and multitrack timeline"
						width="1440"
						height="900"
						loading="lazy"
					/>
				</div>
			</a>
		</div>
		<div class="tools-note">
			<span>Try the editors for free. No account needed.</span><a
				href="/tools"
				class="focus-ring text-link">Explore all free tools <ArrowRight size={16} /></a
			>
		</div>
	</div>
</section>

<section class="schedule-section marketing-shell" aria-labelledby="schedule-title">
	<div class="weekly-plan" aria-label="Illustrative content calendar">
		<div class="plan-heading">
			<strong>A little planning. A clear week.</strong><span>September 14–18</span>
		</div>
		<div class="plan-days">
			<div>
				<span>Monday</span><b>14</b>
				<article class="plan-lilac">
					<PostizSocialLogo platform="linkedin" /><strong>What we learned</strong><span
						>9:00 am</span
					>
				</article>
			</div>
			<div>
				<span>Tuesday</span><b>15</b>
				<article class="plan-blue">
					<PostizSocialLogo platform="bluesky" /><strong>A small update</strong><span>12:30 pm</span
					>
				</article>
			</div>
			<div>
				<span>Wednesday</span><b>16</b>
				<article class="plan-mint">
					<PostizSocialLogo platform="instagram" /><strong>The launch</strong><span>10:00 am</span>
				</article>
			</div>
		</div>
		<div class="plan-footer">
			<Check size={15} /> Scheduled and ready. <span>Example calendar</span>
		</div>
	</div>
	<div class="schedule-copy">
		<h2 id="schedule-title">Show up.<br />Even on your busy days.</h2>
		<p>
			Give your posts a place in the calendar, then get on with your day. Drafts, scheduled posts,
			and publishing outcomes stay together, so you always know what’s happening.
		</p>
		<a href="/features" class="focus-ring text-link"
			>See how scheduling works <ArrowUpRight size={18} /></a
		>
	</div>
</section>

<section class="tour-section marketing-shell" aria-labelledby="tour-title">
	<ScrollReveal>
		<div class="tour-inner">
			<div>
				<h2 id="tour-title">Less explaining.<br />More showing.</h2>
				<p>Watch a draft become a scheduled publication.</p>
				<a class="focus-ring text-link" href={demoVideoUrl} target="_blank" rel="noreferrer"
					>Watch the product tour <ArrowUpRight size={18} /></a
				>
			</div>
			<a
				href={demoVideoUrl}
				target="_blank"
				rel="noreferrer"
				class="tour-play focus-ring"
				aria-label="Watch the OpenPost product tour"><Play size={32} fill="currentColor" /></a
			>
		</div>
	</ScrollReveal>
</section>

<section class="faq-section marketing-shell" aria-labelledby="faq-title">
	<div>
		<h2 id="faq-title">A few things<br />you might be wondering.</h2>
		<a href="/faq" class="focus-ring text-link">All your questions <ArrowUpRight size={18} /></a>
	</div>
	<div class="faq-list">
		{#each shortFaqs as item (item.question)}<details>
				<summary>{item.question}<span aria-hidden="true">+</span></summary>
				<p>{item.answer}</p>
			</details>{/each}
	</div>
</section>

<section class="landing-close" aria-labelledby="closing-title">
	<div class="marketing-shell">
		<span class="closing-brand"
			><img src="/assets/brand/logo.svg" alt="" width="32" height="32" /> OpenPost</span
		>
		<h2 id="closing-title">Your next post<br />starts with you.</h2>
		<p>We’ll take care of the moving parts.</p>
		<Button href={managedSignupUrl} size="lg" class="landing-cta"
			>Start your free trial <ArrowRight data-icon="inline-end" /></Button
		>
		<div class="trial-note">14 days free. $0 today. Card required.</div>
		<a href="/pricing" class="closing-pricing focus-ring"
			>Find the right plan for you <ArrowUpRight size={15} /></a
		>
	</div>
</section>

<style>
	.landing-hero {
		padding-top: 76px;
		background: var(--background);
	}
	.hero-intro {
		text-align: center;
	}
	h1 {
		font-size: clamp(40px, 5.7vw, 78px);
		font-weight: 550;
		letter-spacing: -0.04em;
		line-height: 1.06;
	}
	h1 span {
		color: var(--marketing-soft-ink);
	}
	.hero-intro > p {
		margin-top: 25px;
		font-size: 18px;
		line-height: 1.65;
		color: var(--muted-foreground);
	}
	.hero-actions {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 24px;
		margin-top: 27px;
	}
	:global(.landing-cta) {
		height: 48px;
		padding-inline: 24px;
		border-radius: 9px;
		font-size: 14px;
	}
	.watch-link {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		min-height: 44px;
		font-size: 13px;
		font-weight: 500;
		border-radius: 6px;
	}
	.watch-link > span {
		display: grid;
		place-items: center;
		width: 29px;
		height: 29px;
		border: 1px solid var(--border);
		border-radius: 50%;
		transition: transform 200ms ease;
	}
	.watch-link:hover > span {
		transform: scale(1.1);
	}
	.trial-note {
		margin-top: 14px;
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.hero-intro {
		margin-bottom: 24px;
	}
	.platform-strip {
		display: flex;
		align-items: center;
		gap: 32px;
		padding-block: 52px;
		margin-top: 20px;
		border-bottom: 1px solid var(--border);
	}
	.platform-strip > p {
		flex-shrink: 0;
		font-size: 12px;
		line-height: 1.65;
		color: var(--muted-foreground);
	}
	.platform-strip strong {
		color: var(--foreground);
		font-weight: 500;
	}
	.platform-marks {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 20px;
		flex: 1;
	}
	.platform-marks a {
		display: grid;
		place-items: center;
		min-width: 32px;
		min-height: 40px;
		border-radius: 6px;
		transition: transform 220ms ease;
	}
	.platform-marks a:hover {
		transform: translateY(-4px);
	}
	.platform-marks :global(img) {
		width: 29px;
		height: 29px;
	}
	.platform-details {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		min-height: 44px;
		border-radius: 5px;
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}
	.intro-section {
		display: grid;
		grid-template-columns: 1.15fr 1fr;
		gap: 10%;
		align-items: center;
		padding-block: 100px;
	}
	.intro-section h2 span {
		color: var(--marketing-soft-ink);
	}
	.intro-section > p,
	.workflow-copy > p,
	.schedule-copy > p {
		font-size: 16px;
		color: var(--muted-foreground);
		line-height: 1.8;
		max-width: 47ch;
	}
	.workflow-section {
		display: grid;
		grid-template-columns: 0.85fr 1.15fr;
		gap: 8%;
		align-items: center;
		padding-bottom: 110px;
	}
	.workflow-copy > p,
	.schedule-copy > p {
		margin-top: 24px;
	}
	.text-link {
		color: inherit;
		display: inline-flex;
		align-items: center;
		gap: 9px;
		min-height: 44px;
		margin-top: 22px;
		border-radius: 5px;
		font-size: 13px;
		font-weight: 550;
		text-decoration: underline;
		text-decoration-color: var(--border);
		text-underline-offset: 6px;
	}
	.text-link:hover {
		text-decoration-color: currentColor;
	}
	.workflow-note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 22px;
		color: var(--muted-foreground);
		font-size: 12px;
	}
	.rendition-visual {
		background: var(--muted);
		border-radius: 16px;
		padding: 42px 24px 28px;
	}
	.source-idea {
		background: var(--card);
		padding: 18px;
		max-width: 260px;
		margin-inline: auto;
		border-radius: 10px;
		text-align: center;
		font-size: 15px;
		font-weight: 550;
	}
	.source-idea span {
		display: block;
		font-size: 10px;
		color: var(--muted-foreground);
		margin-top: 6px;
		font-weight: 400;
	}
	.branch-lines {
		display: block;
		height: 49px;
		width: 100%;
		overflow: visible;
	}
	.branch-lines path {
		fill: none;
		stroke: var(--marketing-soft-ink);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.rendition-formats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		align-items: start;
	}
	.rendition-formats > div {
		padding: 16px;
		min-width: 0;
		border-radius: 9px;
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.rendition-formats > div:nth-child(2) {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
		margin-top: 13px;
	}
	.rendition-formats > div:nth-child(3) {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.rendition-formats :global(img) {
		width: 23px;
		height: 23px;
		margin-bottom: 20px;
	}
	.rendition-formats strong {
		display: block;
		font-size: 12px;
	}
	.rendition-formats p {
		font-size: 12px;
		line-height: 1.65;
		margin-top: 12px;
	}
	.rendition-formats span {
		display: block;
		margin-top: 22px;
		font-size: 9px;
	}
	.mini-art {
		font-size: 27px;
		letter-spacing: -0.03em;
		line-height: 1;
		margin-top: 15px;
		font-weight: 550;
	}
	.mini-art em {
		font-family: Georgia, serif;
		font-weight: 400;
	}
	.studio-section {
		padding-block: 85px 60px;
		background: var(--marketing-section);
	}
	.section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 30px;
		margin-bottom: 40px;
	}
	.section-heading > p {
		font-size: 15px;
		line-height: 1.75;
		color: var(--muted-foreground);
	}
	.studio-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
	}
	.studio-item {
		display: block;
		overflow: hidden;
		border-radius: 16px;
	}
	.image-studio {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.video-studio {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.studio-copy {
		padding: 34px;
	}
	.studio-copy h3 {
		font-size: 25px;
		line-height: 1.2;
		letter-spacing: -0.03em;
		font-weight: 550;
	}
	.studio-copy p {
		font-size: 14px;
		line-height: 1.7;
		margin-top: 12px;
	}
	.studio-copy span {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 22px;
		font-size: 12px;
		font-weight: 550;
	}
	.studio-screen {
		margin-left: 34px;
		margin-right: -65px;
		transform: translateY(12px) rotate(-2deg);
		transform-origin: bottom right;
		transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.studio-screen img {
		width: 100%;
		display: block;
		border-radius: 9px 0 0 0;
	}
	.studio-item:hover .studio-screen {
		transform: translateY(1px) rotate(0);
	}
	.tools-note {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding-top: 20px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.tools-note .text-link {
		margin-top: 0;
		color: var(--foreground);
	}
	.schedule-section {
		display: grid;
		grid-template-columns: 1.1fr 0.9fr;
		gap: 8%;
		align-items: center;
		padding-block: 110px;
	}
	.weekly-plan {
		padding: 26px;
		border: 1px solid var(--border);
		border-radius: 14px;
	}
	.plan-heading {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding-bottom: 24px;
	}
	.plan-heading strong {
		font-size: 15px;
		font-weight: 550;
	}
	.plan-heading > span {
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.plan-days {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border-top: 1px solid var(--border);
	}
	.plan-days > div {
		min-width: 0;
		padding: 16px 9px 28px;
		border-right: 1px solid var(--border);
	}
	.plan-days > div:first-child {
		padding-left: 0;
	}
	.plan-days > div:last-child {
		padding-right: 0;
		border-right: 0;
	}
	.plan-days > div > span {
		display: block;
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.plan-days b {
		display: block;
		font-size: 20px;
		font-weight: 500;
		margin-top: 7px;
	}
	.plan-days article {
		border-radius: 7px;
		padding: 12px 9px;
		margin-top: 20px;
	}
	.plan-days :global(img) {
		width: 20px;
		height: 20px;
		margin-bottom: 16px;
	}
	.plan-days article strong {
		display: block;
		font-size: 10px;
		font-weight: 550;
	}
	.plan-days article span {
		display: block;
		font-size: 9px;
		margin-top: 7px;
	}
	.plan-lilac {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.plan-blue {
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
		transform: translateY(25px);
	}
	.plan-mint {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.plan-footer {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-top: 15px;
		border-top: 1px solid var(--border);
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.plan-footer span {
		margin-left: auto;
		font-size: 9px;
	}
	.tour-inner {
		display: flex;
		justify-content: space-between;
		gap: 30px;
		align-items: center;
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
		border-radius: 16px;
		padding: 56px 64px;
	}
	.tour-inner h2 {
		font-size: 40px;
	}
	.tour-inner p {
		margin-top: 20px;
		font-size: 15px;
	}
	.tour-play {
		display: grid;
		place-items: center;
		width: 100px;
		height: 100px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--marketing-blue-ink);
		color: var(--marketing-blue);
		transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.tour-play:hover {
		transform: scale(1.07);
	}
	.faq-section {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10%;
		padding-block: 110px;
	}
	.faq-section h2 {
		font-size: 36px;
	}
	.faq-list details {
		border-bottom: 1px solid var(--border);
	}
	.faq-list summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		padding-block: 22px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		list-style: none;
	}
	.faq-list summary::-webkit-details-marker {
		display: none;
	}
	.faq-list summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
	.faq-list summary > span {
		font-size: 23px;
		font-weight: 400;
		transition: transform 180ms ease;
	}
	.faq-list details[open] summary > span {
		transform: rotate(45deg);
	}
	.faq-list details p {
		padding-bottom: 24px;
		font-size: 14px;
		line-height: 1.75;
		color: var(--muted-foreground);
	}
	.landing-close {
		padding-block: 75px 70px;
		text-align: center;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.closing-brand {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		font-size: 16px;
		font-weight: 550;
	}
	.landing-close h2 {
		font-size: clamp(44px, 6vw, 76px);
		margin-top: 26px;
	}
	.landing-close p {
		margin-top: 22px;
		margin-bottom: 28px;
		font-size: 17px;
	}
	.landing-close .trial-note {
		color: inherit;
	}
	.closing-pricing {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 44px;
		margin-top: 14px;
		font-size: 12px;
	}
	@media (min-width: 1400px) {
		.marketing-shell {
			max-width: 1160px;
		}
	}
	@media (max-width: 1000px) {
		.platform-strip {
			flex-wrap: wrap;
			gap: 16px;
		}
		.platform-details {
			margin-inline: auto;
		}
		.platform-marks {
			gap: 13px;
		}
		.rendition-visual {
			padding: 28px 15px;
		}
		.rendition-formats {
			gap: 7px;
		}
		.rendition-formats > div {
			padding: 12px;
		}
	}
	@media (max-width: 760px) {
		.landing-hero {
			padding-top: 48px;
		}
		h1 {
			font-size: clamp(34px, 7.5vw, 53px);
		}
		.hero-intro > p {
			font-size: 16px;
		}
		.intro-section,
		.workflow-section,
		.schedule-section,
		.faq-section {
			grid-template-columns: 1fr;
			gap: 32px;
			padding-block: 60px;
		}
		.intro-section {
			padding-bottom: 15px;
		}
		.workflow-copy > p,
		.schedule-copy > p,
		.intro-section > p {
			max-width: none;
		}
		.section-heading {
			display: block;
		}
		.section-heading > p {
			margin-top: 20px;
		}
		.studio-grid {
			grid-template-columns: 1fr;
		}
		.studio-section {
			padding-block: 55px 35px;
		}
		.tools-note {
			align-items: start;
			flex-direction: column;
			gap: 6px;
		}
		.schedule-copy {
			grid-row: 1;
		}
		.tour-inner {
			padding: 32px;
		}
		.tour-inner h2 {
			font-size: 30px;
		}
		.tour-play {
			width: 70px;
			height: 70px;
		}
		.platform-strip {
			justify-content: center;
			padding-block: 35px;
			margin-top: 10px;
		}
		.platform-strip > p {
			text-align: center;
			width: 100%;
		}
		.platform-marks {
			flex-basis: 100%;
			gap: 12px;
		}
		.platform-marks a {
			min-width: 44px;
			min-height: 44px;
		}
		.platform-marks :global(img) {
			width: 26px;
			height: 26px;
		}
		.faq-section h2 {
			font-size: 32px;
		}
	}
	@media (max-width: 400px) {
		.hero-actions {
			flex-direction: column;
			gap: 8px;
		}
		.hero-intro > p {
			font-size: 14px;
		}
		.desktop-break {
			display: none;
		}
		h1 {
			font-size: 34px;
		}
		.trial-note {
			font-size: 10px;
		}
		.hero-intro {
			margin-bottom: 20px;
		}
		.rendition-visual {
			padding-inline: 10px;
		}
		.rendition-formats > div {
			padding: 10px 8px;
		}
		.rendition-formats p {
			font-size: 11px;
		}
		.rendition-formats strong {
			font-size: 11px;
		}
		.rendition-formats span {
			font-size: 8px;
		}
		.mini-art {
			font-size: 24px;
		}
		.weekly-plan {
			padding: 16px;
		}
		.plan-heading strong {
			font-size: 13px;
		}
		.plan-days article strong {
			font-size: 9px;
		}
		.plan-footer {
			font-size: 9px;
		}
		.plan-footer span {
			font-size: 8px;
		}
		.tour-inner {
			padding: 26px;
			gap: 16px;
		}
		.tour-play {
			width: 52px;
			height: 52px;
		}
		.tour-play :global(svg) {
			width: 22px;
		}
		.tour-inner h2 {
			font-size: 27px;
		}
		.tour-inner p {
			font-size: 13px;
		}
		.studio-copy {
			padding: 26px;
		}
		.studio-screen {
			margin-left: 26px;
		}
	}
	@media (pointer: coarse) {
		.platform-marks a {
			min-width: 44px;
			min-height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.watch-link > span,
		.platform-marks a,
		.studio-screen,
		.tour-play,
		.faq-list summary > span {
			transition: none;
		}
	}
</style>
