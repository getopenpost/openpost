import type { MemeSuggestionCandidate } from '$lib/meme-generator/types';

export type AIMemePreviewState = 'idle' | 'loading' | 'ready' | 'failed';

export interface AIMemeRecommendationCandidate {
	id: string;
	suggestion: MemeSuggestionCandidate;
	previewUrl?: string;
	previewState?: AIMemePreviewState;
}

export interface AIMemeRecommendationCopy {
	title: string;
	description: string;
	recommendedLabel: string;
	alternativesLabel: string;
	useLabel: string;
	usingLabel: string;
	editLabel: string;
	editingLabel: string;
	retryLabel: string;
	retryingLabel: string;
	previewLoading: string;
	previewUnavailable: string;
	emptyTitle: string;
	emptyDescription: string;
	actionFailed: string;
	selectAlternative: (templateName: string, position: number) => string;
}
