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
	MemeThumbnailInput,
	MemeThumbnailResult
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
	error: unknown,
	response: Response,
	fallback: string
): T {
	if (error || !data) {
		const problem = error as APIProblem | undefined;
		throw new MemeGeneratorRequestError(
			problem?.detail ?? problem?.title ?? fallback,
			response.status
		);
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

export async function getMemeThumbnail({
	workspaceId,
	templateId,
	signal
}: MemeThumbnailInput): Promise<MemeThumbnailResult> {
	const result = await client.GET('/memes/templates/{template_id}/thumbnail', {
		params: {
			path: { template_id: templateId },
			query: { workspace_id: workspaceId }
		},
		signal
	});
	return responseData(
		result.data,
		result.error,
		result.response,
		m.meme_generator_templates_failed()
	);
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
	return {
		workspace_id: input.workspaceId,
		template_id: input.templateId,
		captions: input.captions,
		overlay_media_ids: input.overlayMediaIds,
		format: input.format,
		...(input.altText ? { alt_text: input.altText } : {}),
		...(input.parentMediaId ? { parent_media_id: input.parentMediaId } : {})
	};
}

export async function previewMeme(input: MemeRecipeInput): Promise<MemePreviewResult> {
	const result = await client.POST('/memes/preview', {
		body: recipeBody(input),
		signal: input.signal
	});
	return responseData(
		result.data,
		result.error,
		result.response,
		m.meme_generator_preview_failed()
	);
}

export async function renderMeme(input: MemeRecipeInput): Promise<MemeRenderResult> {
	const result = await client.POST('/memes/render', {
		body: recipeBody(input),
		signal: input.signal
	});
	return responseData(result.data, result.error, result.response, m.meme_generator_render_failed());
}

export function memePreviewDataURL(result: MemePreviewResult | MemeThumbnailResult): string {
	if (!result.mime_type.startsWith('image/') || !result.data_base64) {
		throw new Error(m.meme_generator_preview_failed());
	}
	return `data:${result.mime_type};base64,${result.data_base64}`;
}

export const memeGeneratorAPI: MemeGeneratorAPI = {
	listTemplates: listMemeTemplates,
	thumbnail: getMemeThumbnail,
	suggest: suggestMemes,
	preview: previewMeme,
	render: renderMeme
};
