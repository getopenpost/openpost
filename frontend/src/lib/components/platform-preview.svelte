<script lang="ts">
	import {
		SocialPreview,
		createPreviewModel,
		normalizePreviewPlatform,
		platformNames,
		type PreviewCard,
		type PreviewFormat,
		type PreviewPoll,
		type PreviewSegment
	} from '@openpost/social-preview';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		platform: string;
		content: string;
		mediaIds: string[];
		mediaMimeTypes?: Record<string, string>;
		username?: string;
		displayName?: string;
		avatarUrl?: string;
		variantContent?: string | null;
		isUnsynced?: boolean;
		format?: PreviewFormat;
		segments?: PreviewSegment[];
		poll?: PreviewPoll;
		card?: PreviewCard;
		contentWarning?: string;
		visibility?: string;
		location?: string;
		title?: string;
		subtitle?: string;
	}

	let {
		platform,
		content,
		mediaIds,
		mediaMimeTypes = {},
		username = m.platform_preview_username(),
		displayName = m.platform_preview_display_name(),
		avatarUrl,
		variantContent = null,
		isUnsynced = false,
		format = 'post',
		segments,
		poll,
		card,
		contentWarning,
		visibility,
		location,
		title,
		subtitle
	}: Props = $props();

	const platformKey = $derived(normalizePreviewPlatform(platform));
	const previewName = $derived(platformNames[platformKey]);
	const previewContent = $derived(variantContent ?? content);
	const previewMedia = $derived(
		mediaIds.map((id) => {
			const mimeType = mediaMimeTypes[id] ?? '';
			return {
				id,
				kind: mimeType.startsWith('video/')
					? ('video' as const)
					: mimeType === 'application/pdf'
						? ('document' as const)
						: ('image' as const),
				src: getAuthenticatedMediaByID(id),
				alt: ''
			};
		})
	);
	const previewSegments = $derived(
		segments?.length ? segments : [{ id: 'primary', text: previewContent }]
	);
	const previewModel = $derived(
		createPreviewModel({
			platform: platformKey,
			format,
			identity: {
				displayName,
				handle: username,
				avatarUrl
			},
			segments: previewSegments,
			media: previewMedia,
			poll,
			card,
			contentWarning,
			visibility,
			location,
			title: title ?? (platformKey === 'youtube' ? firstLine(previewContent) : undefined),
			subtitle: subtitle ?? (platformKey === 'youtube' ? 'Scheduled video' : undefined)
		})
	);

	function firstLine(value: string): string {
		return (
			value
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.find(Boolean) ?? m.platform_preview_display_name()
		);
	}
</script>

<div class="grid gap-2" data-testid={`${platformKey}-preview`}>
	<span class="sr-only">{previewName} {format} preview</span>
	{#if isUnsynced}
		<p class="text-xs font-medium text-primary">
			{m.platform_preview_customized_for({ platform: previewName })}
		</p>
	{/if}
	<SocialPreview model={previewModel} />
</div>
