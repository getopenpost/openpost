import {
	createPreviewModel,
	normalizePreviewPlatform,
	type PreviewCard,
	type PreviewFormat,
	type PreviewMedia,
	type PreviewModel,
	type PreviewPoll,
	type PreviewSegment
} from '@openpost/social-preview';
import type { SocialAccount } from '$lib/api/client';
import { getAuthenticatedMediaByID } from '$lib/media-url';
import { getPlatformName } from '$lib/utils';
import type {
	ComposerModeKey,
	ComposerSettings,
	ComposerSettingValue
} from '$lib/components/compose/modes';

export interface ComposerPreviewMedia {
	id: string;
	mimeType?: string;
	altText?: string;
	poster?: string;
	durationLabel?: string;
}

export interface ComposerPreviewSegment {
	id: string;
	text: string;
	media?: ComposerPreviewMedia[];
	settings?: ComposerSettings;
}

export interface ComposerPreviewInput {
	account: SocialAccount;
	mode: ComposerModeKey;
	segments: ComposerPreviewSegment[];
	media?: ComposerPreviewMedia[];
	outputProfile?: string;
	destinationSettings?: ComposerSettings;
	title?: string;
	subtitle?: string;
	linkUrl?: string;
	location?: string;
}

export function buildComposerPreview(input: ComposerPreviewInput): PreviewModel {
	const platform = normalizePreviewPlatform(input.account.platform);
	const destinationSettings = input.destinationSettings ?? {};
	const firstSegment = input.segments[0];
	const mergedSettings = {
		...destinationSettings,
		...(firstSegment?.settings ?? {})
	};
	const previewSegments: PreviewSegment[] = input.segments.map((segment) => ({
		id: segment.id,
		text: segment.text,
		media: segment.media?.map(previewMedia)
	}));
	const media = (firstSegment?.media?.length ? firstSegment.media : (input.media ?? [])).map(
		previewMedia
	);
	const title =
		input.title ||
		parseSettingText(mergedSettings, 'title') ||
		parseSettingText(mergedSettings, 'video_title') ||
		parseSettingText(mergedSettings, 'article_title') ||
		parseSettingText(mergedSettings, 'document_title');
	const subtitle =
		input.subtitle ||
		parseSettingText(mergedSettings, 'description') ||
		parseSettingText(mergedSettings, 'video_description') ||
		parseSettingText(mergedSettings, 'article_description');

	return createPreviewModel({
		platform,
		format: previewFormat(platform, input.mode, media, input.outputProfile),
		identity: {
			displayName: input.account.account_username || getPlatformName(input.account.platform),
			handle: input.account.account_username || input.account.slug || platform,
			avatarUrl: input.account.account_avatar_url || undefined
		},
		segments: previewSegments,
		media,
		poll: previewPoll(mergedSettings),
		card: previewCard(mergedSettings, input.linkUrl),
		contentWarning:
			parseSettingText(mergedSettings, 'spoiler_text') ||
			(settingBoolean(mergedSettings, 'spoiler') ? 'Sensitive media' : undefined),
		visibility: parseSettingText(mergedSettings, 'visibility') || undefined,
		location:
			input.location ||
			parseSettingText(mergedSettings, 'location_name') ||
			parseSettingText(mergedSettings, 'location'),
		title,
		subtitle
	});
}

export function previewFormat(
	platform: PreviewModel['platform'],
	mode: ComposerModeKey,
	media: PreviewMedia[] = [],
	outputProfile = ''
): PreviewFormat {
	const profileSuffix = outputProfile.trim().toLowerCase().split('.').at(-1);
	if (
		profileSuffix === 'thread' ||
		profileSuffix === 'story' ||
		profileSuffix === 'reel' ||
		profileSuffix === 'short' ||
		profileSuffix === 'video' ||
		profileSuffix === 'document'
	) {
		return profileSuffix;
	}
	if (platform === 'tiktok' && profileSuffix === 'photo') return 'photo';
	if (mode === 'thread' && !outputProfile) return 'thread';
	if (platform === 'youtube') return 'video';
	if (platform === 'linkedin' && media.some((item) => item.kind === 'document')) return 'document';
	if (platform === 'tiktok' && media.length > 0 && media.every((item) => item.kind === 'image')) {
		return 'photo';
	}
	if (media.some((item) => item.kind === 'video')) return 'video';
	return 'post';
}

function previewMedia(item: ComposerPreviewMedia): PreviewMedia {
	const mimeType = item.mimeType ?? '';
	return {
		id: item.id,
		kind: mimeType.startsWith('video/')
			? 'video'
			: mimeType === 'application/pdf'
				? 'document'
				: 'image',
		src: getAuthenticatedMediaByID(item.id),
		alt: item.altText,
		poster: item.poster,
		durationLabel: item.durationLabel
	};
}

function previewPoll(settings: ComposerSettings): PreviewPoll | undefined {
	const options = parseSeparatedValues(settings.poll_options);
	if (options.length < 2) return undefined;
	const duration =
		parseSettingText(settings, 'poll_duration') ||
		parseDurationLabel(settings.poll_duration_minutes, 'minute') ||
		parseDurationLabel(settings.poll_expires_in_seconds, 'second');
	return {
		options,
		durationLabel: duration || undefined,
		allowMultiple: settingBoolean(settings, 'poll_multiple')
	};
}

function previewCard(settings: ComposerSettings, fallbackURL?: string): PreviewCard | undefined {
	const quoteURL = parseSettingText(settings, 'quote_url');
	if (quoteURL) {
		return {
			kind: 'quote',
			title: 'Quoted post',
			description: quoteURL,
			domain: safeDomain(quoteURL)
		};
	}
	const url =
		parseSettingText(settings, 'url') ||
		parseSettingText(settings, 'link_url') ||
		fallbackURL?.trim() ||
		'';
	if (!url) return undefined;
	return {
		kind: 'link',
		title: parseSettingText(settings, 'link_title') || safeDomain(url) || 'Shared link',
		description: parseSettingText(settings, 'link_description') || undefined,
		domain: safeDomain(url),
		imageUrl:
			parseSettingText(settings, 'link_image_url') ||
			parseSettingText(settings, 'thumbnail_url') ||
			undefined
	};
}

function parseSettingText(settings: ComposerSettings, key: string): string {
	const value = settings[key];
	return typeof value === 'string' ? value.trim() : '';
}

function settingBoolean(settings: ComposerSettings, key: string): boolean {
	return settings[key] === true || settings[key] === 'true';
}

function parseSeparatedValues(value: ComposerSettingValue | undefined): string[] {
	if (Array.isArray(value))
		return value
			.map(String)
			.map((item) => item.trim())
			.filter(Boolean);
	if (typeof value !== 'string') return [];
	return value
		.split(/[\n,]/u)
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseDurationLabel(
	value: ComposerSettingValue | undefined,
	unit: 'minute' | 'second'
): string {
	const amount = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(amount) || amount <= 0) return '';
	if (unit === 'second' && amount >= 3600 && amount % 3600 === 0) {
		const hours = amount / 3600;
		return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	}
	return `${amount} ${amount === 1 ? unit : `${unit}s`}`;
}

function safeDomain(value: string): string {
	try {
		return new URL(value).hostname.replace(/^www\./u, '');
	} catch {
		return '';
	}
}
