import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageEditorQueryKeys } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';
import {
	createImageEditorDesign,
	deleteImageEditorDesign,
	ImageEditorWorkspaceMismatchError,
	saveImageEditorBrandKit,
	saveImageEditorDesign
} from './api';
import type {
	ImageEditorBrandKit,
	ImageEditorDesignSummary,
	ImageEditorDocumentResponse
} from './types';

const mocks = { post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.spyOn(client, 'POST').mockImplementation(mocks.post);
vi.spyOn(client, 'PUT').mockImplementation(mocks.put);
vi.spyOn(client, 'PATCH').mockImplementation(mocks.patch);
vi.spyOn(client, 'DELETE').mockImplementation(mocks.delete);

describe('Image Editor mutation cache reconciliation', () => {
	beforeEach(() => {
		queryClient.clear();
		mocks.post.mockReset();
		mocks.put.mockReset();
		mocks.patch.mockReset();
		mocks.delete.mockReset();
	});

	afterEach(() => {
		registerQueryAuthorizationBoundary(undefined);
	});

	it('does not restore an old actor cache after logout clears it', async () => {
		const oldIdentity = { userID: 'user-old', epoch: 1 };
		let activeIdentity = oldIdentity;
		const restoreBoundary = registerQueryAuthorizationBoundary({
			captureIdentity: () => activeIdentity,
			isIdentityCurrent: (identity) => identity === activeIdentity,
			settleUnauthorized: vi.fn()
		});
		let resolveCreate!: (value: { data: ImageEditorDocumentResponse; response: Response }) => void;
		mocks.post.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCreate = resolve;
				})
		);
		const request = createImageEditorDesign('workspace-1', { preset_key: 'square' });
		await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

		activeIdentity = { userID: 'user-new', epoch: 2 };
		queryClient.clear();
		const newActorKey = imageEditorQueryKeys.design('workspace-2', 'new-design');
		queryClient.setQueryData(newActorKey, designFixture('workspace-2'));
		resolveCreate({
			data: designFixture(),
			response: new Response(null, { status: 201 })
		});
		await request;
		restoreBoundary();

		expect(
			queryClient.getQueryData(imageEditorQueryKeys.design('workspace-1', 'design-1'))
		).toBeUndefined();
		expect(queryClient.getQueryData(newActorKey)).toBeDefined();
	});

	it('cancels stale detail and list reads before saving the accepted design', async () => {
		const stale = designFixture();
		const saved = {
			...stale,
			revision: 2,
			updated_at: '2026-09-01T10:05:00Z',
			document: { ...stale.document, title: 'Accepted title' }
		};
		const detailKey = imageEditorQueryKeys.design('workspace-1', stale.id);
		const listKey = imageEditorQueryKeys.designList('workspace-1', {});
		queryClient.setQueryData(detailKey, stale);
		queryClient.setQueryData(listKey, {
			designs: [designSummary(stale)],
			total: 1,
			canEdit: true
		});
		const signals: AbortSignal[] = [];
		const staleDetail = queryClient
			.fetchQuery({
				queryKey: detailKey,
				staleTime: 0,
				queryFn: async ({ signal }) => {
					signals.push(signal);
					await new Promise<void>((resolve) => {
						signal.addEventListener('abort', () => resolve(), { once: true });
					});
					return stale;
				}
			})
			.catch(() => undefined);
		const staleList = queryClient
			.fetchQuery({
				queryKey: listKey,
				staleTime: 0,
				queryFn: async ({ signal }) => {
					signals.push(signal);
					await new Promise<void>((resolve) => {
						signal.addEventListener('abort', () => resolve(), { once: true });
					});
					return { designs: [designSummary(stale)], total: 1, canEdit: true };
				}
			})
			.catch(() => undefined);
		await vi.waitFor(() => expect(signals).toHaveLength(2));
		mocks.patch.mockResolvedValue({
			data: saved,
			response: new Response(null, { status: 200 })
		});

		await saveImageEditorDesign('workspace-1', stale.id, stale.revision, saved.document);
		await Promise.all([staleDetail, staleList]);

		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(queryClient.getQueryData(detailKey)).toEqual(saved);
		expect(
			queryClient.getQueryData<{ designs: ImageEditorDesignSummary[] }>(listKey)?.designs[0]
		).toMatchObject({ title: 'Accepted title', revision: 2 });
	});

	it('rejects a mutation response from another Workspace before caching it', async () => {
		mocks.post.mockResolvedValue({
			data: designFixture('workspace-2'),
			response: new Response(null, { status: 201 })
		});

		await expect(
			createImageEditorDesign('workspace-1', { preset_key: 'square' })
		).rejects.toBeInstanceOf(ImageEditorWorkspaceMismatchError);
		expect(
			queryClient.getQueryData(imageEditorQueryKeys.design('workspace-1', 'design-1'))
		).toBeUndefined();
		expect(
			queryClient.getQueryData(imageEditorQueryKeys.design('workspace-2', 'design-1'))
		).toBeUndefined();
	});

	it('seeds a created design before navigation and invalidates Workspace lists', async () => {
		const design = designFixture();
		const listKey = imageEditorQueryKeys.designList('workspace-1', {});
		queryClient.setQueryData(listKey, { designs: [], total: 0, canEdit: true });
		mocks.post.mockResolvedValue({
			data: design,
			response: new Response(null, { status: 201 })
		});

		await createImageEditorDesign('workspace-1', { preset_key: 'square' });

		expect(queryClient.getQueryData(imageEditorQueryKeys.design('workspace-1', design.id))).toBe(
			design
		);
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
	});

	it('replaces the exact brand-kit cache after a save', async () => {
		const brandKit = brandKitFixture();
		mocks.put.mockResolvedValue({
			data: brandKit,
			response: new Response(null, { status: 200 })
		});

		const saved = await saveImageEditorBrandKit(brandKit);

		expect(saved).toEqual(brandKit);
		expect(queryClient.getQueryData(imageEditorQueryKeys.brandKit('workspace-1'))).toEqual(
			brandKit
		);
	});

	it('removes a deleted design and its revisions without touching another Workspace', async () => {
		const designKey = imageEditorQueryKeys.design('workspace-1', 'design-1');
		const revisionKey = imageEditorQueryKeys.revision('workspace-1', 'design-1', 'revision-1');
		const otherKey = imageEditorQueryKeys.design('workspace-2', 'design-1');
		queryClient.setQueryData(designKey, designFixture());
		queryClient.setQueryData(revisionKey, { summary: { id: 'revision-1' } });
		queryClient.setQueryData(otherKey, designFixture('workspace-2'));
		mocks.delete.mockResolvedValue({ response: new Response(null, { status: 204 }) });

		await deleteImageEditorDesign('workspace-1', 'design-1');

		expect(queryClient.getQueryData(designKey)).toBeUndefined();
		expect(queryClient.getQueryData(revisionKey)).toBeUndefined();
		expect(queryClient.getQueryData(otherKey)).toBeDefined();
	});
});

