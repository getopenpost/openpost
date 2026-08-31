import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { parseDraftConflict } from '$lib/draft-conflict';
import {
	ComposerClientError,
	type ComposerPublicationClient,
	type PublicationDraft
} from './session';

type Publication = components['schemas']['PublicationResponse'];
type CreatePublication = components['schemas']['CreatePublicationBody'];
type PublicationUpdate = components['schemas']['PublicationUpdateBody'];
type PublicationSegmentInput = components['schemas']['PublicationSegmentInput'];
type PublicationMediaInput = components['schemas']['PublicationMediaInput'];
type RenditionInput = components['schemas']['RenditionInput'];
type RenditionSegmentInput = components['schemas']['RenditionSegmentInput'];
type Problem = components['schemas']['ErrorModel'];

export function createComposerPublicationClient(): ComposerPublicationClient {
	return {
		async load(publicationId) {
			const { data, error, response } = await client.GET('/publications/{id}', {
				params: { path: { id: publicationId } }
			});
			if (error || !data) throw clientError(error, response.status);
			return { publication: data, draft: publicationDraft(data) };
		},

		async create(workspaceId, draft) {
			const { data, error, response } = await client.POST('/publications', {
				body: { ...draft, workspace_id: workspaceId }
			});
			if (error || !data) throw clientError(error, response.status);
			return { ...data, draft: publicationDraft(data) };
		},

		async update(publicationId, expectedRevision, draft) {
			const { data, error, response } = await client.PUT('/publications/{id}', {
				params: { path: { id: publicationId } },
				body: publicationUpdate(draft, expectedRevision)
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async validate(publicationId) {
			const { data, error, response } = await client.POST('/publications/{id}/validate', {
				params: { path: { id: publicationId } }
			});
			if (error || !data) throw clientError(error, response.status);
			return { issues: data.issues ?? [] };
		},

		async schedule(publicationId, expectedRevision) {
			const { data, error, response } = await client.POST('/publications/{id}/schedule', {
				params: { path: { id: publicationId } },
				body: { expected_revision: expectedRevision }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async publishNow(publicationId, expectedRevision) {
			const { data, error, response } = await client.POST('/publications/{id}/publish-now', {
				params: { path: { id: publicationId } },
				body: { expected_revision: expectedRevision }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async retry(publicationId, accountId, targetKey) {
			const { data, error, response } = await client.POST(
				'/publications/{id}/renditions/{account_id}/retry',
				{
					params: {
						path: { id: publicationId, account_id: accountId },
						query: targetKey ? { target_key: targetKey } : {}
					}
				}
			);
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async cancel(publicationId, expectedRevision) {
			const { data, error, response } = await client.POST('/publications/{id}/cancel', {
				params: { path: { id: publicationId } },
				body: { expected_revision: expectedRevision }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async delete(publicationId, expectedRevision) {
			const { error, response } = await client.DELETE('/publications/{id}', {
				params: {
					path: { id: publicationId },
					query: { confirm: true, expected_revision: expectedRevision }
				}
			});
			if (error) throw clientError(error, response.status);
		}
	};
}

export function publicationDraft(publication: Publication): PublicationDraft {
	const draft: PublicationDraft = {
		title: publication.title,
		creation_preset: parseCreationPreset(publication.creation_preset),
		intent: publication.intent,
		content_profile: publication.content_profile,
		source_text: publication.source_text,
		audience: publication.audience,
		goal: publication.goal,
		metadata: publication.metadata,
		media: mediaInput(publication.media),
		segments: (publication.segments ?? []).map(publicationSegmentInput),
		renditions: (publication.renditions ?? []).map(renditionInput),
		repost_override: publication.repost_override
	};
	if (publication.source_url) draft.source_url = publication.source_url;
	if (publication.social_set_id) draft.social_set_id = publication.social_set_id;
	if (publication.scheduled_at) draft.scheduled_at = publication.scheduled_at;
	if (!publication.random_delay_inherited) {
		draft.random_delay_minutes = publication.random_delay_minutes;
	}
	return draft;
}

export function publicationDraftCopy(publication: Publication): CreatePublication {
	const draft = publicationDraft(publication);
	delete draft.scheduled_at;
	delete draft.random_delay_minutes;

	// Canonical segment IDs are client references on create. The server replaces
	// them with fresh IDs and remaps rendition segment references in one transaction.
	return {
		...draft,
		workspace_id: publication.workspace_id,
		renditions: (draft.renditions ?? []).map((rendition) => {
			const copy = { ...rendition };
			delete copy.id;
			delete copy.schedule_override;
			copy.segments = (copy.segments ?? []).map((segment) => {
				const segmentCopy = { ...segment };
				delete segmentCopy.id;
				return segmentCopy;
			});
			return copy;
		})
	};
}

function publicationUpdate(draft: PublicationDraft, expectedRevision: number): PublicationUpdate {
	const update: PublicationUpdate = {
		expected_revision: expectedRevision,
		title: draft.title,
		creation_preset: draft.creation_preset,
		intent: draft.intent,
		content_profile: draft.content_profile,
		social_set_id: draft.social_set_id ?? '',
		source_text: draft.source_text,
		source_url: draft.source_url ?? '',
		audience: draft.audience,
		goal: draft.goal,
		metadata: draft.metadata,
		segments: draft.segments,
		renditions: draft.renditions,
		repost_override: draft.repost_override
	};
	if (draft.scheduled_at) {
		update.scheduled_at = draft.scheduled_at;
		update.clear_schedule = false;
	} else {
		update.clear_schedule = true;
	}
	if (draft.random_delay_minutes === undefined) {
		update.inherit_random_delay = true;
	} else {
		update.random_delay_minutes = draft.random_delay_minutes;
	}
	return update;
}

function publicationSegmentInput(
	segment: NonNullable<Publication['segments']>[number]
): PublicationSegmentInput {
	const input: PublicationSegmentInput = {
		id: segment.id,
		body: segment.body,
		title: segment.title,
		description: segment.description,
		settings: segment.settings,
		media: mediaInput(segment.media)
	};
	if (segment.url) input.url = segment.url;
	return input;
}

function renditionInput(rendition: NonNullable<Publication['renditions']>[number]): RenditionInput {
	const input: RenditionInput = {
		id: rendition.id,
		social_account_id: rendition.social_account_id,
		target_key: rendition.target_key,
		profile: rendition.profile,
		output_profile: rendition.output_profile,
		format_locked: rendition.format_locked,
		body: rendition.body,
		title: rendition.title,
		description: rendition.description,
		settings: rendition.settings,
		media: mediaInput(rendition.media),
		segments: (rendition.segments ?? []).map(renditionSegmentInput)
	};
	if (rendition.schedule_override) input.schedule_override = rendition.schedule_override;
	return input;
}

function renditionSegmentInput(
	segment: NonNullable<NonNullable<Publication['renditions']>[number]['segments']>[number]
): RenditionSegmentInput {
	const input: RenditionSegmentInput = {
		id: segment.id,
		publication_segment_id: segment.publication_segment_id,
		body: segment.body,
		title: segment.title,
		description: segment.description,
		media_inherited: segment.media_inherited,
		settings: segment.settings,
		media: mediaInput(segment.media)
	};
	if (segment.body_override !== undefined) input.body_override = segment.body_override;
	if (segment.title_override !== undefined) input.title_override = segment.title_override;
	if (segment.description_override !== undefined) {
		input.description_override = segment.description_override;
	}
	if (segment.url) input.url = segment.url;
	if (segment.url_override !== undefined) input.url_override = segment.url_override;
	return input;
}

function mediaInput(media: Publication['media']): PublicationMediaInput[] {
	return (media ?? []).map((item) => {
		const input: PublicationMediaInput = { media_id: item.id };
		if (item.role) input.role = item.role;
		if (item.alt_text) input.alt_text = item.alt_text;
		if (item.thumbnail_timestamp_ms) {
			input.thumbnail_timestamp_ms = item.thumbnail_timestamp_ms;
		}
		if (item.settings && Object.keys(item.settings).length > 0) input.settings = item.settings;
		return input;
	});
}

function parseCreationPreset(value: string): PublicationDraft['creation_preset'] {
	switch (value) {
		case 'post':
		case 'thread':
		case 'story':
		case 'short_video':
		case 'video':
			return value;
		default:
			return undefined;
	}
}

function clientError(problem: Problem | undefined, status: number): ComposerClientError {
	const conflict = parseDraftConflict(problem);
	if (conflict) {
		return new ComposerClientError('conflict', conflict.detail, conflict.conflict.current_revision);
	}
	const message = problem?.detail || '';
	if (status === 403) return new ComposerClientError('access_denied', message);
	if (status === 404) return new ComposerClientError('not_found', message);
	if (status === 409) return new ComposerClientError('invalid_state', message);
	if (status === 422 || status === 400) return new ComposerClientError('invalid', message);
	return new ComposerClientError('unavailable', message);
}
