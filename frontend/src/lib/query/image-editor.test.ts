import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import { queryClient } from './client';
import { createImageEditorQueryAPI, queryImageEditorMedia } from './image-editor';

const response = (status = 200) => new Response(null, { status });

describe('Image Editor query adapter', () => {
	const get = vi.fn();
	// SAFETY: The mock implements the only transport method exercised by this adapter test.
	const api = createImageEditorQueryAPI({ GET: get } as never);

	beforeEach(() => {
		queryClient.clear();
		get.mockReset();
	});

	it('forwards normalized design search, pagination, and cancellation', async () => {
		get.mockResolvedValue({
			data: { designs: [], total: 123, can_edit: true },
			error: null,
			response: response()
		});
		const controller = new AbortController();

		await expect(
			api.listDesigns(
				'workspace-a',
				{ search: 'launch', limit: 50, offset: 100 },
				controller.signal
			)
		).resolves.toEqual({ designs: [], total: 123, canEdit: true });
		expect(get).toHaveBeenCalledWith('/image-editor/designs', {
			params: {
				query: {
					workspace_id: 'workspace-a',
					search: 'launch',
					limit: 50,
					offset: 100
				}
			},
			signal: controller.signal
		});
	});

	it('normalizes nullable catalog fields', async () => {
		get.mockResolvedValue({
			data: {
				enabled: true,
				schema_version: 1,
				background_model_base_url: '/models',
				presets: [
					{
						key: 'square',
						name: 'Square',
						width_px: 1080,
						height_px: 1080,
						default_format: 'png',
						profiles: null
					}
				]
			},
			error: null,
			response: response()
		});

		await expect(api.getConfig(new AbortController().signal)).resolves.toMatchObject({
			presets: [{ profiles: [] }]
		});
	});

	it('routes every remaining cache-safe Image Editor read through the typed transport', async () => {
		const signal = new AbortController().signal;

		get.mockResolvedValueOnce({
			data: { id: 'design-1', workspace_id: 'workspace-a' },
			error: null,
			response: response()
		});
		await api.getDesign('workspace-a', 'design-1', signal);
		expect(get).toHaveBeenLastCalledWith('/image-editor/designs/{id}', {
			params: { path: { id: 'design-1' } },
			signal
		});

		get.mockResolvedValueOnce({ data: { templates: [] }, error: null, response: response() });
		await api.listTemplates('workspace-a', signal);
		expect(get).toHaveBeenLastCalledWith('/image-editor/templates', {
			params: { query: { workspace_id: 'workspace-a' } },
			signal
		});

		get.mockResolvedValueOnce({ data: { templates: [] }, error: null, response: response() });
		await api.listPublicTemplates(signal);
		expect(get).toHaveBeenLastCalledWith('/image-editor/public-templates', { signal });

		get.mockResolvedValueOnce({
			data: {
				workspace_id: 'workspace-a',
				colors: null,
				text_styles: null,
				backgrounds: null,
				fonts: null
			},
			error: null,
			response: response()
		});
		await expect(api.getBrandKit('workspace-a', signal)).resolves.toMatchObject({
			colors: [],
			text_styles: [],
			backgrounds: [],
			fonts: []
		});
		expect(get).toHaveBeenLastCalledWith('/image-editor/brand-kit', {
			params: { query: { workspace_id: 'workspace-a' } },
			signal
		});

		get.mockResolvedValueOnce({
			data: { revisions: [], next_cursor: null },
			error: null,
			response: response()
		});
		await api.listRevisions('workspace-a', 'design-1', { cursor: 'next', limit: 25 }, signal);
		expect(get).toHaveBeenLastCalledWith('/image-editor/designs/{id}/revisions', {
			params: { path: { id: 'design-1' }, query: { cursor: 'next', limit: 25 } },
			signal
		});

		get.mockResolvedValueOnce({
			data: { summary: { id: 'revision-1' } },
			error: null,
			response: response()
		});
		await api.getRevision('workspace-a', 'design-1', 'revision-1', signal);
		expect(get).toHaveBeenLastCalledWith('/image-editor/designs/{id}/revisions/{revision_id}', {
			params: { path: { id: 'design-1', revision_id: 'revision-1' } },
			signal
		});
	});

	it('reuses the canonical media-list cache on revisit', async () => {
		// SAFETY: The mocked response contains the complete fields consumed by the media-list adapter.
		const clientGet = vi.spyOn(client, 'GET').mockResolvedValue({
			data: { media: [], total: 0 },
			error: null,
			response: response()
		} as never);

		await queryImageEditorMedia('workspace-a', 'launch');
		await queryImageEditorMedia('workspace-a', 'launch');

		expect(clientGet).toHaveBeenCalledTimes(1);
		clientGet.mockRestore();
	});
});
