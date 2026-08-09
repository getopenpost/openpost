import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import {
	getMemeThumbnail,
	listMemeTemplates,
	memePreviewDataURL,
	previewMeme,
	renderMeme,
	suggestMemes
} from './api';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('$lib/api/client', () => ({
	client: { GET: mocks.get, POST: mocks.post }
}));

describe('meme generator API', () => {
	beforeEach(() => {
		mocks.get.mockReset();
		mocks.post.mockReset();
		setLocale('en', { reload: false });
	});

	it('loads a bounded searchable template catalog', async () => {
		const response = { templates: [], configured: true, ai_configured: true };
		mocks.get.mockResolvedValue({
			data: response,
			response: new Response(null, { status: 200 })
		});

		await expect(
			listMemeTemplates({ workspaceId: 'workspace-1', query: '  drake  ' })
		).resolves.toEqual(response);
		expect(mocks.get).toHaveBeenCalledWith('/memes/templates', {
			params: { query: { workspace_id: 'workspace-1', q: 'drake', limit: 40 } },
			signal: undefined
		});
	});

	it('loads template images through the authenticated OpenPost thumbnail route', async () => {
		const thumbnail = {
			template_id: 'drake',
			mime_type: 'image/png',
			data_base64: 'aW1hZ2U='
		};
		mocks.get.mockResolvedValue({
			data: thumbnail,
			response: new Response(null, { status: 200 })
		});

		await expect(
			getMemeThumbnail({ workspaceId: 'workspace-1', templateId: 'drake' })
		).resolves.toEqual(thumbnail);
		expect(mocks.get).toHaveBeenCalledWith('/memes/templates/{template_id}/thumbnail', {
			params: {
				path: { template_id: 'drake' },
				query: { workspace_id: 'workspace-1' }
			},
			signal: undefined
		});
	});

	it('requests structured AI candidates with an explicit tone and language', async () => {
		mocks.post.mockResolvedValue({
			data: { candidates: [] },
			response: new Response(null, { status: 200 })
		});

		await suggestMemes({
			workspaceId: 'workspace-1',
			idea: '  the deploy passed locally  ',
			tone: 'dry',
			language: 'en',
			count: 4
		});

		expect(mocks.post).toHaveBeenCalledWith('/memes/suggestions', {
			body: {
				workspace_id: 'workspace-1',
				idea: 'the deploy passed locally',
				tone: 'dry',
				language: 'en',
				count: 4
			},
			signal: undefined
		});
	});

	it('keeps preview bytes in the response instead of exposing the renderer', async () => {
		mocks.post.mockResolvedValue({
			data: { mime_type: 'image/webp', data_base64: 'bWVtZQ==' },
			response: new Response(null, { status: 200 })
		});

		const result = await previewMeme({
			workspaceId: 'workspace-1',
			templateId: 'fry',
			captions: ['not sure if', 'a unit test'],
			overlayMediaIds: [],
			format: 'webp'
		});

		expect(memePreviewDataURL(result)).toBe('data:image/webp;base64,bWVtZQ==');
		expect(mocks.post).toHaveBeenCalledWith('/memes/preview', {
			body: {
				workspace_id: 'workspace-1',
				template_id: 'fry',
				captions: ['not sure if', 'a unit test'],
				overlay_media_ids: [],
				format: 'webp'
			},
			signal: undefined
		});
	});

	it('surfaces a render failure that explains the recovery', async () => {
		mocks.post.mockResolvedValue({
			error: { detail: 'The meme renderer is temporarily unavailable.' },
			response: new Response(null, { status: 503 })
		});

		await expect(
			renderMeme({
				workspaceId: 'workspace-1',
				templateId: 'fry',
				captions: ['one', 'two'],
				overlayMediaIds: [],
				format: 'webp'
			})
		).rejects.toMatchObject({
			message: 'The meme renderer is temporarily unavailable.',
			status: 503
		});
	});

	it('localizes client-side fallback errors when the server returns no problem detail', async () => {
		setLocale('pt', { reload: false });
		mocks.get.mockResolvedValue({
			response: new Response(null, { status: 502 })
		});

		await expect(listMemeTemplates({ workspaceId: 'workspace-1' })).rejects.toMatchObject({
			message: 'O OpenPost não conseguiu carregar o catálogo de modelos do Memegen.',
			status: 502
		});
	});
});
