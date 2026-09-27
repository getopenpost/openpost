import { getPlatformKey, getPlatformName } from './utils';
import {
	countPlatformText,
	DEFAULT_PLATFORM_CHAR_LIMIT,
	PLATFORM_LIMITS,
	X_STANDARD_CHAR_LIMIT,
	X_PREMIUM_CHAR_LIMIT,
	type PlatformLimitDefinition
} from '@openpost/platform-text';

export {
	DEFAULT_PLATFORM_CHAR_LIMIT,
	X_STANDARD_CHAR_LIMIT,
	X_PREMIUM_CHAR_LIMIT,
	PLATFORM_LIMITS
} from '@openpost/platform-text';
export type { PlatformLimitDefinition } from '@openpost/platform-text';

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

export interface PlatformLimit {
	platform: string;
	key: string;
	limit: number;
	profile?: AccountLimitProfile;
	note?: string;
}

export type CharacterUsage = { count: number; limit: number } | { count: number; limit: null };

export function platformTextLength(platform: string, text: string): number {
	return countPlatformText(getPlatformKey(platform), text);
}

export function accountHasXPremiumLongPosts(account: AccountLimitTarget): boolean {
	return getPlatformKey(account.platform) === 'x' && account.limit_profile === 'x-premium';
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
