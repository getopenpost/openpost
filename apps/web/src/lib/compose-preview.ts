import { z } from 'zod';
import { firstComposerURL } from '$lib/components/compose/composer-links';
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
	settings?: ComposerSettings;
}

export interface ComposerPreviewSegment {
	id: string;
	text: string;
	url?: string;
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

const coverFrameMilliseconds = z
	.union([z.number(), z.string().trim().min(1).transform(Number)])
	.pipe(z.number().finite().nonnegative());

interface MediaPreviewContext {
	platform: PreviewModel['platform'];
	outputProfile: string;
	settings: ComposerSettings;
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
	const normalizedSegments = sourceSegments.map((segment) => ({
		...segment,
		media: input.segmentStrategy === 'join' ? uniqueMedia(segment.media ?? []) : segment.media
	}));
	const mediaContext = { platform, outputProfile: input.outputProfile ?? '' };
	const previewSegments: PreviewSegment[] = normalizedSegments.map((segment) => ({
		id: segment.id,
		text: deliveryPreviewText(
			platform,
			segment.text,
			{ ...destinationSettings, ...segment.settings },
			segment.media?.length ?? 0
		),
		media: segment.media?.map((item) =>
			previewMedia(item, {
				...mediaContext,
				settings: { ...destinationSettings, ...segment.settings }
			})
		),
		poll: previewPoll({ ...destinationSettings, ...segment.settings }),
		card: previewCard(
			platform,
			{ ...destinationSettings, ...segment.settings },
			segment.url ?? (firstComposerURL(segment.text) || undefined)
		),
		contentWarning: previewWarning({
			...destinationSettings,
			...segment.settings
		})
	}));
	const media = (normalizedSegments[0]?.media ?? input.media ?? []).map((item) =>
		previewMedia(item, { ...mediaContext, settings: mergedSettings })
	);
	const title =
		input.title ||
		parseSettingText(mergedSettings, 'title') ||
		parseSettingText(mergedSettings, 'video_title') ||
		parseSettingText(mergedSettings, 'document_title') ||
		parseSettingText(mergedSettings, 'pin_title') ||
		parseSettingText(mergedSettings, 'event_title');
	const subtitle =
		input.subtitle ||
		(platform === 'facebook' && parseSettingText(mergedSettings, 'video_description')) ||
		parseSettingText(mergedSettings, 'description') ||
		parseSettingText(mergedSettings, 'video_description') ||
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
		card: previewCard(
			platform,
			mergedSettings,
			sourceSegments[0]?.url ?? (firstComposerURL(sourceSegments[0]?.text ?? '') || input.linkUrl)
		),
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
	if (['feed', 'carousel', 'multi_image', 'article'].includes(profileSuffix ?? '')) return 'post';
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

function uniqueMedia(items: ComposerPreviewMedia[]): ComposerPreviewMedia[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

function previewMedia(item: ComposerPreviewMedia, context: MediaPreviewContext): PreviewMedia {
	const mimeType = item.mimeType ?? '';
	const cover = previewCover({ ...context, settings: { ...context.settings, ...item.settings } });
	return {
		id: item.id,
		kind: mimeType.startsWith('video/')
			? 'video'
			: mimeType === 'application/pdf'
				? 'document'
				: 'image',
		src: getAuthenticatedMediaByID(item.id),
		alt: item.altText,
		poster: cover.poster || (cover.previewFrameSeconds === undefined ? item.poster : undefined),
		previewFrameSeconds: cover.previewFrameSeconds,
		focalPoint:
			context.platform === 'mastodon'
				? previewFocalPoint(parseSettingText(item.settings ?? {}, 'focal_point'))
				: undefined,
		durationLabel: item.durationLabel,
		aspectRatio: item.aspectRatio
	};
}

function previewCover(
	context: MediaPreviewContext
): Pick<PreviewMedia, 'poster' | 'previewFrameSeconds'> {
	let coverKey = '';
	let frameKey = '';
	switch (context.platform) {
		case 'youtube':
		case 'peertube':
			coverKey = 'thumbnail_media_id';
			break;
		case 'instagram':
			if (context.outputProfile.trim().toLowerCase().endsWith('.carousel')) return {};
			coverKey = 'cover_media_id';
			frameKey = 'thumbnail_timestamp_ms';
			break;
		case 'pinterest':
			coverKey = 'cover_media_id';
			break;
		case 'tiktok':
			frameKey = 'cover_timestamp_ms';
			break;
		default:
			return {};
	}
	const coverID = coverKey ? parseSettingText(context.settings, coverKey) : '';
	if (coverID)
		return { poster: /^https?:\/\//u.test(coverID) ? coverID : getAuthenticatedMediaByID(coverID) };
	const frame = coverFrameMilliseconds.safeParse(context.settings[frameKey]);
	return frame.success ? { previewFrameSeconds: frame.data / 1000 } : {};
}

function previewFocalPoint(value: string): PreviewMedia['focalPoint'] {
	const parts = value.split(',');
	if (parts.some((part) => !part.trim())) return undefined;
	const coordinates = parts.map(Number);
	if (
		coordinates.length !== 2 ||
		coordinates.some((value) => !Number.isFinite(value) || Math.abs(value) > 1)
	)
		return undefined;
	return { x: coordinates[0], y: coordinates[1] };
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

function deliveryPreviewText(
	platform: PreviewModel['platform'],
	text: string,
	settings: ComposerSettings,
	mediaCount: number
): string {
	if (mediaCount || !['x', 'threads', 'mastodon', 'pixelfed'].includes(platform)) return text;
	const uri = parseSettingText(settings, 'url') || parseSettingText(settings, 'link_url');
	return uri && !text.includes(uri) ? [text.trim(), uri].filter(Boolean).join('\n') : text;
}

function previewCard(
	platform: PreviewModel['platform'],
	settings: ComposerSettings,
	fallbackURL?: string
): PreviewCard | undefined {
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
		(['x', 'mastodon', 'pixelfed'].includes(platform) ? fallbackURL : undefined) ||
		parseSettingText(settings, 'url') ||
		parseSettingText(settings, 'link_url') ||
		parseSettingText(settings, 'destination_link') ||
		fallbackURL?.trim() ||
		'';
	if (!url) return undefined;
	return {
		kind: 'link',
		title:
			(platform === 'linkedin'
				? parseSettingText(settings, 'article_title')
				: parseSettingText(settings, 'link_title')) ||
			safeDomain(url) ||
			'Shared link',
		description:
			(platform === 'linkedin'
				? parseSettingText(settings, 'article_description')
				: parseSettingText(settings, 'link_description')) || undefined,
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
