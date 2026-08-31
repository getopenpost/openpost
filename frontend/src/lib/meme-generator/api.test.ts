import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import { setLocale } from '$lib/paraglide/runtime';
import {
	listMemeTemplates,
	memePreviewDataURL,
	memeThumbnailURL,
	previewMeme,
	renderMeme,
	suggestMemes
} from './api';

const mocks = { get: vi.fn(), post: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
vi.spyOn(client, 'POST').mockImplementation(mocks.post);

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

	it('gives the browser a revisioned raw thumbnail URL', () => {
		expect(
			memeThumbnailURL({
				workspaceId: 'workspace one',
				templateId: 'template/one',
				catalogRevision: 'sha256:catalog'
			})
		).toBe(
			'/api/v1/memes/templates/template%2Fone/thumbnail?workspace_id=workspace+one&catalog_revision=sha256%3Acatalog'
		);
		expect(mocks.get).not.toHaveBeenCalled();
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

	it('retries one transient preview failure', async () => {
		mocks.post
			.mockResolvedValueOnce({
				error: { detail: 'The meme preview failed.' },
				response: new Response(null, { status: 503 })
			})
			.mockResolvedValueOnce({
				data: { mime_type: 'image/png', data_base64: 'bWVtZQ==' },
				response: new Response(null, { status: 200 })
			});

		await expect(
			previewMeme({
				workspaceId: 'workspace-1',
				templateId: 'drake',
				captions: ['one', 'two'],
				overlayMediaIds: [],
				format: 'png'
			})
		).resolves.toMatchObject({ mime_type: 'image/png', data_base64: 'bWVtZQ==' });
		expect(mocks.post).toHaveBeenCalledTimes(2);
	});

	it('does not retry a preview after its request is aborted', async () => {
		const controller = new AbortController();
		mocks.post.mockImplementationOnce(async () => {
			controller.abort();
			return {
				error: { detail: 'The meme renderer is temporarily unavailable.' },
				response: new Response(null, { status: 503 })
			};
		});

		await expect(
			previewMeme({
				workspaceId: 'workspace-1',
				templateId: 'drake',
				captions: ['one', 'two'],
				overlayMediaIds: [],
				format: 'png',
				signal: controller.signal
			})
		).rejects.toMatchObject({ status: 503 });
		expect(mocks.post).toHaveBeenCalledTimes(1);
	});

	it('does not retry a deterministic preview failure', async () => {
		mocks.post.mockResolvedValue({
			error: { detail: 'The generated meme is too large to preview.' },
			response: new Response(null, { status: 502 })
		});

		await expect(
			previewMeme({
				workspaceId: 'workspace-1',
				templateId: 'drake',
				captions: ['one', 'two'],
				overlayMediaIds: [],
				format: 'png'
			})
		).rejects.toMatchObject({ status: 502 });
		expect(mocks.post).toHaveBeenCalledTimes(1);
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
			message: 'O OpenPost não conseguiu carregar o catálogo de modelos incluído.',
			status: 502
		});
	});
});
