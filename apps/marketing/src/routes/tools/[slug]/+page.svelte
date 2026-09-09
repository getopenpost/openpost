<script lang="ts">
	import { page } from '$app/state';
	import { error } from '@sveltejs/kit';
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
	import { getTool } from '../../_marketing';

	const slug = $derived.by(() => {
		const tool = getTool(page.params.slug ?? '');
		if (!tool) error(404, 'Tool not found');
		return tool.slug;
	});
</script>

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
	{/if}
</ToolPageShell>
