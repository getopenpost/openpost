import { getPlatformKey, getPlatformName } from '$lib/utils';
import { m } from '$lib/paraglide/messages';

export const COMPOSER_MODE_KEYS = ['post', 'thread', 'story', 'short_video', 'video'] as const;

export type ComposerModeKey = (typeof COMPOSER_MODE_KEYS)[number];

export type FocusedFieldKey =
	'postText' | 'caption' | 'linkUrl' | 'videoTitle' | 'videoDescription';

export type FocusedFieldType = 'text' | 'textarea' | 'url';

export interface ComposerMode {
	key: ComposerModeKey;
	label: string;
	description: string;
	group: ComposerModeGroupKey;
	mediaFirst: boolean;
}

export type ComposerModeGroupKey = 'write' | 'media';

export interface ComposerModeGroup {
	key: ComposerModeGroupKey;
	label: string;
	modes: ComposerMode[];
}

export interface ComposerAccountTarget {
	id: string;
	platform: string;
	account_username?: string;
}

export interface ComposerCapabilityTarget {
	provider: string;
	profile: string;
	output_profile?: string;
	intents?: string[] | null;
}

export interface ResolvedComposerTarget {
	profile: string;
	outputProfile: string;
	revision?: string;
	compatible?: boolean;
}

export interface FocusedRoleField {
	key: FocusedFieldKey;
	label: string;
	hint: string;
	type: FocusedFieldType;
	required?: boolean;
	rows?: number;
}

export interface FocusedComposerFields {
	postText?: string;
	caption?: string;
	linkUrl?: string;
	videoTitle?: string;
	videoDescription?: string;
}

export interface FocusedMediaInput {
	id: string;
	mimeType: string;
	role?: string;
	altText?: string;
	settings?: Record<string, unknown>;
	settingsByAccount?: Record<string, Record<string, unknown>>;
	accountIds?: string[];
	includeInCanonical?: boolean;
}

export interface FocusedSegmentInput {
	id: string;
	content: string;
	title?: string;
	description?: string;
	url?: string;
	media: FocusedMediaInput[];
	settingsByAccount?: Record<string, Record<string, unknown>>;
}

export interface FocusedPublicationInput {
	mode: ComposerModeKey;
	workspaceId: string;
	accounts: ComposerAccountTarget[];
	fields: FocusedComposerFields;
	media: FocusedMediaInput[];
	segments?: FocusedSegmentInput[];
	scheduledAt?: string;
	thumbnailMediaId?: string;
	settingsByAccount?: Record<string, Record<string, unknown>>;
	resolvedByAccount?: Record<string, ResolvedComposerTarget>;
}

