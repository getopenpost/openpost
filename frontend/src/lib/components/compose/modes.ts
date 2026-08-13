import { getPlatformKey } from '$lib/utils';
import { m } from '$lib/paraglide/messages';

export const COMPOSER_MODE_KEYS = ['post', 'thread'] as const;

export type ComposerModeKey = (typeof COMPOSER_MODE_KEYS)[number];

export interface ComposerAccountTarget {
	id: string;
	platform: string;
	account_username?: string;
}

export interface ResolvedComposerTarget {
	profile: string;
	outputProfile: string;
	segmentStrategy?: 'preserve' | 'join';
	revision?: string;
	compatible?: boolean;
}

export interface DestinationSegmentOverride {
	body?: string;
	title?: string;
	description?: string;
	url?: string;
}

export interface PublicationComposerFields {
	postText?: string;
	linkUrl?: string;
}

export interface PublicationMediaInput {
	id: string;
	mimeType: string;
	role?: string;
	altText?: string;
	settings?: Record<string, unknown>;
	settingsByAccount?: Record<string, Record<string, unknown>>;
	accountIds?: string[];
	includeInCanonical?: boolean;
}

export interface PublicationSegmentInput {
	id: string;
	content: string;
	title?: string;
	description?: string;
	url?: string;
	media: PublicationMediaInput[];
	settingsByAccount?: Record<string, Record<string, unknown>>;
}

export interface PublicationComposerInput {
	mode: ComposerModeKey;
	workspaceId: string;
	accounts: ComposerAccountTarget[];
	fields: PublicationComposerFields;
	media: PublicationMediaInput[];
	segments?: PublicationSegmentInput[];
	scheduledAt?: string;
	thumbnailMediaId?: string;
	settingsByAccount?: Record<string, Record<string, unknown>>;
	resolvedByAccount?: Record<string, ResolvedComposerTarget>;
	requestedOutputProfiles?: Record<string, string>;
	formatLockedByAccount?: Record<string, boolean>;
	scheduleOverridesByAccount?: Record<string, string>;
	segmentOverridesByAccount?: Record<string, Record<string, DestinationSegmentOverride>>;
	socialSetId?: string;
}

export interface ComposerPublicationPayload {
	workspace_id: string;
	title: string;
	intent: ComposerModeKey;
	creation_preset: ComposerModeKey;
	social_set_id: string;
	content_profile: string;
	source_text: string;
	source_url?: string;
	scheduled_at?: string;
	metadata: Record<string, unknown>;
	media: Array<{ media_id: string; role: string }>;
	segments: Array<{
		id: string;
		body: string;
		title: string;
		description: string;
		url?: string;
		media: Array<{
			media_id: string;
			role: string;
			alt_text?: string;
			settings?: Record<string, unknown>;
		}>;
	}>;
	renditions: Array<{
		social_account_id: string;
		profile: string;
		output_profile: string;
		format_locked: boolean;
		schedule_override?: string;
		body: string;
		title: string;
		description: string;
		settings: Record<string, unknown>;
		media: Array<{ media_id: string; role: string }>;
		segments: Array<{
			publication_segment_id: string;
			body: string;
			title: string;
			description: string;
			url?: string;
			body_override?: string;
			title_override?: string;
			description_override?: string;
			url_override?: string;
			media_inherited: boolean;
			settings: Record<string, unknown>;
			media: Array<{
				media_id: string;
				role: string;
				alt_text?: string;
				settings?: Record<string, unknown>;
			}>;
		}>;
	}>;
}

