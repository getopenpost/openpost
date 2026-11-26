export {
	cn,
	type WithoutChild,
	type WithoutChildren,
	type WithoutChildrenOrChild,
	type WithElementRef
} from '@openpost/ui/utils';

/**
 * Canonical platform-key owner for the web client. `getPlatformKey` trims,
 * case-folds, strips any `:instance` suffix, and resolves legacy aliases
 * (`twitter` → `x`, `gmb` → `googlebusiness`); every other key passes through
 * unchanged. Mobile mirrors these semantics in `platformKey`
 * (`apps/mobile/src/lib/format.ts`) because the native bundle cannot import
 * this module; keep the two in sync. The proposed long-term home for both is
 * `@openpost/platform-text`, which both apps already consume for limits.
 */
const PLATFORM_KEY_ALIASES = {
	twitter: 'x',
	gmb: 'googlebusiness'
} as const;

function resolvePlatformAlias(key: string): string {
	if (Object.hasOwn(PLATFORM_KEY_ALIASES, key)) {
		// SAFETY: `key` was just checked with `Object.hasOwn` against this exact table,
		// so narrowing to its key union cannot yield a missing entry.
		return PLATFORM_KEY_ALIASES[key as keyof typeof PLATFORM_KEY_ALIASES];
	}
	return key;
}

export function getPlatformKey(platform: string): string {
	return resolvePlatformAlias(platform.trim().toLowerCase().split(':')[0]);
}

export function getPlatformName(platform: string): string {
	switch (getPlatformKey(platform)) {
		case 'x':
			return 'X';
		case 'mastodon':
			return 'Mastodon';
		case 'pixelfed':
			return 'Pixelfed';
		case 'peertube':
			return 'PeerTube';
		case 'lemmy':
			return 'Lemmy';
		case 'piefed':
			return 'PieFed';
		case 'gotosocial':
			return 'GoToSocial';
		case 'akkoma':
			return 'Akkoma';
		case 'pleroma':
			return 'Pleroma';
		case 'friendica':
			return 'Friendica';
		case 'threads':
			return 'Threads';
		case 'devnull':
			return 'dev/null';
		case 'bluesky':
			return 'Bluesky';
		case 'discord':
			return 'Discord';
		case 'linkedin':
			return 'LinkedIn';
		case 'instagram':
			return 'Instagram';
		case 'facebook':
			return 'Facebook';
		case 'youtube':
			return 'YouTube';
		case 'tiktok':
			return 'TikTok';
		case 'pinterest':
			return 'Pinterest';
		case 'telegram':
			return 'Telegram';
		case 'reddit':
			return 'Reddit';
		case 'googlebusiness':
			return 'Google Business';
		default:
			return platform.split(':')[0];
	}
}

function formatAccountHandle(username: string | null | undefined): string {
	const normalizedUsername = username?.trim().replace(/^@+/, '');
	return normalizedUsername ? `@${normalizedUsername}` : '';
}

const HANDLE_FIRST_PLATFORMS = new Set([
	'bluesky',
	'devnull',
	'instagram',
	'mastodon',
	'pixelfed',
	'threads',
	'tiktok',
	'x'
]);

export function formatSocialAccountName(
	username: string | null | undefined,
	platform: string,
	alias = ''
): string {
	if (alias.trim()) return alias.trim();
	const normalizedUsername = username?.trim();
	if (!normalizedUsername) return '';
	const platformKey = getPlatformKey(platform.trim());
	return HANDLE_FIRST_PLATFORMS.has(platformKey)
		? formatAccountHandle(normalizedUsername)
		: normalizedUsername;
}

export function formatSocialAccountLabel(
	username: string | null | undefined,
	platform: string,
	fallback = ''
): string {
	const accountName = formatSocialAccountName(username, platform) || fallback.trim();
	const platformName = getPlatformName(platform);
	return formatAccountPlatformLabel(accountName, platformName);
}

export function formatAccountPlatformLabel(accountName: string, platformName: string): string {
	const normalizedAccountName = accountName.trim();
	const normalizedPlatformName = platformName.trim();
	if (!normalizedAccountName) return normalizedPlatformName;
	if (normalizedAccountName.toLocaleLowerCase() === normalizedPlatformName.toLocaleLowerCase()) {
		return normalizedPlatformName;
	}
	return `${normalizedAccountName} · ${normalizedPlatformName}`;
}

export function getStatusColor(status: string): string {
	const colors = new Map([
		['draft', 'bg-muted text-muted-foreground'],
		['scheduled', 'bg-blue-500/10 text-blue-600 dark:text-blue-400'],
		['publishing', 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'],
		['published', 'bg-green-500/10 text-green-600 dark:text-green-400'],
		['failed', 'bg-red-500/10 text-red-600 dark:text-red-400']
	]);
	return colors.get(status) ?? 'bg-muted text-muted-foreground';
}

/** Brand-chip tokens per canonical platform key. Values are the established
 * Tailwind classes; add a token here rather than a new ad-hoc class.
 * Native mirrors this table as hex in `platformColor`
 * (`apps/mobile/src/lib/format.ts`). */
export const PLATFORM_COLORS = {
	x: 'bg-black',
	mastodon: 'bg-indigo-500',
	pixelfed: 'bg-violet-500',
	peertube: 'bg-orange-500',
	lemmy: 'bg-emerald-600',
	piefed: 'bg-blue-500',
	threads: 'bg-orange-500',
	devnull: 'bg-lime-600',
	bluesky: 'bg-sky-500',
	discord: 'bg-indigo-500',
	linkedin: 'bg-blue-600',
	instagram: 'bg-pink-500',
	facebook: 'bg-blue-700',
	youtube: 'bg-red-600',
	tiktok: 'bg-zinc-900',
	pinterest: 'bg-red-700',
	telegram: 'bg-sky-500'
} as const;

export const PLATFORM_COLOR_FALLBACK = 'bg-gray-500';

export function getPlatformColor(platform: string): string {
	const key = getPlatformKey(platform);
	if (Object.hasOwn(PLATFORM_COLORS, key)) {
		// SAFETY: `key` was just checked with `Object.hasOwn` against this exact table,
		// so narrowing to its key union cannot yield a missing entry.
		return PLATFORM_COLORS[key as keyof typeof PLATFORM_COLORS];
	}
	return PLATFORM_COLOR_FALLBACK;
}