export interface FocusedPublicationPayload {
	workspace_id: string;
	title: string;
	intent: ComposerModeKey;
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

export const COMPOSER_MODES: ComposerMode[] = [
	{
		key: 'post',
		label: 'Post',
		description: 'Text, a link, images, mixed media, or a document.',
		group: 'write',
		mediaFirst: false
	},
	{
		key: 'thread',
		label: 'Thread',
		description: 'Posts sent in order as a reply chain.',
		group: 'write',
		mediaFirst: false
	},
	{
		key: 'story',
		label: 'Story',
		description: 'A vertical image or video for supported Stories.',
		group: 'media',
		mediaFirst: true
	},
	{
		key: 'short_video',
		label: 'Short video',
		description: 'A Reel, Short, TikTok, or other short video.',
		group: 'media',
		mediaFirst: true
	},
	{
		key: 'video',
		label: 'Video',
		description: 'A full video with a title and account details.',
		group: 'media',
		mediaFirst: false
	}
];

export const SELECTABLE_COMPOSER_MODES = COMPOSER_MODES;

export const COMPOSER_MODE_GROUPS: ComposerModeGroup[] = [
	{
		key: 'write',
		label: 'Write',
		modes: SELECTABLE_COMPOSER_MODES.filter((mode) => mode.group === 'write')
	},
	{
		key: 'media',
		label: 'Media',
		modes: SELECTABLE_COMPOSER_MODES.filter((mode) => mode.group === 'media')
	}
];

export function composerMode(key: ComposerModeKey): ComposerMode {
	const mode = COMPOSER_MODES.find((candidate) => candidate.key === key) ?? COMPOSER_MODES[0];
	const copy: Record<ComposerModeKey, { label: string; description: string }> = {
		post: {
			label: m.compose_mode_post(),
			description: m.compose_mode_post_description()
		},
		thread: { label: m.compose_mode_thread(), description: m.compose_mode_thread_description() },
		story: { label: m.compose_mode_story(), description: m.compose_mode_story_description() },
		short_video: {
			label: m.compose_mode_short_video(),
			description: m.compose_mode_short_video_description()
		},
		video: { label: m.compose_mode_video(), description: m.compose_mode_video_description() }
	};
	return { ...mode, ...copy[mode.key] };
}

export function isAccountCompatibleWithMode(
	mode: ComposerModeKey,
	account: ComposerAccountTarget,
	capabilities: readonly ComposerCapabilityTarget[] = []
): boolean {
	const provider = getPlatformKey(account.platform);
	if (provider === 'youtube' && mode !== 'short_video' && mode !== 'video') return false;
	if (capabilities.length === 0) return true;
	return capabilities.some(
		(capability) =>
			capability.provider === provider &&
			(capability.intents?.includes(mode) || intentForLegacyProfile(capability.profile) === mode)
	);
}

export function roleFieldsForMode(
	mode: ComposerModeKey,
	accounts: ComposerAccountTarget[]
): FocusedRoleField[] {
	const platforms = unique(accounts.map((account) => getPlatformKey(account.platform)));
	const hasYouTube = platforms.includes('youtube');
	const nonYouTubePlatforms = platforms.filter((platform) => platform !== 'youtube');
	const nonYouTubeHint = platformHint(nonYouTubePlatforms);

	switch (mode) {
		case 'post':
			return [
				{
					key: 'postText',
					label: m.compose_post_text(),
					hint: m.compose_post_text(),
					type: 'textarea',
					rows: 8
				},
				{
					key: 'linkUrl',
					label: m.compose_link_url(),
					hint: m.compose_shared_link(),
					type: 'url'
				}
			];
		case 'thread':
			return [];
		case 'story':
			return [captionField(platformHint(platforms))];
		case 'short_video': {
			const fields: FocusedRoleField[] = [];
			if (hasYouTube) fields.push(videoTitleField(), videoDescriptionField());
			if (!hasYouTube || nonYouTubePlatforms.length > 0) {
				fields.push(captionField(nonYouTubeHint || 'TikTok, Instagram, Facebook, Threads'));
			}
			return fields;
		}
		case 'video': {
			const fields = [videoTitleField(), videoDescriptionField()];
			if (nonYouTubePlatforms.length > 0) fields.push(captionField(nonYouTubeHint));
			return fields;
		}
	}
}

export function buildFocusedPublicationPayload(
	input: FocusedPublicationInput
): FocusedPublicationPayload {
	const canonicalSegments = publicationSegments(input);
	const firstSegment = canonicalSegments[0];
	const sourceText = firstNonEmpty(
		input.fields.videoDescription,
		input.fields.caption,
		firstSegment?.content,
		input.fields.postText,
		input.fields.videoTitle,
		input.fields.linkUrl
	);
	const title = firstNonEmpty(
		input.fields.videoTitle,
		firstSegment?.title,
		firstLine(firstSegment?.content),
		firstLine(input.fields.caption),
		firstLine(input.fields.postText),
		firstLine(input.fields.videoDescription),
		composerMode(input.mode).label
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
			if (input.fields.linkUrl?.trim()) {
				if (platform === 'bluesky') {
					settings.link_url ??= input.fields.linkUrl.trim();
				} else {
					settings.url ??= input.fields.linkUrl.trim();
				}
			}
			if (platform === 'youtube') {
				if (input.fields.videoTitle?.trim()) settings.title ??= input.fields.videoTitle.trim();
				if (input.fields.videoDescription?.trim()) {
					settings.description ??= input.fields.videoDescription.trim();
				}
				if (input.thumbnailMediaId) settings.thumbnail_media_id ??= input.thumbnailMediaId;
			}
			const outputProfile =
				resolved?.outputProfile ?? fallbackOutputProfile(platform, input.mode, canonicalSegments);
			const profile = resolved?.profile ?? contentProfile;
			const followUpSegments: FocusedPublicationPayload['renditions'][number]['segments'] = [];
			const renditionSegments = canonicalSegments.map((segment) => {
				const body =
					platform === 'youtube'
						? firstNonEmpty(input.fields.videoDescription, segment.content, input.fields.caption)
						: firstNonEmpty(
								segment.content,
								input.fields.caption,
								input.fields.postText,
								sourceText
							);
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
						settings: {},
						media: []
					});
				}
				return {
					publication_segment_id: segment.id,
					body,
					title:
						platform === 'youtube'
							? firstNonEmpty(input.fields.videoTitle, segment.title, title)
							: firstNonEmpty(segment.title, title),
					description:
						platform === 'youtube'
							? firstNonEmpty(input.fields.videoDescription, segment.description)
							: firstNonEmpty(
									segment.description,
									input.fields.videoDescription,
									input.fields.caption
								),
					...(segment.url?.trim() ? { url: segment.url.trim() } : {}),
					settings: segmentSettings,
					media: mediaPayload(segment.media, account.id)
				};
			});
			renditionSegments.push(...followUpSegments);
			const first = renditionSegments[0];
			return {
				social_account_id: account.id,
				profile,
				output_profile: outputProfile,
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

export function intentForLegacyProfile(profile: string): ComposerModeKey {
	switch (profile) {
		case 'thread':
			return 'thread';
		case 'story':
			return 'story';
		case 'short_video':
			return 'short_video';
		case 'long_video':
			return 'video';
		default:
			return 'post';
	}
}

function publicationSegments(input: FocusedPublicationInput): FocusedSegmentInput[] {
	if (input.mode === 'thread' && input.segments?.length) return input.segments;
	const source = input.segments?.[0];
	return [
		{
			id: source?.id || 'segment-1',
			content: firstNonEmpty(
				input.fields.postText,
				input.fields.caption,
				input.fields.videoDescription,
				source?.content
			),
			title: firstNonEmpty(input.fields.videoTitle, source?.title),
			description: firstNonEmpty(input.fields.videoDescription, source?.description),
			url: firstNonEmpty(input.fields.linkUrl, source?.url),
			media: input.media.length > 0 ? input.media : (source?.media ?? []),
			settingsByAccount: source?.settingsByAccount
		}
	];
}

function compatibilityProfile(
	mode: ComposerModeKey,
	segments: FocusedSegmentInput[],
	linkUrl?: string
): string {
	if (mode === 'thread') return 'thread';
	if (mode === 'story') return 'story';
	if (mode === 'short_video') return 'short_video';
	if (mode === 'video') return 'long_video';
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
	segments: FocusedSegmentInput[]
): string {
	if (mode === 'thread') return `${platform}.thread`;
	if (mode === 'story') return `${platform}.story`;
	if (mode === 'video') return `${platform}.video`;
	if (mode === 'short_video') {
		if (platform === 'youtube') return 'youtube.short';
		if (platform === 'instagram' || platform === 'facebook') return `${platform}.reel`;
		return `${platform}.video`;
	}
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

function mediaPayload(media: FocusedMediaInput[], accountId?: string) {
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

function captionField(hint: string, required = false): FocusedRoleField {
	return {
		key: 'caption',
		label: m.compose_caption(),
		hint: hint ? m.compose_caption_platforms({ platforms: hint }) : m.compose_caption(),
		type: 'textarea',
		required,
		rows: 8
	};
}

function videoTitleField(): FocusedRoleField {
	return {
		key: 'videoTitle',
		label: m.compose_video_title(),
		hint: m.compose_video_title_hint(),
		type: 'text',
		required: true
	};
}

function videoDescriptionField(): FocusedRoleField {
	return {
		key: 'videoDescription',
		label: m.compose_video_description(),
		hint: m.compose_video_description_hint(),
		type: 'textarea',
		rows: 7
	};
}

function platformHint(platforms: string[]): string {
	return unique(platforms.map((platform) => getPlatformName(platform))).join(', ');
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function firstLine(value?: string): string {
	return value?.trim().split(/\r?\n/, 1)[0] ?? '';
}

function firstNonEmpty(...values: Array<string | undefined>): string {
	return values.find((value) => value?.trim())?.trim() ?? '';
}
