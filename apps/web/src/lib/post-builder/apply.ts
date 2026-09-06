import {
	makeEmptyPost,
	type PostItem,
	type ThreadVariantMap
} from '$lib/components/compose/draft-utils';
import type { PublicationBuildResult } from './client';

export interface AppliedPublicationBuild {
	posts: PostItem[];
	variants: ThreadVariantMap;
	requestedOutputProfiles: Record<string, string>;
	formatLockedByAccount: Record<string, boolean>;
}

export function applyPublicationBuildResult(
	result: PublicationBuildResult,
	currentSource: PostItem
): AppliedPublicationBuild {
	const maximumSegments = Math.max(
		1,
		...result.destinations.map((destination) => Math.max(1, destination.segments.length))
	);
	const threadSource = result.destinations.find(
		(destination) => destination.segments.length === maximumSegments
	);
	const posts = Array.from({ length: maximumSegments }, (_, index) => {
		const empty = index === 0 ? currentSource : makeEmptyPost();
		const content =
			maximumSegments === 1
				? result.canonical_text
				: (threadSource?.segments[index]?.body ?? (index === 0 ? result.canonical_text : ''));
		return {
			...empty,
			content,
			mediaIds: index === 0 ? [...currentSource.mediaIds] : []
		};
	});

	const variants: ThreadVariantMap = Object.fromEntries(
		result.destinations.map((destination) => [
			destination.account_id,
			Object.fromEntries(
				posts.map((post, index) => [
					post.key,
					{
						content: destination.segments[index]?.body ?? '',
						mediaIds: [...post.mediaIds],
						contentInherited: false,
						mediaInherited: true
					}
				])
			)
		])
	);

	return {
		posts,
		variants,
		requestedOutputProfiles: Object.fromEntries(
			result.destinations.map((destination) => [destination.account_id, destination.output_profile])
		),
		formatLockedByAccount: Object.fromEntries(
			result.destinations.map((destination) => [destination.account_id, true])
		)
	};
}
