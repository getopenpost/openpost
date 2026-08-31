import type { PostItem, VariantPost } from '$lib/components/compose/draft-utils';

interface ComposerBuildFingerprintInput {
	posts: readonly PostItem[];
	variants: ReadonlyMap<string, Record<string, VariantPost>>;
	linkUrl: string;
	accountIds: readonly string[];
	requestedOutputProfiles: Readonly<Record<string, string>>;
	formatLockedByAccount: Readonly<Record<string, boolean>>;
}

function sortedRecord<T>(values: Readonly<Record<string, T>>): Record<string, T> {
	return Object.fromEntries(
		Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
	);
}

export function composerBuildFingerprint(input: ComposerBuildFingerprintInput): string {
	const variants = Array.from(input.variants.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([accountID, record]) => {
			const overrides = input.posts.map((post) => {
				const variant = record[post.key];
				return {
					content: variant && !variant.contentInherited ? variant.content : null,
					mediaIds: variant && !variant.mediaInherited ? variant.mediaIds : null
				};
			});
			return overrides.some((override) => override.content !== null || override.mediaIds !== null)
				? [accountID, overrides]
				: null;
		})
		.filter((entry) => entry !== null);

	return JSON.stringify({
		posts: input.posts.map((post) => ({ content: post.content, mediaIds: post.mediaIds })),
		variants,
		linkUrl: input.linkUrl,
		accounts: [...input.accountIds].sort(),
		requestedOutputProfiles: sortedRecord(input.requestedOutputProfiles),
		formatLockedByAccount: sortedRecord(input.formatLockedByAccount)
	});
}
