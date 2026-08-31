import type { components } from '$lib/api/types';
import type { PostItem, ThreadVariantMap } from '$lib/components/compose/draft-utils';

type GeneratedPost = Pick<
	components['schemas']['GeneratePostOutputBody'],
	'source_text' | 'renditions'
>;

export interface GeneratedPublicationDraft {
	sourcePost: PostItem;
	variants: ThreadVariantMap;
}

export function buildGeneratedPublicationDraft(
	generated: GeneratedPost,
	sourcePost: PostItem
): GeneratedPublicationDraft {
	const mediaIds = [...sourcePost.mediaIds];
	return {
		sourcePost: { ...sourcePost, content: generated.source_text, mediaIds },
		variants: Object.fromEntries(
			(generated.renditions ?? []).map((rendition) => [
				rendition.social_account_id,
				{
					[sourcePost.key]: {
						content: rendition.body,
						mediaIds: [...mediaIds],
						contentInherited: false,
						mediaInherited: true
					}
				}
			])
		)
	};
}
