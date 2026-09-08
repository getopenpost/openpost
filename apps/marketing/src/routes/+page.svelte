<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Play from '@lucide/svelte/icons/play';
	import { Button } from '$lib/components/ui/button';
	import PostizSocialLogo from './_components/PostizSocialLogo.svelte';
	import {
		demoVideoUrl,
		faqs,
		landingPlatforms,
		managedSignupUrl,
		managedTrialNote
	} from './_marketing';
	import HeroAccent from './_components/HeroAccent.svelte';
	import ProductScreenshot from './_components/ProductScreenshot.svelte';
	import CreatorStories from './_components/CreatorStories.svelte';
	import ProductTour from './_components/ProductTour.svelte';
	import EditorDemo from './_components/EditorDemo.svelte';

	const shortFaqs = faqs.slice(0, 4);
</script>

<section class="landing-hero marketing-shell" aria-labelledby="hero-title">
	<div class="hero-intro">
		<h1 id="hero-title">
			You build the business.<br /><span>We’ll help you <HeroAccent>share it.</HeroAccent></span>
		</h1>
		<p>
			Write posts, edit your media, and plan what goes out.<br class="desktop-break" /> One workspace
			for every channel.
		</p>
		<div class="hero-actions">
			<Button href={managedSignupUrl} size="lg" class="landing-cta"
				>Start your free trial <ArrowRight data-icon="inline-end" /></Button
			>
			<a href={demoVideoUrl} class="focus-ring text-link" target="_blank" rel="noreferrer"
				><Play size={16} /> See it in action</a
			>
		</div>
		<div class="trial-note">{managedTrialNote}</div>
	</div>
	<ProductTour />
	<div class="platform-strip">
		<div class="platform-marks" aria-label="Explore supported platforms">
			{#each landingPlatforms as platform (platform.slug)}
				<a
					href={`/platforms/${platform.slug}`}
					aria-label={`${platform.name} publishing guide`}
					class="focus-ring"><PostizSocialLogo platform={platform.slug} /></a
				>
			{/each}
		</div>
		<a href="/platforms" class="focus-ring text-link"
			>See platform support <ArrowUpRight size={16} /></a
		>
	</div>
</section>

<section id="product" class="studio-section" aria-labelledby="studio-title">
	<div class="marketing-shell">
		<div class="section-heading">
			<h2 id="studio-title">Make the media<br />right here.</h2>
			<p>Free browser editors. No account needed.<br />Export without watermarks.</p>
		</div>
		<article class="editor-feature">
			<div class="feature-copy">
				<img
					class="feature-icon"
					src="/assets/brand/features/image-editor.svg"
					alt=""
					width="56"
					height="56"
					loading="lazy"
				/>
				<h3>Image Editor</h3>
				<p>Thumbnails, posts, and carousels you can keep editing.</p>
				<ul>
					<li>Layers, text, shapes, and templates</li>
					<li>Background removal and color tools</li>
					<li>Multi-page carousel exports</li>
				</ul>
				<a href="/tools/social-media-image-editor" class="focus-ring text-link"
					>Open the Image Editor <ArrowUpRight size={17} /></a
				>
			</div>
			<div class="editor-media">
				<ProductScreenshot
					label="Image Editor"
					src="/assets/screenshots/image-editor-dark.webp"
					alt="OpenPost Image Editor with a tram photo, editable layers, and color controls"
				/>
				<EditorDemo
					captions="/assets/demos/image-editor.vtt"
					src="/assets/demos/image-editor.mp4"
					poster="/assets/screenshots/image-editor-dark.webp"
					label="Image Editor"
					description="Edit a template, then open its export options. Recorded in OpenPost."
				/>
			</div>
		</article>
		<article class="editor-feature">
			<div class="feature-copy">
				<img
					class="feature-icon"
					src="/assets/brand/features/video-editor.svg"
					alt=""
					width="56"
					height="56"
					loading="lazy"
				/>
				<h3>Video Editor <span class="beta-note">Beta</span></h3>
				<p>Cut a recording into something ready to share.</p>
				<ul>
					<li>Multitrack cuts, transitions, and keyframes</li>
					<li>Captions and transcript-based editing</li>
					<li>Color grading and audio controls</li>
				</ul>
				<a href="/tools/social-media-video-editor" class="focus-ring text-link"
					>Open the Video Editor <ArrowUpRight size={17} /></a
				>
				<small>Use desktop Chromium for the full editor.</small>
			</div>
			<div class="editor-media">
				<ProductScreenshot
					label="Video Editor"
					src="/assets/screenshots/video-editor-dark.webp"
					alt="OpenPost Video Editor with a video preview and multitrack timeline"
				/>
				<EditorDemo
					captions="/assets/demos/video-editor.vtt"
					src="/assets/demos/video-editor.mp4"
					poster="/assets/screenshots/video-editor-dark.webp"
					label="Video Editor"
					description="Add a title, edit it on the canvas, and undo or redo the change. Recorded in OpenPost."
				/>
			</div>
		</article>
		<a href="/tools" class="focus-ring text-link">Explore all free tools <ArrowRight size={16} /></a
		>
	</div>
</section>

<section class="workspace-section marketing-shell" aria-labelledby="schedule-title">
	<div class="section-heading">
		<h2 id="schedule-title">Plan the week.<br />See what worked.</h2>
		<div class="workspace-copy">
			<img src="/assets/brand/features/compose.svg" alt="" width="32" height="32" loading="lazy" />
			<p>Start with one draft. Give each channel its own text, media, and timing.</p>
		</div>
	</div>
	<div class="workspace-grid">
		<article>
			<div class="workspace-heading">
				<img
					src="/assets/brand/features/calendar.svg"
					alt=""
					width="36"
					height="36"
					loading="lazy"
				/>
				<h3>Calendar</h3>
			</div>
			<ProductScreenshot
				label="Calendar"
				src="/assets/screenshots/calendar-dark.webp"
				alt="OpenPost monthly calendar with scheduled publications"
			/>
			<p>Drafts, schedules, and publishing outcomes in one view.</p>
		</article>
		<article>
			<div class="workspace-heading">
				<img
					src="/assets/brand/features/analytics.svg"
					alt=""
					width="36"
					height="36"
					loading="lazy"
				/>
				<h3>Analytics</h3>
			</div>
			<ProductScreenshot
				label="Analytics"
				src="/assets/screenshots/analytics-dark.webp"
				alt="OpenPost analytics with account growth and publication results"
			/>
			<p>Track the results each connected platform makes available.</p>
		</article>
	</div>
	<a href="/features" class="focus-ring text-link">See all features <ArrowUpRight size={17} /></a>
</section>

<CreatorStories />

<section class="faq-section marketing-shell" aria-labelledby="faq-title">
	<div>
		<h2 id="faq-title">A few questions.</h2>
		<a href="/faq" class="focus-ring text-link">Read the FAQ <ArrowUpRight size={17} /></a>
	</div>
	<div class="faq-list">
		{#each shortFaqs as item (item.question)}
			<details>
				<summary>{item.question}<span aria-hidden="true">+</span></summary>
				<p>{item.answer}</p>
			</details>
		{/each}
	</div>
</section>

<section class="landing-close" aria-labelledby="closing-title">
	<div class="marketing-shell">
		<h2 id="closing-title">Make your next post<br />with OpenPost.</h2>
		<Button href={managedSignupUrl} size="lg" class="landing-cta"
			>Start your free trial <ArrowRight data-icon="inline-end" /></Button
		>
		<div class="trial-note">{managedTrialNote}</div>
		<a href="/pricing" class="focus-ring text-link">Compare plans <ArrowUpRight size={16} /></a>
	</div>
</section>

<style>
	.landing-hero {
		padding-top: 64px;
	}
	.hero-intro {
		text-align: center;
		margin-bottom: 40px;
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
		margin-top: 24px;
		font-size: 18px;
		line-height: 1.65;
		color: var(--muted-foreground);
	}
	.hero-actions {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 24px;
		margin-top: 24px;
	}
	:global(.landing-cta) {
		height: 48px;
		padding-inline: 24px;
		border-radius: 9px;
		font-size: 14px;
	}
	.trial-note {
		margin-top: 12px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.text-link {
		color: inherit;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		border-radius: 5px;
		font-size: 14px;
		font-weight: 550;
		text-decoration: underline;
		text-decoration-color: var(--border);
		text-underline-offset: 5px;
	}
	.text-link:hover {
		text-decoration-color: currentColor;
	}
	.platform-strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 20px;
		padding-block: 32px 48px;
	}
	.platform-marks {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
	}
	.platform-marks a {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 6px;
	}
	.platform-marks :global(img) {
		width: 27px;
		height: 27px;
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		line-height: 1.12;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}
	h3 {
		font-size: 26px;
		font-weight: 550;
		letter-spacing: -0.025em;
		line-height: 1.2;
	}
	.studio-section {
		background: var(--marketing-section);
		padding-block: 72px;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 32px;
		margin-bottom: 48px;
	}
	.section-heading p {
		font-size: 16px;
		line-height: 1.7;
		color: var(--muted-foreground);
		max-width: 37ch;
	}
	.editor-feature {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.8fr);
		align-items: center;
		gap: 48px;
		padding-bottom: 48px;
	}
	.editor-feature + .editor-feature {
		padding-top: 48px;
		border-top: 1px solid var(--border);
	}
	.feature-icon {
		display: block;
		margin-bottom: 20px;
	}
	.feature-copy h3 {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.feature-copy p {
		margin-top: 16px;
		font-size: 16px;
		line-height: 1.65;
		max-width: 32ch;
	}
	.feature-copy ul {
		display: grid;
		gap: 10px;
		margin-block: 20px;
		padding-left: 18px;
		list-style: disc;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.feature-copy small {
		display: block;
		margin-top: 8px;
		font-size: 12px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.beta-note {
		font-size: 12px;
		letter-spacing: normal;
		font-weight: 400;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--muted-foreground);
	}
	.workspace-section {
		padding-block: 80px;
	}
	.workspace-copy {
		display: flex;
		align-items: start;
		gap: 14px;
	}
	.workspace-copy img {
		flex-shrink: 0;
	}
	.workspace-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 32px;
	}
	.workspace-heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
	}
	.workspace-heading h3 {
		font-size: 22px;
	}
	.workspace-grid p {
		font-size: 14px;
		line-height: 1.7;
		color: var(--muted-foreground);
		margin-top: 4px;
	}
	.workspace-section > .text-link {
		margin-top: 24px;
	}
	.faq-section {
		display: grid;
		grid-template-columns: 0.8fr 1.2fr;
		gap: 64px;
		padding-block: 80px;
	}
	.faq-section .text-link {
		margin-top: 16px;
	}
	.faq-list details {
		border-bottom: 1px solid var(--border);
	}
	.faq-list summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		min-height: 64px;
		padding-block: 16px;
		font-size: 15px;
		font-weight: 550;
		cursor: pointer;
		list-style: none;
	}
	.faq-list summary::-webkit-details-marker {
		display: none;
	}
	.faq-list summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 4px;
	}
	.faq-list summary span {
		font-size: 22px;
		font-weight: 400;
	}
	.faq-list details[open] summary span {
		transform: rotate(45deg);
	}
	.faq-list p {
		padding-bottom: 20px;
		font-size: 14px;
		line-height: 1.75;
		color: var(--muted-foreground);
	}
	.landing-close {
		text-align: center;
		padding-block: 72px;
		background: var(--marketing-section);
	}
	.landing-close :global(.landing-cta) {
		margin-top: 28px;
	}
	.landing-close .text-link {
		margin-top: 12px;
	}
	@media (max-width: 760px) {
		.landing-hero {
			padding-top: 40px;
		}
		.hero-intro {
			margin-bottom: 28px;
		}
		h1 {
			font-size: clamp(34px, 7vw, 53px);
		}
		.hero-intro > p {
			font-size: 16px;
		}
		.hero-actions {
			gap: 12px;
			flex-wrap: wrap;
		}
		.platform-strip {
			justify-content: center;
			gap: 12px;
			padding-bottom: 32px;
		}
		.platform-marks {
			justify-content: center;
			gap: 8px;
		}
		.section-heading {
			display: grid;
			gap: 20px;
			margin-bottom: 32px;
		}
		.studio-section,
		.workspace-section,
		.faq-section,
		.landing-close {
			padding-block: 48px;
		}
		.editor-feature,
		.workspace-grid,
		.faq-section {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
		.editor-feature {
			padding-bottom: 32px;
		}
		.editor-feature + .editor-feature {
			padding-top: 32px;
		}
		.feature-copy p {
			max-width: 46ch;
		}
		.feature-icon {
			width: 44px;
			height: 44px;
			margin-bottom: 16px;
		}
		.workspace-grid {
			gap: 32px;
		}
		.desktop-break {
			display: none;
		}
	}
</style>
