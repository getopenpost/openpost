import type { components } from '$lib/api/types';

export type MemeTone = 'balanced' | 'dry' | 'sarcastic' | 'playful';

type APIMemeTemplate = components['schemas']['Template'];
type APIMemeTemplateExample = components['schemas']['TemplateExample'];
type APIMemeSuggestionCandidate = components['schemas']['MemeSuggestionCandidate'];

export interface MemeTemplateExample extends Omit<APIMemeTemplateExample, 'text'> {
	text: string[];
}

export interface MemeTemplate extends Omit<
	APIMemeTemplate,
	'example' | 'keywords' | 'search_terms' | 'styles'
> {
	example: MemeTemplateExample;
	keywords: string[];
	search_terms: string[];
	styles: string[];
}

export interface MemeTemplateListInput {
	workspaceId: string;
	query?: string;
	limit?: number;
	signal?: AbortSignal;
}

export interface MemeTemplateListResult extends Omit<
	components['schemas']['ListMemeTemplatesOutputBody'],
	'templates'
> {
	templates: MemeTemplate[];
}

export interface MemeThumbnailInput {
	workspaceId: string;
	templateId: string;
	signal?: AbortSignal;
}

export type MemeThumbnailResult = components['schemas']['GetMemeTemplateThumbnailOutputBody'];

export interface MemeSuggestionCandidate extends Omit<
	APIMemeSuggestionCandidate,
	'caption_lines' | 'template'
> {
	caption_lines: string[];
	template: MemeTemplate;
}

export interface MemeSuggestionInput {
	workspaceId: string;
	idea: string;
	tone: MemeTone;
	language: string;
	count?: number;
	signal?: AbortSignal;
}

export interface MemeSuggestionResult extends Omit<
	components['schemas']['GenerateMemeSuggestionsOutputBody'],
	'candidates'
> {
	candidates: MemeSuggestionCandidate[];
}

export interface MemeRecipeInput {
	workspaceId: string;
	templateId: string;
	captions: string[];
	overlayMediaIds: string[];
	format: 'png' | 'webp' | 'gif';
	altText?: string;
	parentMediaId?: string;
	signal?: AbortSignal;
}

export type MemePreviewResult = components['schemas']['PreviewMemeOutputBody'];
export type MemeRecipe = components['schemas']['MemeRecipeDocument'];
export type MemeRecipeResponse = components['schemas']['MemeRecipeResponse'];
export type MemeRenderResult = components['schemas']['RenderMemeOutputBody'];

export interface MemeOverlaySelection {
	media_id: string;
	preview_url: string;
	name: string;
}

export interface MemeGeneratorAPI {
	listTemplates(input: MemeTemplateListInput): Promise<MemeTemplateListResult>;
	thumbnail(input: MemeThumbnailInput): Promise<MemeThumbnailResult>;
	suggest(input: MemeSuggestionInput): Promise<MemeSuggestionResult>;
	preview(input: MemeRecipeInput): Promise<MemePreviewResult>;
	render(input: MemeRecipeInput): Promise<MemeRenderResult>;
}
