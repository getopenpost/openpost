<script lang="ts">
	import {
		SocialPreview,
		createPreviewModel,
		normalizePreviewPlatform,
		type PreviewFormat
	} from '@openpost/social-preview';
	import type { MarketingPlatform } from '../../_marketing';

	interface Props {
		platform: MarketingPlatform;
	}

	let { platform }: Props = $props();

	const platformKey = $derived(normalizePreviewPlatform(platform.slug));
	const format = $derived.by<PreviewFormat>(() => {
		if (platform.slug === 'x') return 'thread';
		if (platform.slug === 'youtube') return 'video';
		if (platform.slug === 'tiktok') return 'video';
		return 'post';
	});
	const segments = $derived(
		platform.slug === 'x'
			? platform.preview.chips.map((chip, index) => ({
					id: `reply-${index}`,
					text: index === 0 ? platform.preview.body : `${chip}: destination-specific reply copy.`
				}))
			: [{ id: 'platform', text: platform.preview.body }]
	);
	const model = $derived(
		createPreviewModel({
			platform: platformKey,
			format,
			identity: {
				displayName: 'OpenPost',
				handle: platform.slug === 'mastodon' ? 'openpost@mastodon.social' : 'openpost'
			},
			segments,
			contentWarning:
				platform.slug === 'mastodon' ? 'Product update and publishing details' : undefined,
			card:
				platform.slug === 'bluesky'
					? {
							kind: 'link',
							title: 'OpenPost',
							description: platform.preview.detail,
							domain: 'openpost.social'
						}
					: undefined,
			title: platform.slug === 'youtube' ? platform.preview.headline : undefined,
			subtitle: platform.slug === 'youtube' ? 'OpenPost product tour' : undefined
		})
	);
</script>

<SocialPreview {model} compact />
