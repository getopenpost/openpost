import type { ScreenshotDocument } from '@openpost/query-catalog';
import type { MemeTemplate, MemeRecipeInput } from '$lib/meme-generator/types';
export type Meme = NonNullable<ScreenshotDocument['meme']>;
export function memeDocument(
	template: MemeTemplate,
	captions = template.example.text,
	altText = ''
): ScreenshotDocument {
	return {
		schema_version: 1,
		template_id: 'meme',
		title: template.name,
		appearance: 'light',
		frame: 'natural',
		text_size: 'normal',
		meme: {
			template_id: template.id,
			name: template.name,
			captions: Array.from(
				{ length: Math.max(1, template.lines) },
				(_, index) => captions[index] ?? ''
			),
			overlay_slots: template.overlays,
			overlay_media_ids: [],
			format: template.animated ? 'gif' : 'png',
			alt_text: altText
		}
	};
}
export function memeInput(workspaceId: string, meme: Meme, signal?: AbortSignal): MemeRecipeInput {
	return {
		workspaceId,
		retentionClass: 'library',
		templateId: meme.template_id,
		captions: meme.captions,
		overlayMediaIds: meme.overlay_media_ids,
		format: meme.format,
		altText: meme.alt_text,
		parentMediaId: meme.parent_media_id,
		signal
	};
}
