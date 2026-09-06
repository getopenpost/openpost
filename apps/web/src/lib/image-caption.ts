import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';

export type ImageCaptionResult = components['schemas']['GenerateMediaAltTextOutputBody'];

export type ImageCaptionOptions = {
	locale: string;
	postContext?: string;
	signal?: AbortSignal;
};

export const MAX_IMAGE_CAPTION_POST_CONTEXT_CHARACTERS = 1000;

export function boundImageCaptionPostContext(value: string): string {
	return Array.from(value.trim()).slice(0, MAX_IMAGE_CAPTION_POST_CONTEXT_CHARACTERS).join('');
}

export function resolveImageCaptionRetryContext(
	storedContext: string | undefined,
	currentContext: string
): string {
	return storedContext ?? boundImageCaptionPostContext(currentContext);
}

export async function generateImageAltText(
	mediaID: string,
	options: ImageCaptionOptions
): Promise<ImageCaptionResult | null> {
	const postContext = boundImageCaptionPostContext(options.postContext ?? '');
	const body: components['schemas']['GenerateMediaAltTextInputBody'] = {
		locale: options.locale
	};
	if (postContext) body.post_context = postContext;
	const { data, error, response } = await client.POST('/media/{id}/alt-text/generate', {
		params: { path: { id: mediaID } },
		body,
		signal: options.signal
	});

	if (response.status === 503 && error?.detail === 'automatic image captioning is not configured') {
		return null;
	}
	if (error || !data) {
		throw new Error(error?.detail ?? 'OpenPost could not generate image alt text.');
	}
	return data;
}
