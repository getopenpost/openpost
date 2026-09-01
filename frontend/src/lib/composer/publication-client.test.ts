import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPostQueryKeys, schedulingQueryKeys } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import { createComposerPublicationClient } from './publication-client';
import type { PublicationDraft } from './session';

type Publication = components['schemas']['PublicationResponse'];

const mocks = { post: vi.fn() };
vi.spyOn(client, 'POST').mockImplementation(mocks.post);

beforeEach(() => {
	queryClient.clear();
	mocks.post.mockReset();
});

describe('composer publication query cache', () => {
	it('seeds a created publication and invalidates every Workspace list', async () => {
		const publication = publicationFixture();
		const listKey = schedulingQueryKeys.publications('workspace-1', { status: 'draft' });
		queryClient.setQueryData(listKey, []);
		mocks.post.mockResolvedValue({
			data: publication,
			response: new Response(null, { status: 201 })
		});

		const draft: PublicationDraft = {
			title: 'Launch update',
			content_profile: '',
			source_text: 'We shipped it.'
		};
		await createComposerPublicationClient('workspace-1').create('workspace-1', draft);

		expect(
			queryClient.getQueryData(openPostQueryKeys.publications.detail('workspace-1', publication.id))
		).toBe(publication);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
	});

	it('invalidates the exact detail and every list after a publication action', async () => {
		const publication = publicationFixture();
		const detailKey = openPostQueryKeys.publications.detail('workspace-1', publication.id);
		const listKey = schedulingQueryKeys.publications('workspace-1', { status: 'scheduled' });
		queryClient.setQueryData(detailKey, publication);
		queryClient.setQueryData(listKey, [publication]);
		mocks.post.mockResolvedValue({
			data: { message: 'Scheduled', publication_id: publication.id, revision: 2 },
			response: new Response(null, { status: 200 })
		});

		await createComposerPublicationClient('workspace-1').schedule(publication.id, 1);

		expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
	});
});

function publicationFixture(): Publication {
	return {
		id: 'publication-1',
		workspace_id: 'workspace-1',
		title: 'Launch update',
		creation_preset: 'post',
		intent: 'post',
		content_profile: '',
		created_at: '2026-09-01T10:00:00Z',
		created_by: 'user-1',
		source_text: 'We shipped it.',
		metadata: {},
		media: [],
		segments: [],
		renditions: [],
		repost_override: { mode: 'inherit' },
		random_delay_inherited: true,
		random_delay_minutes: 0,
		revision: 1,
		status: 'draft',
		updated_at: '2026-09-01T10:00:00Z'
	};
}
