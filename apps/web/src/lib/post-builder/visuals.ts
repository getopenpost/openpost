import type { ScreenshotDocument } from '@openpost/query-catalog';
import {
	createScreenshotDesign,
	exportScreenshotDesign,
	previewScreenshot
} from '$lib/screenshot-templates/api';
import { memeInput } from '$lib/screenshot-templates/meme';
import { memeGeneratorAPI, memePreviewDataURL } from '$lib/meme-generator/api';
import type { MediaUploadResult } from '$lib/media-upload-client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import { m } from '$lib/paraglide/messages';

export interface PostVisual {
	url: string;
	aspectRatio?: number;
	document: ScreenshotDocument;
}

export async function renderPostVisual(
	workspaceId: string,
	recipe: ScreenshotDocument,
	signal?: AbortSignal
): Promise<PostVisual> {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	if (recipe.meme) {
		const image = await memeGeneratorAPI.preview(memeInput(workspaceId, recipe.meme, signal));
		const url = memePreviewDataURL(image);
		return { url, document: recipe, aspectRatio: await dataURLAspectRatio(url) };
	}
	const image = await previewScreenshot(workspaceId, recipe, 2, signal);
	return { url: image.url, document: recipe, aspectRatio: image.width / image.height };
}

async function dataURLAspectRatio(url: string): Promise<number | undefined> {
	const bitmap = await createImageBitmap(await (await fetch(url)).blob());
	const ratio = bitmap.width / bitmap.height;
	bitmap.close();
	return ratio;
}

export function releasePostVisual(visual: PostVisual): void {
	if (visual.url.startsWith('blob:')) URL.revokeObjectURL(visual.url);
}

// The server renders and saves every visual at publishing size, memes
// included, and keeps the editable design linked to the saved media.
export async function savePostVisual(
	workspaceId: string,
	visual: Pick<PostVisual, 'document'>,
	altText: string
): Promise<MediaUploadResult> {
	if (workspaceCtx.currentWorkspace?.id !== workspaceId)
		throw new Error(m.templates_workspace_changed());
	const design = await createScreenshotDesign(workspaceId, visual.document);
	return exportScreenshotDesign(design.id, design.revision, altText);
}

export async function renderOptionMedia(
	workspaceId: string,
	option: import('./client').PublicationPostOption,
	saved = new Map<string, string>(),
	signal?: AbortSignal
) {
	const rendered: Array<{ account_id: string; media_id: string }> = [];
	for (const destination of option.destinations) {
		const recipe = destination.media.document;
		if (!recipe) continue;
		const key = JSON.stringify(recipe);
		let id = saved.get(key);
		if (!id) {
			signal?.throwIfAborted();
			id = (
				await savePostVisual(workspaceId, { document: recipe }, destination.media.alt_text ?? '')
			).id;
			saved.set(key, id);
		}
		rendered.push({ account_id: destination.account_id, media_id: id });
	}
	return rendered;
}