export function buildPublicationPayload(
	input: PublicationComposerInput
): ComposerPublicationPayload {
	const canonicalSegments = publicationSegments(input);
	const firstSegment = canonicalSegments[0];
	const sourceText = firstNonEmpty(
		firstSegment?.content,
		input.fields.postText,
		input.fields.linkUrl
	);
	const title = firstNonEmpty(
		firstSegment?.title,
		firstLine(firstSegment?.content),
		firstLine(input.fields.postText),
		m.compose_mode_post()
	);
	const contentProfile = compatibilityProfile(input.mode, canonicalSegments, input.fields.linkUrl);
	const segments = canonicalSegments.map((segment) => ({
		id: segment.id,
		body: segment.content,
		title: segment.title ?? '',
		description: segment.description ?? '',
		...(segment.url?.trim() ? { url: segment.url.trim() } : {}),
		media: mediaPayload(segment.media)
	}));

	return {
		workspace_id: input.workspaceId,
		title,
		intent: input.mode,
		creation_preset: input.mode,
		social_set_id: input.socialSetId ?? '',
		content_profile: contentProfile,
		source_text: sourceText,
		...(input.fields.linkUrl?.trim() ? { source_url: input.fields.linkUrl.trim() } : {}),
		...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
		metadata: {
			composer: 'publication',
			intent: input.mode
		},
		media: mediaPayload(firstSegment?.media ?? input.media).map(({ media_id, role }) => ({
			media_id,
			role
		})),
		segments,
		renditions: input.accounts.map((account) => {
			const platform = getPlatformKey(account.platform);
			const resolved = input.resolvedByAccount?.[account.id];
			const settings = { ...(input.settingsByAccount?.[account.id] ?? {}) };
			const destinationTitle = typeof settings.title === 'string' ? settings.title.trim() : '';
			const destinationDescription =
				typeof settings.description === 'string' ? settings.description.trim() : '';
			if (input.fields.linkUrl?.trim()) {
				if (platform === 'bluesky') {
					settings.link_url ??= input.fields.linkUrl.trim();
				} else {
					settings.url ??= input.fields.linkUrl.trim();
				}
			}
			if (platform === 'youtube' && input.thumbnailMediaId) {
				settings.thumbnail_media_id ??= input.thumbnailMediaId;
			}
			const outputProfile =
				input.requestedOutputProfiles?.[account.id] ??
				resolved?.outputProfile ??
				fallbackOutputProfile(platform, input.mode, canonicalSegments);
			const profile = resolved?.profile ?? contentProfile;
			const followUpSegments: ComposerPublicationPayload['renditions'][number]['segments'] = [];
			const destinationSegments =
				resolved?.segmentStrategy === 'join' && canonicalSegments.length > 1
					? [joinCanonicalSegments(canonicalSegments)]
					: canonicalSegments;
			const renditionSegments = destinationSegments.map((segment) => {
				const overrides = input.segmentOverridesByAccount?.[account.id]?.[segment.id];
				const body =
					overrides && Object.hasOwn(overrides, 'body')
						? (overrides.body ?? '')
						: firstNonEmpty(segment.content, input.fields.postText, sourceText);
				const segmentSettings = { ...(segment.settingsByAccount?.[account.id] ?? {}) };
				const firstComment =
					typeof segmentSettings.first_comment === 'string'
						? segmentSettings.first_comment.trim()
						: '';
				delete segmentSettings.first_comment;
				if (firstComment) {
					followUpSegments.push({
						publication_segment_id: segment.id,
						body: firstComment,
						title: '',
						description: '',
						media_inherited: false,
						settings: {},
						media: []
					});
				}
				const segmentTitle =
					overrides && Object.hasOwn(overrides, 'title')
						? (overrides.title ?? '')
						: platform === 'youtube'
							? firstNonEmpty(destinationTitle, segment.title, title)
							: firstNonEmpty(segment.title, title);
				const segmentDescription =
					overrides && Object.hasOwn(overrides, 'description')
						? (overrides.description ?? '')
						: platform === 'youtube'
							? firstNonEmpty(
									destinationDescription,
									segment.description,
									segment.content,
									input.fields.postText
								)
							: firstNonEmpty(segment.description);
				const segmentURL =
					overrides && Object.hasOwn(overrides, 'url')
						? (overrides.url ?? '')
						: (segment.url ?? '');
				const destinationMedia = mediaPayload(segment.media, account.id);
				const inheritedMedia = sameMediaIDs(destinationMedia, mediaPayload(segment.media));
				return {
					publication_segment_id: segment.id,
					body,
					title: segmentTitle,
					description: segmentDescription,
					...(segmentURL.trim() ? { url: segmentURL.trim() } : {}),
					...(overrides && Object.hasOwn(overrides, 'body')
						? { body_override: overrides.body ?? '' }
						: {}),
					...(overrides && Object.hasOwn(overrides, 'title')
						? { title_override: overrides.title ?? '' }
						: {}),
					...(overrides && Object.hasOwn(overrides, 'description')
						? { description_override: overrides.description ?? '' }
						: {}),
					...(overrides && Object.hasOwn(overrides, 'url')
						? { url_override: overrides.url ?? '' }
						: {}),
					media_inherited: inheritedMedia,
					settings: segmentSettings,
					media: destinationMedia
				};
			});
			renditionSegments.push(...followUpSegments);
			const first = renditionSegments[0];
			return {
				social_account_id: account.id,
				profile,
				output_profile: outputProfile,
				format_locked: input.formatLockedByAccount?.[account.id] ?? false,
				...(input.scheduleOverridesByAccount?.[account.id]
					? { schedule_override: input.scheduleOverridesByAccount[account.id] }
					: {}),
				body: first?.body ?? sourceText,
				title: first?.title ?? title,
				description: first?.description ?? '',
				settings,
				media: (first?.media ?? []).map(({ media_id, role }) => ({ media_id, role })),
				segments: renditionSegments
			};
		})
	};
}

