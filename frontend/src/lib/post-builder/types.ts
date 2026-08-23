export type PostBuilderMode = 'source' | 'discover';

export type PostBuilderCreationMode = 'builder' | 'manual';

export type PostBuilderSourceKind =
	| 'text'
	| 'link'
	| 'image'
	| 'video'
	| 'audio'
	| 'document'
	| 'note';

export type PostBuilderSourceStatus = 'ready' | 'processing' | 'failed';

export interface PostBuilderSource {
	id: string;
	kind: PostBuilderSourceKind;
	label: string;
	url?: string;
	detail?: string;
	status?: PostBuilderSourceStatus;
	error?: string;
	removable?: boolean;
	role?: 'context' | 'evidence' | 'artifact';
	mayPublish?: boolean;
}

export interface PostBuilderStarterIdea {
	id: string;
	text: string;
	example?: string;
}

export interface PostBuilderOpportunityAngle {
	id: string;
	label: string;
	description?: string;
}

export interface PostBuilderOpportunityTreatment {
	platform: string;
	label: string;
}

export interface PostBuilderOpportunity {
	id: string;
	title: string;
	summary: string;
	whyRelevant?: string;
	sourceLabel?: string;
	sourceURL?: string;
	sourceURLs?: string[];
	publishedAt?: string;
	angles?: PostBuilderOpportunityAngle[];
	treatments?: PostBuilderOpportunityTreatment[];
}

export type PostBuilderResearchMode = 'auto' | 'off' | 'required';

export type PostBuilderDestinationStrategy = 'recommend' | 'require_all';

export interface PostBuilderDirection {
	goal?: string;
	audience?: string;
	angle?: string;
	tone?: string;
	media?: string;
	length?: string;
	research?: PostBuilderResearchMode;
	destinationStrategy?: PostBuilderDestinationStrategy;
}

export interface CreatePostBuilderRunInput {
	workspaceId: string;
	mode: PostBuilderMode;
	sourceText: string;
	contextUrls: string[];
	assets: PostBuilderAssetInput[];
	opportunityId?: string;
	opportunityAngleId?: string;
	socialSetId?: string;
	accountIds: string[];
	voiceProfileId?: string;
	direction: PostBuilderDirection;
}

export interface PostBuilderAssetInput {
	mediaId: string;
	role: 'context' | 'evidence' | 'artifact';
	mayPublish: boolean;
}

export type PostBuilderRunPhase =
	| 'queued'
	| 'understanding'
	| 'planning'
	| 'drafting'
	| 'reviewing'
	| 'preparing_media'
	| 'opening_composer'
	| 'ready'
	| 'failed'
	| 'cancelled';

export interface PostBuilderRunError {
	message: string;
	code?: string;
}

export type PostBuilderDestinationDecisionStatus = 'included' | 'skipped' | 'needs_review';

export interface PostBuilderDestinationDecision {
	accountId: string;
	platform: string;
	accountLabel: string;
	status: PostBuilderDestinationDecisionStatus;
	reason?: string;
	formatLabel?: string;
	objective?: string;
	archetype?: string;
	preview?: string;
	mediaTreatment?: string;
}

export type PostBuilderClaimStatus =
	| 'supported'
	| 'user_asserted'
	| 'opinion'
	| 'parody'
	| 'needs_verification';

export interface PostBuilderClaim {
	id: string;
	text: string;
	status: PostBuilderClaimStatus;
	sourceLabel?: string;
}

export interface PostBuilderMediaPlanItem {
	id: string;
	accountId?: string;
	platform?: string;
	label: string;
	treatment?: string;
	brief?: string;
	action?: 'meme' | 'image_editor' | 'video_editor';
	sourceMediaId?: string;
	sourceLabel?: string;
	status?: 'planned' | 'generating' | 'ready' | 'skipped';
}

export interface PostBuilderResult {
	publicationId: string;
	thesis: string;
	angle?: string;
	goal?: string;
	audience?: string;
	voiceLabel?: string;
	destinationDecisions: PostBuilderDestinationDecision[];
	claims?: PostBuilderClaim[];
	mediaPlan?: PostBuilderMediaPlanItem[];
}

export interface PostBuilderRun {
	id: string;
	phase: PostBuilderRunPhase;
	progress?: number;
	message?: string;
	updatedAt?: string;
	canCancel?: boolean;
	canRetry?: boolean;
	error?: PostBuilderRunError;
	result?: PostBuilderResult;
}

export interface PostBuilderCommitResult {
	publicationId: string;
	href?: string;
}

export interface PostBuilderClientOptions {
	signal?: AbortSignal;
}

export interface PostBuilderClient {
	create(
		input: CreatePostBuilderRunInput,
		options?: PostBuilderClientOptions
	): Promise<PostBuilderRun>;
	load(runId: string, options?: PostBuilderClientOptions): Promise<PostBuilderRun>;
	cancel(runId: string, options?: PostBuilderClientOptions): Promise<PostBuilderRun>;
	retry(runId: string, options?: PostBuilderClientOptions): Promise<PostBuilderRun>;
	commit(runId: string, options?: PostBuilderClientOptions): Promise<PostBuilderCommitResult>;
}

export interface PostBuilderControlContext {
	disabled: boolean;
}

export interface PostBuilderCopy {
	pageTitle: string;
	pageDescription: string;
	builderMode: string;
	manualMode: string;
	creationModeLabel: string;
	builderInputModeLabel: string;
	fromSourceMode: string;
	discoverMode: string;
	builderInputHeading: string;
	builderInputDescription: string;
	sourcePlaceholder: string;
	attach: string;
	pasteLink: string;
	record: string;
	addContext: string;
	removeSource: string;
	sourceMaterialLabel: string;
	voice: string;
	destinations: string;
	direction: string;
	buildPost: string;
	buildOpportunity: string;
	buildingPost: string;
	privacyNote: string;
	whatHappensHeading: string;
	whatHappensSteps: [string, string, string, string];
	inspirationHeading: string;
	inspirationDescription: string;
	loadMoreIdeas: string;
	discoverHeading: string;
	discoverDescription: string;
	discoverEmptyTitle: string;
	discoverEmptyDescription: string;
	refreshDiscover: string;
	loadMoreOpportunities: string;
	loadingOpportunities: string;
	whyThisFits: string;
	possibleAngles: string;
	chooseAngle: string;
	selectedAngle: string;
	recommendedTreatment: string;
	selectOpportunity: string;
	selectedOpportunity: string;
	buildProgressHeading: string;
	reviewingDraft: string;
	buildCancelled: string;
	cancelBuild: string;
	retryBuild: string;
	resultHeading: string;
	resultDescription: string;
	coreThesis: string;
	reviewInComposer: string;
	openingComposer: string;
	buildAnother: string;
	angle: string;
	goal: string;
	audience: string;
	voiceUsed: string;
	destinationPlan: string;
	claimReview: string;
	mediaPlan: string;
	makeMeme: string;
	createVisual: string;
	annotateSource: string;
	createVideo: string;
	editVideo: string;
	preparingMedia: string;
	evidenceOnly: string;
	mayPublish: string;
	included: string;
	skipped: string;
	needsReview: string;
	supported: string;
	userAsserted: string;
	opinion: string;
	parody: string;
	needsVerification: string;
	noClaimsNeedReview: string;
	workspaceRequired: string;
	sourceRequired: string;
	opportunityRequired: string;
	destinationsRequired: string;
	requestFailed: string;
	dismissError: string;
	builderHelpLabel: string;
	footerNote: string;
}
