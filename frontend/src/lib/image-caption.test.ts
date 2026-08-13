import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImageAltText, resolveImageCaptionRetryContext } from './image-caption';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('$lib/api/client', () => ({
	client: { POST: mocks.post }
}));

describe('generateImageAltText', () => {
	beforeEach(() => {
		mocks.post.mockReset();
	});

	it('requests a localized caption with the relevant post context', async () => {
		const controller = new AbortController();
		const caption = {
			alt_text: 'Two people reviewing a design on a laptop.',
			generated: true,
			model: 'openai/gpt-5.6-luna'
		};
		mocks.post.mockResolvedValue({
			data: caption,
			error: undefined,
			response: new Response(null, { status: 200 })
		});

		await expect(
			generateImageAltText('media-1', {
				locale: 'pt-PT',
				postContext: '  A nossa equipa prepara o lançamento.  ',
				signal: controller.signal
			})
		).resolves.toEqual(caption);
		expect(mocks.post).toHaveBeenCalledWith('/media/{id}/alt-text/generate', {
			params: { path: { id: 'media-1' } },
			body: {
				locale: 'pt-PT',
				post_context: 'A nossa equipa prepara o lançamento.'
			},
			signal: controller.signal
		});
	});

	it('treats an unconfigured caption service as an optional feature', async () => {
		mocks.post.mockResolvedValue({
			data: undefined,
			error: { detail: 'automatic image captioning is not configured' },
			response: new Response(null, { status: 503 })
		});

		await expect(generateImageAltText('media-1', { locale: 'en-US' })).resolves.toBeNull();
	});

	it('bounds post context by Unicode character before sending it', async () => {
		mocks.post.mockResolvedValue({
			data: { alt_text: 'A launch graphic.', generated: true, model: 'test-model' },
			error: undefined,
			response: new Response(null, { status: 200 })
		});

		await generateImageAltText('media-1', {
			locale: 'en-US',
			postContext: ` ${'🙂'.repeat(1001)} `
		});

		const request = mocks.post.mock.calls[0][1];
		expect(Array.from(request.body.post_context)).toHaveLength(1000);
	});

	it('surfaces actionable provider failures', async () => {
		mocks.post.mockResolvedValue({
			data: undefined,
			error: { detail: 'image captioning is temporarily unavailable' },
			response: new Response(null, { status: 502 })
		});

		await expect(generateImageAltText('media-1', { locale: 'en-US' })).rejects.toThrow(
			'image captioning is temporarily unavailable'
		);
	});
});

describe('resolveImageCaptionRetryContext', () => {
	it('keeps the original context when the same image appears under different post text', () => {
		expect(
			resolveImageCaptionRetryContext(
				'Second thread segment where the image was added.',
				'First segment or a newly selected destination variant.'
			)
		).toBe('Second thread segment where the image was added.');
	});

	it('bounds the current context when no original request context is available', () => {
		expect(resolveImageCaptionRetryContext(undefined, ` ${'x'.repeat(1001)} `)).toHaveLength(1000);
	});
});