function joinCanonicalSegments(segments: PublicationSegmentInput[]): PublicationSegmentInput {
	return {
		...segments[0],
		content: segments
			.map((segment) => segment.content.trim())
			.filter(Boolean)
			.join('\n\n'),
		media: segments.flatMap((segment) => segment.media)
	};
}

function sameMediaIDs(
	left: Array<{ media_id: string }>,
	right: Array<{ media_id: string }>
): boolean {
	return (
		left.length === right.length &&
		left.every((item, index) => item.media_id === right[index]?.media_id)
	);
}

function publicationSegments(input: PublicationComposerInput): PublicationSegmentInput[] {
	if (input.mode === 'thread' && input.segments?.length) return input.segments;
	const source = input.segments?.[0];
	return [
		{
			id: source?.id || 'segment-1',
			content: firstNonEmpty(input.fields.postText, source?.content),
			title: firstNonEmpty(source?.title),
			description: firstNonEmpty(source?.description),
			url: firstNonEmpty(input.fields.linkUrl, source?.url),
			media: input.media.length > 0 ? input.media : (source?.media ?? []),
			settingsByAccount: source?.settingsByAccount
		}
	];
}

function compatibilityProfile(
	mode: ComposerModeKey,
	segments: PublicationSegmentInput[],
	linkUrl?: string
): string {
	if (mode === 'thread') return 'thread';
	const media = segments.flatMap((segment) => segment.media);
	if (media.length > 1 || media.some((item) => item.mimeType.startsWith('application/'))) {
		return 'carousel';
	}
	if (media.length === 1) return 'image_post';
	if (linkUrl?.trim()) return 'link_share';
	return 'short_text';
}

function fallbackOutputProfile(
	platform: string,
	mode: ComposerModeKey,
	segments: PublicationSegmentInput[]
): string {
	if (mode === 'thread') return `${platform}.thread`;
	const media = segments.flatMap((segment) => segment.media);
	if (platform === 'linkedin' && media.some((item) => item.mimeType.startsWith('application/'))) {
		return 'linkedin.document';
	}
	if (platform === 'tiktok' && media.every((item) => item.mimeType.startsWith('image/'))) {
		return 'tiktok.photo';
	}
	if (media.length > 1) return `${platform}.carousel`;
	if (platform === 'instagram') return 'instagram.feed';
	if (platform === 'facebook' && media.length === 1) return 'facebook.photo';
	return `${platform}.post`;
}

function mediaPayload(media: PublicationMediaInput[], accountId?: string) {
	return media
		.filter((item) =>
			accountId
				? !item.accountIds || item.accountIds.includes(accountId)
				: item.includeInCanonical !== false
		)
		.map((item) => {
			const settings = {
				...(accountId ? (item.settingsByAccount?.[accountId] ?? {}) : (item.settings ?? {}))
			};
			const accountAltText = typeof settings.alt_text === 'string' ? settings.alt_text.trim() : '';
			const thumbnailTimestamp = Number(settings.thumbnail_timestamp_ms ?? 0);
			delete settings.alt_text;
			delete settings.thumbnail_timestamp_ms;
			return {
				media_id: item.id,
				role: item.role || 'attachment',
				...(accountAltText || item.altText ? { alt_text: accountAltText || item.altText } : {}),
				...(thumbnailTimestamp > 0 ? { thumbnail_timestamp_ms: thumbnailTimestamp } : {}),
				...(Object.keys(settings).length > 0 ? { settings } : {})
			};
		});
}

function firstLine(value?: string): string {
	return value?.trim().split(/\r?\n/, 1)[0] ?? '';
}

function firstNonEmpty(...values: Array<string | undefined>): string {
	return values.find((value) => value?.trim())?.trim() ?? '';
}
