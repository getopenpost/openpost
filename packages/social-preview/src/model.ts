export const previewPlatforms = [
	'x',
	'mastodon',
	'bluesky',
	'linkedin',
	'threads',
	'instagram',
	'facebook',
	'youtube',
	'tiktok',
	'discord'
] as const;

export type PreviewPlatform = (typeof previewPlatforms)[number];
export type PreviewPlatformKey = PreviewPlatform | 'unsupported';

const previewFormats = [
	'post',
	'thread',
	'story',
	'reel',
	'short',
	'video',
	'photo',
	'document'
] as const;

export type PreviewFormat = (typeof previewFormats)[number];
export type PreviewMediaKind = 'image' | 'video' | 'document';

export interface PreviewIdentity {
	displayName: string;
	handle: string;
	avatarUrl?: string;
	verified?: boolean;
}

export interface PreviewMedia {
	id: string;
	kind: PreviewMediaKind;
	src: string;
	alt?: string;
	poster?: string;
	aspectRatio?: number;
	durationLabel?: string;
}

export interface PreviewSegment {
	id: string;
	text: string;
	media?: PreviewMedia[];
}

export interface PreviewPoll {
	options: string[];
	durationLabel?: string;
	allowMultiple?: boolean;
}

export interface PreviewCard {
	kind: 'link' | 'quote';
	title: string;
	description?: string;
	domain?: string;
	imageUrl?: string;
	author?: PreviewIdentity;
}

export interface PreviewModel {
	platform: PreviewPlatformKey;
	format: PreviewFormat;
	identity: PreviewIdentity;
	segments: PreviewSegment[];
	media: PreviewMedia[];
	poll?: PreviewPoll;
	card?: PreviewCard;
	contentWarning?: string;
	visibility?: string;
	location?: string;
	title?: string;
	subtitle?: string;
	createdAtLabel?: string;
	approximate?: boolean;
}

interface PreviewCapability {
	formats: readonly PreviewFormat[];
	media: readonly PreviewMediaKind[];
	polls?: boolean;
	cards?: readonly PreviewCard['kind'][];
	contentWarning?: boolean;
}

const commonMedia = ['image', 'video'] as const;

export const previewCapabilities: Record<PreviewPlatform, PreviewCapability> = {
	x: {
		formats: ['post', 'thread', 'video'],
		media: commonMedia,
		polls: true,
		cards: ['link', 'quote']
	},
	mastodon: {
		formats: ['post', 'thread', 'video'],
		media: commonMedia,
		polls: true,
		cards: ['link'],
		contentWarning: true
	},
	bluesky: {
		formats: ['post', 'thread', 'video'],
		media: commonMedia,
		cards: ['link', 'quote']
	},
	linkedin: {
		formats: ['post', 'thread', 'video', 'document'],
		media: ['image', 'video', 'document'],
		polls: true,
		cards: ['link']
	},
	threads: {
		formats: ['post', 'thread', 'video'],
		media: commonMedia,
		polls: true,
		cards: ['link', 'quote'],
		contentWarning: true
	},
	instagram: {
		formats: ['post', 'story', 'reel'],
		media: commonMedia
	},
	facebook: {
		formats: ['post', 'story', 'reel', 'video'],
		media: commonMedia,
		cards: ['link']
	},
	youtube: {
		formats: ['video', 'short'],
		media: ['video']
	},
	tiktok: {
		formats: ['video', 'photo'],
		media: commonMedia
	},
	discord: {
		formats: ['post', 'thread', 'video'],
		media: ['image', 'video', 'document'],
		cards: ['link']
	}
};

export const platformNames: Record<PreviewPlatformKey, string> = {
	x: 'X',
	mastodon: 'Mastodon',
	bluesky: 'Bluesky',
	linkedin: 'LinkedIn',
	threads: 'Threads',
	instagram: 'Instagram',
	facebook: 'Facebook',
	youtube: 'YouTube',
	tiktok: 'TikTok',
	discord: 'Discord',
	unsupported: 'Unsupported account'
};

export function normalizePreviewPlatform(value: string): PreviewPlatformKey {
	const normalized = value.toLowerCase().split(':')[0];
	return previewPlatforms.includes(normalized as PreviewPlatform)
		? (normalized as PreviewPlatform)
		: 'unsupported';
}

export function supportsPreviewFormat(platform: PreviewPlatform, format: PreviewFormat): boolean {
	return previewCapabilities[platform].formats.includes(format);
}

export function createPreviewModel(
	input: Partial<PreviewModel> & Pick<PreviewModel, 'platform'>
): PreviewModel {
	return {
		platform: input.platform,
		format: input.format ?? 'post',
		identity: {
			displayName: input.identity?.displayName || 'Your name',
			handle: input.identity?.handle?.replace(/^@/u, '') || 'yourhandle',
			avatarUrl: input.identity?.avatarUrl,
			verified: input.identity?.verified
		},
		segments: input.segments?.length ? input.segments : [{ id: 'primary', text: '' }],
		media: input.media ?? [],
		poll: input.poll,
		card: input.card,
		contentWarning: input.contentWarning,
		visibility: input.visibility,
		location: input.location,
		title: input.title,
		subtitle: input.subtitle,
		createdAtLabel: input.createdAtLabel ?? 'Now',
		approximate: input.approximate ?? true
	};
}
