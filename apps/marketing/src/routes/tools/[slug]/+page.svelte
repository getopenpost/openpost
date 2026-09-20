<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
	import { Button } from '$lib/components/ui/button';
	import CharacterCounter from '../../_components/tools/CharacterCounter.svelte';
	import HandleChecker from '../../_components/tools/HandleChecker.svelte';
	import LinkedInFormatter from '../../_components/tools/LinkedInFormatter.svelte';
	import PostingPlanner from '../../_components/tools/PostingPlanner.svelte';
	import PreviewGenerator from '../../_components/tools/PreviewGenerator.svelte';
	import ImageEditorLauncher from '../../_components/tools/ImageEditorLauncher.svelte';
	import ThreadSplitter from '../../_components/tools/ThreadSplitter.svelte';
	import ToolPageShell from '../../_components/tools/ToolPageShell.svelte';
	import UtmLinkBuilder from '../../_components/tools/UtmLinkBuilder.svelte';
	import VideoEditorLauncher from '../../_components/tools/VideoEditorLauncher.svelte';
	import QuickCutLauncher from '../../_components/tools/QuickCutLauncher.svelte';
	import { imageConversions } from '@openpost/social-images';
	import { getTool } from '../../_marketing';

	const slug = $derived.by(() => {
		const tool = getTool(page.params.slug ?? '');
		if (!tool) error(404, 'Tool not found');
		return tool.slug;
	});
	const conversion = $derived(imageConversions.find((item) => item.slug === slug));
</script>

{#snippet loadingTool()}<p role="status">Loading tool…</p>{/snippet}
{#snippet failedTool()}
	<div role="alert">
		<p class="mb-3">The tool could not load. Refresh the page to try again.</p>
		<Button variant="outline" onclick={() => window.location.reload()}>Refresh page</Button>
	</div>
{/snippet}

<ToolPageShell {slug}>
	{#if slug === 'social-media-video-editor'}
		<VideoEditorLauncher />
	{:else if slug === 'social-media-image-editor'}
		<ImageEditorLauncher />
	{:else if slug === 'multi-platform-character-counter'}
		<CharacterCounter />
	{:else if slug === 'post-preview-generator'}
		<PreviewGenerator />
	{:else if slug === 'thread-splitter'}
		<ThreadSplitter />
	{:else if slug === 'fediverse-handle-checker'}
		<HandleChecker />
	{:else if slug === 'linkedin-text-formatter'}
		<LinkedInFormatter />
	{:else if slug === 'best-time-to-post-calculator'}
		<PostingPlanner />
	{:else if slug === 'utm-link-builder'}
		<UtmLinkBuilder />
	{:else if slug === 'quick-cut'}
		<QuickCutLauncher />
	{:else if slug === 'logo-maker'}
		{#await import('../../_components/tools/LogoMaker.svelte')}{@render loadingTool()}{:then module}<module.default
			/>{:catch}{@render failedTool()}{/await}
	{:else if slug === 'background-remover'}
		{#await import('../../_components/tools/BackgroundRemover.svelte')}{@render loadingTool()}{:then module}<module.default
			/>{:catch}{@render failedTool()}{/await}
	{:else if slug === 'image-color-picker'}
		{#await import('../../_components/tools/ImageColorPicker.svelte')}{@render loadingTool()}{:then module}<module.default
			/>{:catch}{@render failedTool()}{/await}
	{:else if slug === 'image-converter' || slug === 'paste-image' || conversion}
		{#await import('../../_components/tools/ImageConverter.svelte')}
			{@render loadingTool()}
		{:then module}
			{#key slug}<module.default
					inputFormat={conversion?.input}
					outputFormat={conversion?.output}
				/>{/key}
		{:catch}{@render failedTool()}{/await}
	{/if}
</ToolPageShell>
