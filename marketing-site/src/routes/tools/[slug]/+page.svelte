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
	import VideoEditorLauncher from '../../_components/tools/VideoEditorLauncher.svelte';
	import { getTool } from '../../_marketing';

	const seoBySlug: Record<
		string,
		{
			heading: string;
			description: string;
			privacyNote?: string;
		}
	> = {
		'social-media-video-editor': {
			heading: 'Edit social videos without an account',
			description:
				'Record or import footage, edit one shared timeline for portrait, feed, square, and landscape video, then export without a watermark.',
			privacyNote:
				'Your projects, recordings, transcripts, and analysis stay in this browser unless you choose Save to OpenPost or Use in a post.'
		},
		'social-media-image-editor': {
			heading: 'Create social media images without an account',
			description:
				'Design posts, carousel pages, Story slides, and thumbnails in your browser. Export PNG, JPEG, or WebP files without a watermark.',
			privacyNote:
				'Your local designs and images stay in this browser unless you choose to save them to OpenPost.'
		},
		'multi-platform-character-counter': {
			heading: 'Count every visible character before you publish',
			description:
				'Check one draft against ten social network limits. Emoji stay intact, with an X-style count for characters and links.'
		},
		'post-preview-generator': {
			heading: 'Preview each platform before you publish',
			description:
				'Check text, images, video, polls, links, content warnings, and supported formats across all ten OpenPost platforms.'
		},
		'thread-splitter': {
			heading: 'Turn long drafts into clean social threads',
			description:
				'Split at paragraphs, sentences, and words for X, Bluesky, Mastodon, Threads, or LinkedIn. Add numbers and copy one part or the full thread.'
		},
		'fediverse-handle-checker': {
			heading: 'Validate a Fediverse or Bluesky handle',
			description:
				'Check the handle format, open the right profile or lookup page, and choose whether to run a live account check.',
			privacyNote:
				'Syntax checks stay in this browser. A network request runs only after you select “Check live.”'
		},
		'linkedin-text-formatter': {
			heading: 'Make LinkedIn posts easier to scan',
			description:
				'Clean up spacing, shorten paragraphs, use one bullet style, and check the length while keeping the text easy to read and search.'
		},
		'best-time-to-post-calculator': {
			heading: 'Build posting times your team can actually use',
			description:
				'Choose the days and hours your audience is active, set your timezone, then copy or download a weekly plan.'
		}
	};

	const slug = $derived(page.params.slug ?? '');
	const tool = $derived.by(() => {
		const found = getTool(slug);
		if (!found) error(404, 'Tool not found');
		return found;
	});
	const seo = $derived(
		seoBySlug[slug] ?? {
			heading: tool.name,
			description: tool.description
		}
	);
</script>

<ToolPageShell title={seo.heading} description={seo.description} privacyNote={seo.privacyNote}>
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
	{/if}
</ToolPageShell>
