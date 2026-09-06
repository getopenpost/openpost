import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPostQueryKeys, schedulingQueryKeys } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';
import { createComposerPublicationClient } from './publication-client';
import { ComposerClientError, type PublicationDraft } from './session';

type Publication = components['schemas']['PublicationResponse'];

const mocks = { post: vi.fn() };
vi.spyOn(client, 'POST').mockImplementation(mocks.post);

beforeEach(() => {
	queryClient.clear();
	mocks.post.mockReset();
});

afterEach(() => {
	registerQueryAuthorizationBoundary(undefined);
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

	it('cancels an older list before reconciling a successful mutation', async () => {
		const stale = publicationFixture();
		const current = { ...stale, revision: 2, title: 'Current title' };
		const listKey = schedulingQueryKeys.publications('workspace-1', { status: 'draft' });
		let resolveList!: (value: Publication[]) => void;
		let listSignal: AbortSignal | undefined;
		const listResponse = new Promise<Publication[]>((resolve) => {
			resolveList = resolve;
		});
		const pendingList = queryClient
			.fetchQuery({
				queryKey: listKey,
				queryFn: ({ signal }) => {
					listSignal = signal;
					return listResponse;
				}
			})
			.catch(() => undefined);
		await vi.waitFor(() => expect(listSignal).toBeInstanceOf(AbortSignal));
		mocks.post.mockResolvedValue({
			data: current,
			response: new Response(null, { status: 201 })
		});

		await createComposerPublicationClient('workspace-1').create('workspace-1', {
			title: 'Current title',
			content_profile: '',
			source_text: 'We shipped it.'
		});
		resolveList([stale]);
		await pendingList;

		expect(listSignal?.aborted).toBe(true);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
		expect(
			queryClient.getQueryData(openPostQueryKeys.publications.detail('workspace-1', current.id))
		).toEqual(current);
	});

	it('does not seed an old actor publication after their cache was cleared', async () => {
		const oldIdentity = { userID: 'user-old', epoch: 1 };
		let activeIdentity = oldIdentity;
		registerQueryAuthorizationBoundary({
			captureIdentity: () => activeIdentity,
			isIdentityCurrent: (identity) => identity === activeIdentity,
			settleUnauthorized: vi.fn()
		});
		let resolveCreate!: (value: { data: Publication; response: Response }) => void;
		mocks.post.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCreate = resolve;
				})
		);
		const request = createComposerPublicationClient('workspace-1').create('workspace-1', {
			title: 'Old actor draft',
			content_profile: '',
			source_text: 'Do not restore me.'
		});
		await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

		activeIdentity = { userID: 'user-new', epoch: 2 };
		queryClient.clear();
		const newActorKey = openPostQueryKeys.publications.detail('workspace-2', 'publication-new');
		queryClient.setQueryData(newActorKey, {
			...publicationFixture(),
			id: 'publication-new',
			workspace_id: 'workspace-2'
		});
		resolveCreate({
			data: publicationFixture(),
			response: new Response(null, { status: 201 })
		});
		await request;

		expect(
			queryClient.getQueryData(
				openPostQueryKeys.publications.detail('workspace-1', 'publication-1')
			)
		).toBeUndefined();
		expect(queryClient.getQueryData(newActorKey)).toBeDefined();
	});

	it('rejects a created publication returned for another Workspace', async () => {
		mocks.post.mockResolvedValue({
			data: { ...publicationFixture(), workspace_id: 'workspace-2' },
			response: new Response(null, { status: 201 })
		});

		await expect(
			createComposerPublicationClient('workspace-1').create('workspace-1', {
				title: 'Wrong Workspace',
				content_profile: '',
				source_text: 'Wrong response.'
			})
		).rejects.toEqual(
			expect.objectContaining<Partial<ComposerClientError>>({ category: 'not_found' })
		);
		expect(
			queryClient.getQueryData(
				openPostQueryKeys.publications.detail('workspace-1', 'publication-1')
			)
		).toBeUndefined();
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
