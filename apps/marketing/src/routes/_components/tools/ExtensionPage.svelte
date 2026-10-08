<script lang="ts">
	import { ArrowLeft, ArrowRight, Github } from '@lucide/svelte';
	import { Button } from '@openpost/ui/components/button';
	import { browserExtensions, type BrowserExtension } from '@openpost/social-images';
	let { extension }: { extension: BrowserExtension } = $props();
	const other = $derived(browserExtensions.find((item) => item.slug !== extension.slug));
</script>

<section class="extension-page marketing-shell">
	<a class="back-link focus-ring" href="/tools#extensions"><ArrowLeft size={16} /> Free tools</a>
	<header>
		<h1>{extension.name}</h1>
		<p class="headline">{extension.headline}</p>
		<p class="description">{extension.description}</p>
		<div class="install-actions">
			{#if extension.chromeStoreUrl}
				<Button class="focus-ring" href={extension.chromeStoreUrl}
					>Add to Chrome <ArrowRight data-icon="inline-end" /></Button
				>
			{:else}
				<Button class="focus-ring" href={`${extension.repository}#install`}
					>Install extension <ArrowRight data-icon="inline-end" /></Button
				>
			{/if}
			{#if extension.firefoxStoreUrl}
				<Button class="focus-ring" variant="outline" href={extension.firefoxStoreUrl}
					>Add to Firefox</Button
				>
			{/if}
			<Button class="focus-ring" variant="ghost" href={extension.repository}
				><Github data-icon="inline-start" /> Source code</Button
			>
		</div>
		<p class="browser-support">Chrome, Brave, Edge and Firefox.</p>
	</header>
	<figure class:blue={extension.tone === 'blue'} class:lilac={extension.tone === 'lilac'}>
		<img
			src={extension.screenshot}
			alt={extension.screenshotAlt}
			width={extension.screenshotWidth}
			height={extension.screenshotHeight}
			fetchpriority="high"
		/>
	</figure>
	<p class="screenshot-caption">{extension.screenshotCaption}</p>
	<div class="extension-details" data-agent-include="tool-explanation">
		<section class="benefits" aria-label="What the extension does">
			{#each extension.benefits as benefit (benefit.title)}
				<div>
					<h2>{benefit.title}</h2>
					<p>{benefit.text}</p>
				</div>
			{/each}
		</section>
		<section class="setup">
			<h2>Get started</h2>
			<ol>
				{#each extension.setup as step (step)}<li>{step}</li>{/each}
			</ol>
			<p>{extension.cost}</p>
			<a class="focus-ring text-link" href={`${extension.repository}#install`}
				>Installation instructions <ArrowRight size={16} /></a
			>
		</section>
		<section class="privacy" id="privacy">
			<h2>Privacy</h2>
			<p>{extension.privacy}</p>
		</section>
		{#if other}
			<a class="other-extension focus-ring" href={`/tools/${other.slug}`}
				>Also from OpenPost: {other.name}<ArrowRight size={18} /></a
			>
		{/if}
	</div>
</section>

<style>
	.extension-page {
		padding-block: 28px 72px;
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font-size: 13px;
		color: var(--muted-foreground);
		border-radius: 4px;
	}
	header {
		max-width: 840px;
		padding-block: 32px 36px;
	}
	h1 {
		font-size: clamp(36px, 4vw, 56px);
		line-height: 1.08;
		letter-spacing: -0.035em;
		font-weight: 550;
		text-wrap: balance;
	}
	.headline {
		margin-top: 20px;
		font-size: clamp(23px, 3vw, 32px);
		line-height: 1.25;
		font-weight: 550;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}
	.description {
		max-width: 62ch;
		margin-top: 20px;
		color: var(--muted-foreground);
		font-size: 17px;
		line-height: 1.7;
	}
	.install-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 28px;
	}
	.install-actions :global(a:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
	}
	.browser-support {
		margin-top: 12px;
		color: var(--muted-foreground);
		font-size: 13px;
	}
	figure {
		display: flex;
		justify-content: center;
		padding: clamp(16px, 4vw, 48px);
		border-radius: 16px;
		overflow: hidden;
	}
	.blue {
		background: var(--marketing-blue);
	}
	.lilac {
		background: var(--marketing-lilac);
	}
	figure img {
		display: block;
		width: 100%;
		height: auto;
		max-width: 1100px;
		border-radius: 10px;
	}
	.screenshot-caption {
		margin-top: 12px;
		color: var(--muted-foreground);
		font-size: 13px;
	}
	.extension-details {
		max-width: 900px;
	}
	.benefits {
		padding-block: 52px;
		display: grid;
		gap: 32px;
	}
	.benefits > div {
		display: grid;
		grid-template-columns: 230px minmax(0, 1fr);
		gap: 24px;
	}
	h2 {
		font-size: 23px;
		font-weight: 550;
		line-height: 1.3;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}
	.extension-details p,
	li {
		font-size: 16px;
		line-height: 1.8;
		color: var(--muted-foreground);
	}
	.setup,
	.privacy {
		border-top: 1px solid var(--border);
		padding-block: 36px;
	}
	.setup ol {
		list-style: decimal;
		padding-left: 24px;
		margin-block: 20px;
	}
	li + li {
		margin-top: 8px;
	}
	.privacy p {
		margin-top: 16px;
	}
	.text-link {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		min-height: 44px;
		margin-top: 12px;
		text-decoration: underline;
		text-underline-offset: 4px;
		border-radius: 4px;
	}
	.other-extension {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		border-top: 1px solid var(--border);
		min-height: 64px;
		align-items: center;
		line-height: 1.5;
		padding-block: 16px;
		border-radius: 4px;
	}
	.text-link :global(svg),
	.other-extension :global(svg) {
		flex-shrink: 0;
	}
	@media (max-width: 599px) {
		header {
			padding-block: 20px 28px;
		}
		.benefits > div {
			grid-template-columns: 1fr;
			gap: 10px;
		}
		.benefits {
			padding-block: 36px;
		}
	}
</style>
