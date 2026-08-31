import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';
import type {
	MemeGeneratorAPI,
	MemePreviewResult,
	MemeRecipeInput,
	MemeRenderResult,
	MemeSuggestionCandidate,
	MemeSuggestionInput,
	MemeSuggestionResult,
	MemeTemplate,
	MemeTemplateListInput,
	MemeTemplateListResult,
	MemeThumbnailInput
} from './types';

interface APIProblem {
	detail?: string;
	title?: string;
}

export class MemeGeneratorRequestError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'MemeGeneratorRequestError';
		this.status = status;
	}
}

function responseData<T>(
	data: T | undefined,
	error: APIProblem | undefined,
	response: Response,
	fallback: string
): T {
	if (error || !data) {
		throw new MemeGeneratorRequestError(error?.detail ?? error?.title ?? fallback, response.status);
	}
	return data;
}

function normalizeTemplate(template: components['schemas']['Template']): MemeTemplate {
	return {
		...template,
		styles: template.styles ?? [],
		keywords: template.keywords ?? [],
		search_terms: template.search_terms ?? [],
		example: {
			...template.example,
			text: template.example.text ?? []
		}
	};
}

function normalizeCandidate(
	candidate: components['schemas']['MemeSuggestionCandidate']
): MemeSuggestionCandidate {
	return {
		...candidate,
		caption_lines: candidate.caption_lines ?? [],
		template: normalizeTemplate(candidate.template)
	};
}

export async function listMemeTemplates({
	workspaceId,
	query = '',
	limit = 40,
	signal
}: MemeTemplateListInput): Promise<MemeTemplateListResult> {
	const result = await client.GET('/memes/templates', {
		params: {
			query: {
				workspace_id: workspaceId,
				q: query.trim() || undefined,
				limit
			}
		},
		signal
	});
	const data = responseData(
		result.data,
		result.error,
		result.response,
		m.meme_generator_templates_failed()
	);
	return { ...data, templates: (data.templates ?? []).map(normalizeTemplate) };
}

export function memeThumbnailURL({
	workspaceId,
	templateId,
	catalogRevision
}: MemeThumbnailInput): string {
	const query = new URLSearchParams({ workspace_id: workspaceId });
	if (catalogRevision) query.set('catalog_revision', catalogRevision);
	return `/api/v1/memes/templates/${encodeURIComponent(templateId)}/thumbnail?${query.toString()}`;
}

export async function suggestMemes({
	workspaceId,
	idea,
	tone,
	language,
	count = 4,
	signal
}: MemeSuggestionInput): Promise<MemeSuggestionResult> {
	const result = await client.POST('/memes/suggestions', {
		body: {
			workspace_id: workspaceId,
			idea: idea.trim(),
			tone,
			language,
			count
		},
		signal
	});
	const data = responseData(
		result.data,
		result.error,
		result.response,
		m.meme_generator_suggestions_failed()
	);
	return { ...data, candidates: (data.candidates ?? []).map(normalizeCandidate) };
}

function recipeBody(input: MemeRecipeInput) {
	const body: components['schemas']['RenderMemeInputBody'] = {
		workspace_id: input.workspaceId,
		template_id: input.templateId,
		captions: input.captions,
		overlay_media_ids: input.overlayMediaIds,
		format: input.format
	};
	if (input.altText) body.alt_text = input.altText;
	if (input.parentMediaId) body.parent_media_id = input.parentMediaId;
	return body;
}

export async function previewMeme(input: MemeRecipeInput): Promise<MemePreviewResult> {
	const request = () =>
		client.POST('/memes/preview', {
			body: recipeBody(input),
			signal: input.signal
		});
	let result = await request();
	if (retryableMemePreviewStatus(result.response.status) && !input.signal?.aborted) {
		result = await request();
	}
	return responseData(
		result.data,
		result.error,
		result.response,
		m.meme_generator_preview_failed()
	);
}

function retryableMemePreviewStatus(status: number): boolean {
	return status === 503 || status === 504 || status === 524 || status === 529;
}

export async function renderMeme(input: MemeRecipeInput): Promise<MemeRenderResult> {
	const result = await client.POST('/memes/render', {
		body: recipeBody(input),
		signal: input.signal
	});
	return responseData(result.data, result.error, result.response, m.meme_generator_render_failed());
}

export function memePreviewDataURL(result: MemePreviewResult): string {
	if (!result.mime_type.startsWith('image/') || !result.data_base64) {
		throw new Error(m.meme_generator_preview_failed());
	}
	return `data:${result.mime_type};base64,${result.data_base64}`;
}

export const memeGeneratorAPI: MemeGeneratorAPI = {
	listTemplates: listMemeTemplates,
	thumbnailURL: memeThumbnailURL,
	suggest: suggestMemes,
	preview: previewMeme,
	render: renderMeme
};
