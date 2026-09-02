import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imageEditorQueryKeys } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { createImageEditorDesign, deleteImageEditorDesign, saveImageEditorBrandKit } from './api';
import type { ImageEditorBrandKit, ImageEditorDocumentResponse } from './types';

const mocks = { post: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.spyOn(client, 'POST').mockImplementation(mocks.post);
vi.spyOn(client, 'PUT').mockImplementation(mocks.put);
vi.spyOn(client, 'DELETE').mockImplementation(mocks.delete);

describe('Image Editor mutation cache reconciliation', () => {
	beforeEach(() => {
		queryClient.clear();
		mocks.post.mockReset();
		mocks.put.mockReset();
		mocks.delete.mockReset();
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
