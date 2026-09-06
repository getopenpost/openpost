export type AIWorkspaceEntry = 'ideate' | 'build';

export type AIWorkspaceStep = 'brief' | 'opportunities' | 'angles' | 'generating';

export interface AIOpportunity {
	id: string;
	title: string;
	premise: string;
	whyItFits?: string;
	objective?: string;
	mediaRecommendation?: string;
}

export interface AIAngle {
	id: string;
	title: string;
	premise: string;
	objective?: string;
	evidence?: string;
	mediaRecommendation?: string;
	recommended?: boolean;
	preservesCurrentAngle?: boolean;
}

export type AIGenerationPhaseStatus = 'pending' | 'active' | 'complete';

export interface AIGenerationPhase {
	id: string;
	label: string;
	status: AIGenerationPhaseStatus;
}

export interface AIOpportunityGridCopy {
	heading: string;
	description: string;
	whyItFits: string;
	bestFor: string;
	media: string;
	noMedia: string;
	loading: string;
	emptyTitle: string;
	emptyDescription: string;
	selected: string;
}

export interface AIAngleGridCopy {
	heading: string;
	description: string;
	loading: string;
	emptyTitle: string;
	emptyDescription: string;
	recommended: string;
	bestFor: string;
	evidence: string;
	media: string;
	noMedia: string;
	selected: string;
}

export interface AIGenerationProgressCopy {
	heading: string;
	description: string;
}

export interface AIWorkspaceDialogCopy {
	ideateTitle: string;
	ideateDescription: string;
	buildTitle: string;
	buildDescription: string;
	back: string;
	dismiss: string;
	getIdeas: string;
	continue: string;
	findMore: string;
	findingMore: string;
	buildDrafts: string;
	cancel: string;
	cancelling: string;
	retry: string;
	keepEdits: string;
	reviewApply: string;
	opportunities: AIOpportunityGridCopy;
	angles: AIAngleGridCopy;
	progress: AIGenerationProgressCopy;
}