function designFixture(workspaceID = 'workspace-1'): ImageEditorDocumentResponse {
	return {
		id: 'design-1',
		workspace_id: workspaceID,
		created_by_id: 'user-1',
		revision: 1,
		can_edit: true,
		created_at: '2026-09-01T10:00:00Z',
		updated_at: '2026-09-01T10:00:00Z',
		document: {
			schema_version: 1,
			title: 'Launch',
			preset_key: 'square',
			width_px: 1080,
			height_px: 1080,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 0.9, matte_color: '#ffffff' },
			pages: []
		}
	};
}

function designSummary(design: ImageEditorDocumentResponse): ImageEditorDesignSummary {
	return {
		id: design.id,
		title: design.document.title,
		preset_key: design.document.preset_key,
		width_px: design.document.width_px,
		height_px: design.document.height_px,
		page_count: design.document.pages.length,
		revision: design.revision,
		is_favorite: false,
		created_at: design.created_at,
		updated_at: design.updated_at
	};
}

function brandKitFixture(): ImageEditorBrandKit {
	return {
		id: 'brand-1',
		workspace_id: 'workspace-1',
		name: 'OpenPost',
		revision: 2,
		exists: true,
		can_edit: true,
		colors: [],
		text_styles: [],
		backgrounds: [],
		fonts: []
	};
}
