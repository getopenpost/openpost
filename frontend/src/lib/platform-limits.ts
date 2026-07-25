import { getPlatformKey, getPlatformName } from '$lib/utils';

export const DEFAULT_PLATFORM_CHAR_LIMIT = 280;
export const X_STANDARD_CHAR_LIMIT = 280;
export type AccountLimitProfile = 'standard';

type AccountLimitTarget = {
	platform: string;
	limit_profile?: string | null;
	capabilities?: unknown;
	metadata?: unknown;
	[key: string]: unknown;
};

export interface PlatformLimitDefinition {
	key: string;
	name: string;
	charLimit: number;
	media: string;
	note: string;
}

export interface PlatformLimit {
	platform: string;
	key: string;
	limit: number;
	profile?: AccountLimitProfile;
	note?: string;
}

export const PLATFORM_LIMITS: Record<string, PlatformLimitDefinition> = {
	x: {
		key: 'x',
		name: 'X',
		charLimit: X_STANDARD_CHAR_LIMIT,
		media: 'Up to 4 images or 1 MP4 video',
		note: 'OpenPost enforces the standard 280-character API limit because connected accounts do not expose a verified long-post entitlement.'
	},
	mastodon: {
		key: 'mastodon',
		name: 'Mastodon',
		charLimit: 500,
		media: 'Up to 4 attachments',
		note: 'Instance rules can vary.'
	},
	bluesky: {
		key: 'bluesky',
		name: 'Bluesky',
		charLimit: 300,
		media: 'Up to 4 images or 1 MP4 video',
		note: 'Video is MP4-only and cannot be mixed with images.'
	},
	linkedin: {
		key: 'linkedin',
		name: 'LinkedIn',
		charLimit: 3000,
		media: 'One image, video, or document per rendition',
		note: 'Thread children publish as comments; use format-first publications for video and documents.'
	},
	threads: {
		key: 'threads',
		name: 'Threads',
		charLimit: 500,
		media: 'One media item or a 2-10 item carousel',
		note: 'Media must be served from public HTTPS URLs.'
	},
	facebook: {
		key: 'facebook',
		name: 'Facebook Pages',
		charLimit: 63206,
		media: 'One image/video, a 2-10 photo post, or one Story item',
		note: 'Pages publishing depends on Meta permissions and app review.'
	},
	instagram: {
		key: 'instagram',
		name: 'Instagram Business',
		charLimit: 2200,
		media: 'One image/video or a 2-10 item carousel',
		note: 'Business accounts behind Facebook Pages only.'
	},
	tiktok: {
		key: 'tiktok',
		name: 'TikTok',
		charLimit: 2200,
		media: 'One video or 1-35 JPEG/WebP photos',
		note: 'Public URL ownership verification and provider review may apply.'
	},
	youtube: {
		key: 'youtube',
		name: 'YouTube',
		charLimit: 5000,
		media: 'Exactly one video',
		note: 'The current adapter uploads scheduled videos as private.'
	}
};

export function accountHasXPremiumLongPosts(account: AccountLimitTarget): boolean {
	void account;
	return false;
}

export function accountLimitProfile(account: AccountLimitTarget): AccountLimitProfile {
	void account;
	return 'standard';
}

export function platformCharacterLimit(
	platform: string,
	profile: AccountLimitProfile = 'standard'
): number {
	void profile;
	return PLATFORM_LIMITS[getPlatformKey(platform)]?.charLimit ?? DEFAULT_PLATFORM_CHAR_LIMIT;
}

export function accountCharacterLimit(account: {
	platform: string;
	limit_profile?: string | null;
	capabilities?: unknown;
	metadata?: unknown;
	[key: string]: unknown;
}) {
	return platformCharacterLimit(account.platform, accountLimitProfile(account));
}

export function minimumAccountCharacterLimit(accounts: Array<AccountLimitTarget>): number {
	if (accounts.length === 0) return DEFAULT_PLATFORM_CHAR_LIMIT;
	return Math.min(...accounts.map(accountCharacterLimit));
}

export function uniquePlatformLimits(accounts: Array<AccountLimitTarget>): PlatformLimit[] {
	const seen = new Set<string>();
	return accounts
		.map((account) => {
			const key = getPlatformKey(account.platform);
			const profile = accountLimitProfile(account);
			return {
				platform: getPlatformName(account.platform),
				key,
				profile,
				limit: platformCharacterLimit(account.platform, profile),
				note: PLATFORM_LIMITS[key]?.note
			};
		})
		.filter((item) => {
			const dedupeKey = `${item.key}:${item.profile}`;
			if (seen.has(dedupeKey)) return false;
			seen.add(dedupeKey);
			return true;
		});
}

export function publicPlatformLimits(): PlatformLimitDefinition[] {
	return Object.values(PLATFORM_LIMITS);
}
