import { pollDurationLabel } from '$lib/components/compose/polls';
import {
	createPreviewModel,
	normalizePreviewPlatform,
	type PreviewBusinessPost,
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
	aspectRatio?: number;
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
	segmentStrategy?: 'preserve' | 'join';
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
	const sourceSegments =
		input.segmentStrategy === 'join' && input.segments.length > 1
			? [
					{
						...firstSegment,
						id: firstSegment.id,
						text: input.segments
							.map((segment) => segment.text.trim())
							.filter(Boolean)
							.join('\n\n'),
						media: input.segments.flatMap((segment) => segment.media ?? [])
					}
				]
			: input.segments;
	const previewSegments: PreviewSegment[] = sourceSegments.map((segment) => ({
		id: segment.id,
		text: segment.text,
		media: segment.media?.map(previewMedia),
		poll: previewPoll({ ...destinationSettings, ...segment.settings }),
		card: previewCard({ ...destinationSettings, ...segment.settings }),
		contentWarning: previewWarning({ ...destinationSettings, ...segment.settings })
	}));
	const media = (sourceSegments[0]?.media ?? input.media ?? []).map(previewMedia);
	const title =
		input.title ||
		parseSettingText(mergedSettings, 'title') ||
		parseSettingText(mergedSettings, 'video_title') ||
		parseSettingText(mergedSettings, 'article_title') ||
		parseSettingText(mergedSettings, 'document_title') ||
		parseSettingText(mergedSettings, 'pin_title') ||
		parseSettingText(mergedSettings, 'event_title');
	const subtitle =
		input.subtitle ||
		(platform === 'facebook' && parseSettingText(mergedSettings, 'video_description')) ||
		parseSettingText(mergedSettings, 'description') ||
		parseSettingText(mergedSettings, 'video_description') ||
		parseSettingText(mergedSettings, 'article_description') ||
		parseSettingText(mergedSettings, 'community');

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
		contentWarning: previewWarning(mergedSettings),
		visibility: parseSettingText(mergedSettings, 'visibility') || undefined,
		location:
			input.location ||
			parseSettingText(mergedSettings, 'location_name') ||
			parseSettingText(mergedSettings, 'location'),
		title,
		subtitle,
		business: platform === 'googlebusiness' ? previewBusinessPost(mergedSettings) : undefined
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
		profileSuffix === 'post' ||
		profileSuffix === 'photo' ||
		profileSuffix === 'thread' ||
		profileSuffix === 'story' ||
		profileSuffix === 'reel' ||
		profileSuffix === 'short' ||
		profileSuffix === 'video' ||
		profileSuffix === 'document'
	) {
		return profileSuffix;
	}
	if (mode === 'thread' && !outputProfile) return 'thread';
	if (platform === 'youtube' || platform === 'peertube') return 'video';
	if (platform === 'linkedin' && media.some((item) => item.kind === 'document')) return 'document';
	if (platform === 'tiktok' && media.length > 0 && media.every((item) => item.kind === 'image')) {
		return 'photo';
	}
	if (media.some((item) => item.kind === 'video')) return 'video';
	if (platform === 'pinterest') return 'photo';
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
		durationLabel: item.durationLabel,
		aspectRatio: item.aspectRatio
	};
}

function previewPoll(settings: ComposerSettings): PreviewPoll | undefined {
	const options = parseSeparatedValues(settings.poll_options);
	if (options.length < 2) return undefined;
	const duration =
		pollDurationLabelForEnum(parseSettingText(settings, 'poll_duration')) ||
		parseDurationLabel(settings.poll_duration_minutes, 'minute') ||
		parseDurationLabel(settings.poll_expires_in_seconds, 'second');
	return {
		options,
		question: parseSettingText(settings, 'poll_question') || undefined,
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
		parseSettingText(settings, 'destination_link') ||
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

function previewWarning(settings: ComposerSettings): string | undefined {
	return (
		parseSettingText(settings, 'spoiler_text') ||
		(settingBoolean(settings, 'spoiler') || settingBoolean(settings, 'sensitive')
			? 'Sensitive media'
			: undefined)
	);
}

function previewBusinessPost(settings: ComposerSettings): PreviewBusinessPost {
	const topic = parseSettingText(settings, 'topic_type');
	const action = parseSettingText(settings, 'call_to_action');
	return {
		topic: topic === 'event' || topic === 'offer' ? topic : 'standard',
		startDate: parseSettingText(settings, 'event_start_date') || undefined,
		endDate: parseSettingText(settings, 'event_end_date') || undefined,
		startTime: parseSettingText(settings, 'event_start_time') || undefined,
		endTime: parseSettingText(settings, 'event_end_time') || undefined,
		action:
			topic !== 'offer' &&
			(action === 'book' ||
				action === 'order' ||
				action === 'shop' ||
				action === 'learn_more' ||
				action === 'sign_up' ||
				action === 'call')
				? action
				: undefined,
		actionUrl:
			parseSettingText(settings, topic === 'offer' ? 'offer_redeem_url' : 'action_url') ||
			undefined,
		couponCode: parseSettingText(settings, 'offer_coupon_code') || undefined,
		terms: parseSettingText(settings, 'offer_terms') || undefined
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
		.split('\n')
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseDurationLabel(
	value: ComposerSettingValue | undefined,
	unit: 'minute' | 'second'
): string {
	const amount = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(amount) || amount <= 0) return '';
	return pollDurationLabel(unit === 'minute' ? amount * 60 : amount);
}

function safeDomain(value: string): string {
	try {
		return new URL(value).hostname.replace(/^www\./u, '');
	} catch {
		return '';
	}
}

function pollDurationLabelForEnum(value: string): string {
	const days = new Map([
		['ONE_DAY', 1],
		['THREE_DAYS', 3],
		['SEVEN_DAYS', 7],
		['FOURTEEN_DAYS', 14],
		['ONE_WEEK', 7],
		['TWO_WEEKS', 14]
	]).get(value);
	return days ? pollDurationLabel(days * 86400) : '';
}
