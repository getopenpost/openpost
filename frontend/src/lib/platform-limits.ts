import { getPlatformKey, getPlatformName } from './utils';

export const DEFAULT_PLATFORM_CHAR_LIMIT = 280;
export const X_STANDARD_CHAR_LIMIT = 280;
export const X_PREMIUM_CHAR_LIMIT = 25_000;
const X_TRANSFORMED_URL_LENGTH = 23;
export type AccountLimitProfile = 'standard' | 'x-premium';

interface AccountLimitTarget {
	id?: string;
	platform: string;
	limit_profile?: string | null;
	// Legacy account shapes may still carry these fields. Limit selection intentionally ignores them.
	capabilities?: string[];
	metadata?: { x_premium?: boolean };
	account_username?: string;
}

type ResolvedAccountLimits = Record<string, { text_limit?: number | null } | null | undefined>;

const X_URL_PATTERN =
	/(?:https?:\/\/|www\.)[^\s<>{}[\]"']+|(?<![@\p{L}\p{N}_])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?:[/?#][^\s<>{}[\]"']*)?/giu;
const GRAPHEME_SEGMENTER = resolveGraphemeSegmenter();

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

export type CharacterUsage = { count: number; limit: number } | { count: number; limit: null };

export const PLATFORM_LIMITS = {
	x: {
		key: 'x',
		name: 'X',
		charLimit: X_STANDARD_CHAR_LIMIT,
		media: 'Up to 4 images or 1 MP4 video',
		note: 'Connected accounts use the limits reported by their X subscription tier.'
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
		media: 'One image, video, or document, or 2-20 images',
		note: 'Thread replies publish as comments. Use the focused editor for videos and documents.'
	},
	threads: {
		key: 'threads',
		name: 'Threads',
		charLimit: 500,
		media: 'One media item or a 2-20 item carousel',
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
		name: 'Instagram Professional',
		charLimit: 2200,
		media: 'One image/video or a 2-10 item carousel',
		note: 'Business or Creator accounts linked to Facebook Pages.'
	},
	tiktok: {
		key: 'tiktok',
		name: 'TikTok',
		charLimit: 2200,
		media: 'One video or 1-35 JPEG/WebP photos',
		note: 'Public link checks and app review may apply.'
	},
	youtube: {
		key: 'youtube',
		name: 'YouTube',
		charLimit: 5000,
		media: 'Exactly one video',
		note: 'Private by default. Unaudited Google projects may force private uploads.'
	},
	discord: {
		key: 'discord',
		name: 'Discord',
		charLimit: 2000,
		media: 'Up to 10 files, using a safe 10 MiB limit for each file',
		note: 'Discord webhooks can publish and delete messages, but cannot read a channel inbox.'
	}
} satisfies Record<string, PlatformLimitDefinition>;

export function accountHasXPremiumLongPosts(account: AccountLimitTarget): boolean {
	return getPlatformKey(account.platform) === 'x' && account.limit_profile === 'x-premium';
}

export function platformTextLength(platform: string, text: string): number {
	if (getPlatformKey(platform) !== 'x') return Array.from(text).length;
	const normalized = text.normalize('NFC');

	let length = 0;
	let cursor = 0;
	for (const match of normalized.matchAll(X_URL_PATTERN)) {
		const start = match.index;
		const matchedURL = match[0].replace(/[.,!?;:)\]}]+$/u, '');
		if (!matchedURL) continue;
		length += xWeightedTextSegmentLength(normalized.slice(cursor, start));
		length += X_TRANSFORMED_URL_LENGTH;
		cursor = start + matchedURL.length;
	}
	return length + xWeightedTextSegmentLength(normalized.slice(cursor));
}

function xWeightedTextSegmentLength(text: string): number {
	let length = 0;
	for (const cluster of graphemeSegments(text)) {
		const codePoints = Array.from(cluster, (value) => value.codePointAt(0) ?? 0);
		if (isXEmojiSequence(codePoints)) {
			length += 2;
			continue;
		}
		for (const codePoint of codePoints) length += xCodePointWeight(codePoint);
	}
	return length;
}

function graphemeSegments(text: string): string[] {
	if (GRAPHEME_SEGMENTER) {
		return Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment);
	}
	return Array.from(text);
}

