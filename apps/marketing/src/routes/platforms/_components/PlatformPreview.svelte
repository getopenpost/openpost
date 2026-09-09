<script lang="ts">
	import {
		SocialPreview,
		createPreviewModel,
		normalizePreviewPlatform,
		type PreviewFormat
	} from '@openpost/social-preview';
	import type { MarketingPlatform } from '../../_marketing';
	import type { ChannelStory } from '../_stories';
	let { platform, story }: { platform: MarketingPlatform; story: ChannelStory } = $props();
	const format = $derived<PreviewFormat>(
		platform.slug === 'x'
			? 'thread'
			: ['youtube', 'tiktok'].includes(platform.slug)
				? 'video'
				: 'post'
	);
	const model = $derived(
		createPreviewModel({
			platform: normalizePreviewPlatform(platform.slug),
			format,
			identity: story.preview
				? { displayName: 'Studio example', handle: 'yourstudio' }
				: {
						displayName: 'OpenPost',
						handle: platform.slug === 'mastodon' ? 'openpost@mastodon.social' : 'openpost'
					},
			segments: (platform.slug === 'x'
				? [
						story.example,
						'Start with the problem your customer has.',
						'Show the part that makes it easier.'
					]
				: [story.example]
			).map((text, index) => ({ id: `example-${index}`, text })),
			media: story.preview
				? [
						{
							id: 'example-photo',
							kind: 'image',
							src: story.preview.image,
							alt: story.preview.alt,
							aspectRatio: 3 / 2
						}
					]
				: [],
			contentWarning: platform.slug === 'mastodon' ? 'A look at this week’s work' : undefined,
			card:
				platform.slug === 'bluesky'
					? {
							kind: 'link',
							title: 'OpenPost',
							description: 'Write posts, edit images and videos, and plan your week.',
							domain: 'openpo.st'
						}
					: undefined,
			title: platform.slug === 'youtube' ? story.preview?.title : undefined,
			subtitle: platform.slug === 'youtube' ? story.example : undefined
		})
	);
</script>

<SocialPreview {model} compact />
