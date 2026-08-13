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
import type { ComposerModeKey } from '$lib/components/compose/modes';

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
	settings?: Record<string, unknown>;
}

export interface ComposerPreviewInput {
	account: SocialAccount;
	mode: ComposerModeKey;
	segments: ComposerPreviewSegment[];
	media?: ComposerPreviewMedia[];
	outputProfile?: string;
	destinationSettings?: Record<string, unknown>;
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
		settingText(mergedSettings, 'title') ||
		settingText(mergedSettings, 'video_title') ||
		settingText(mergedSettings, 'article_title') ||
		settingText(mergedSettings, 'document_title');
	const subtitle =
		input.subtitle ||
		settingText(mergedSettings, 'description') ||
		settingText(mergedSettings, 'video_description') ||
		settingText(mergedSettings, 'article_description');

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
			settingText(mergedSettings, 'spoiler_text') ||
			(settingBoolean(mergedSettings, 'spoiler') ? 'Sensitive media' : undefined),
		visibility: settingText(mergedSettings, 'visibility') || undefined,
		location:
			input.location ||
			settingText(mergedSettings, 'location_name') ||
			settingText(mergedSettings, 'location'),
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

function previewPoll(settings: Record<string, unknown>): PreviewPoll | undefined {
	const options = separatedValues(settings.poll_options);
	if (options.length < 2) return undefined;
	const duration =
		settingText(settings, 'poll_duration') ||
		durationLabel(settings.poll_duration_minutes, 'minute') ||
		durationLabel(settings.poll_expires_in_seconds, 'second');
	return {
		options,
		durationLabel: duration || undefined,
		allowMultiple: settingBoolean(settings, 'poll_multiple')
	};
}

function previewCard(
	settings: Record<string, unknown>,
	fallbackURL?: string
): PreviewCard | undefined {
	const quoteURL = settingText(settings, 'quote_url');
	if (quoteURL) {
		return {
			kind: 'quote',
			title: 'Quoted post',
			description: quoteURL,
			domain: safeDomain(quoteURL)
		};
	}
	const url =
		settingText(settings, 'url') || settingText(settings, 'link_url') || fallbackURL?.trim() || '';
	if (!url) return undefined;
	return {
		kind: 'link',
		title: settingText(settings, 'link_title') || safeDomain(url) || 'Shared link',
		description: settingText(settings, 'link_description') || undefined,
		domain: safeDomain(url),
		imageUrl:
			settingText(settings, 'link_image_url') || settingText(settings, 'thumbnail_url') || undefined
	};
}

function settingText(settings: Record<string, unknown>, key: string): string {
	const value = settings[key];
	return typeof value === 'string' ? value.trim() : '';
}

function settingBoolean(settings: Record<string, unknown>, key: string): boolean {
	return settings[key] === true || settings[key] === 'true';
}

function separatedValues(value: unknown): string[] {
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

function durationLabel(value: unknown, unit: 'minute' | 'second'): string {
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
