import { afterEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/client', () => ({ client: { POST: post } }));

import { LivePreviewError } from '$lib/live-preview.svelte';
import { newDocument } from './document';
import { previewScreenshot } from './api';

afterEach(() => post.mockReset());

describe('previewScreenshot', () => {
	it('returns a data URL, size and regions from the server preview', async () => {
		post.mockResolvedValue({
			data: {
				mime_type: 'image/jpeg',
				data_base64: 'QUJD',
				width: 1080,
				height: 1400,
				scale: 2,
				regions: [{ id: 'm1', x: 1, y: 2, width: 3, height: 4 }]
			},
			response: new Response(null, { status: 200 })
		});
		const image = await previewScreenshot('w1', newDocument('messages'), 2);
		expect(image.url).toBe('data:image/jpeg;base64,QUJD');
		expect(image.regions[0].id).toBe('m1');
	});

	it('surfaces a 422 as a LivePreviewError with the status and detail', async () => {
		post.mockResolvedValue({
			error: { detail: 'too tall' },
			response: new Response(null, { status: 422 })
		});
		const failure = previewScreenshot('w1', newDocument('messages'), 2);
		await expect(failure).rejects.toBeInstanceOf(LivePreviewError);
		await expect(failure).rejects.toMatchObject({ status: 422, message: 'too tall' });
	});
});