function isXEmojiSequence(codePoints: number[]): boolean {
	if (codePoints.length < 2) return false;
	let regionalIndicators = 0;
	for (const codePoint of codePoints) {
		if (
			codePoint === 0x200d ||
			codePoint === 0xfe0f ||
			codePoint === 0x20e3 ||
			(codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
			(codePoint >= 0xe0020 && codePoint <= 0xe007f)
		) {
			return true;
		}
		if (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) regionalIndicators += 1;
	}
	return regionalIndicators >= 2;
}

function xCodePointWeight(codePoint: number): number {
	if (
		(codePoint >= 0 && codePoint <= 0x10ff) ||
		(codePoint >= 0x2000 && codePoint <= 0x200d) ||
		(codePoint >= 0x2010 && codePoint <= 0x201f) ||
		(codePoint >= 0x2032 && codePoint <= 0x2037)
	) {
		return 1;
	}
	return 2;
}

export function accountLimitProfile(account: AccountLimitTarget): AccountLimitProfile {
	if (accountHasXPremiumLongPosts(account)) return 'x-premium';
	return 'standard';
}

export function platformCharacterLimit(
	platform: string,
	profile: AccountLimitProfile = 'standard'
): number {
	if (getPlatformKey(platform) === 'x' && profile === 'x-premium') {
		return X_PREMIUM_CHAR_LIMIT;
	}
	return (
		platformLimitDefinition(getPlatformKey(platform))?.charLimit ?? DEFAULT_PLATFORM_CHAR_LIMIT
	);
}

export function accountCharacterLimit(
	account: AccountLimitTarget,
	resolvedAccounts: ResolvedAccountLimits = {}
) {
	if (account.id) {
		const resolvedLimit = resolvedAccounts[account.id]?.text_limit;
		if (resolvedLimit != null && Number.isFinite(resolvedLimit) && resolvedLimit > 0) {
			return resolvedLimit;
		}
	}
	return platformCharacterLimit(account.platform, accountLimitProfile(account));
}

export function minimumAccountCharacterLimit(
	accounts: Array<AccountLimitTarget>,
	resolvedAccounts: ResolvedAccountLimits = {}
): number {
	if (accounts.length === 0) return DEFAULT_PLATFORM_CHAR_LIMIT;
	return Math.min(...accounts.map((account) => accountCharacterLimit(account, resolvedAccounts)));
}

export function uniquePlatformLimits(
	accounts: Array<AccountLimitTarget>,
	resolvedAccounts: ResolvedAccountLimits = {}
): PlatformLimit[] {
	const seen = new Set<string>();
	return accounts
		.map((account) => {
			const key = getPlatformKey(account.platform);
			const limit = accountCharacterLimit(account, resolvedAccounts);
			const profile =
				key === 'x' && limit > X_STANDARD_CHAR_LIMIT
					? ('x-premium' as const)
					: accountLimitProfile(account);
			return {
				platform: getPlatformName(account.platform),
				key,
				profile,
				limit,
				note: platformLimitDefinition(key)?.note
			};
		})
		.filter((item) => {
			const dedupeKey = `${item.key}:${item.limit}`;
			if (seen.has(dedupeKey)) return false;
			seen.add(dedupeKey);
			return true;
		});
}

export function mostConstrainedCharacterUsage(
	value: string,
	platformLimits: PlatformLimit[]
): CharacterUsage {
	if (platformLimits.length === 0) {
		return { count: platformTextLength('', value), limit: null };
	}

	let usage = {
		count: platformTextLength(platformLimits[0].key, value),
		limit: platformLimits[0].limit
	};
	let highestRatio = usage.count / usage.limit;
	for (const platformLimit of platformLimits.slice(1)) {
		const count = platformTextLength(platformLimit.key, value);
		const ratio = count / platformLimit.limit;
		if (ratio > highestRatio || (ratio === highestRatio && platformLimit.limit < usage.limit)) {
			usage = { count, limit: platformLimit.limit };
			highestRatio = ratio;
		}
	}
	return usage;
}

export function publicPlatformLimits(): PlatformLimitDefinition[] {
	return Object.values(PLATFORM_LIMITS);
}

function platformLimitDefinition(key: string): PlatformLimitDefinition | undefined {
	return Object.values(PLATFORM_LIMITS).find((definition) => definition.key === key);
}

function resolveGraphemeSegmenter(): Intl.Segmenter | null {
	return typeof Intl.Segmenter === 'function'
		? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
		: null;
}
