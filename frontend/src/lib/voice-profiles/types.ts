export interface VoiceProfileExample {
	text: string;
	platform?: string;
	whyItFits?: string;
}

export interface VoiceProfileCorrection {
	original: string;
	preferred: string;
	lesson?: string;
}

export interface VoiceProfileInterviewAnswer {
	question: string;
	answer: string;
}

export interface VoiceProfileDefinition {
	identitySummary: string;
	preferredLanguage: string;
	traits: string[];
	vocabulary: string[];
	recurringExpressions: string[];
	expertise: string[];
	opinions: string[];
	humor: string;
	formality: string;
	boundaries: string[];
	forbiddenPhrases: string[];
	dislikedPatterns: string[];
	examples: VoiceProfileExample[];
	corrections: VoiceProfileCorrection[];
	interviewAnswers: VoiceProfileInterviewAnswer[];
}

export interface VoiceProfile {
	id: string;
	workspaceId: string;
	name: string;
	isDefault: boolean;
	revision: number;
	schemaVersion: number;
	definition: VoiceProfileDefinition;
	assignedAccountIds: string[];
	createdAt?: string;
	updatedAt?: string;
}

export interface VoiceProfileDraft {
	name: string;
	definition: VoiceProfileDefinition;
}

export interface VoiceProfileAccount {
	id: string;
	label: string;
	platform: string;
	handle?: string;
	active?: boolean;
}

export type VoiceProfileAssignments = Record<string, string>;

export interface CreateVoiceProfileInput {
	workspaceId: string;
	name: string;
	isDefault: boolean;
	definition: VoiceProfileDefinition;
}

export interface UpdateVoiceProfileInput {
	workspaceId: string;
	profileId: string;
	expectedRevision: number;
	name: string;
	definition: VoiceProfileDefinition;
}

export interface SetDefaultVoiceProfileInput {
	workspaceId: string;
	profileId: string;
	expectedRevision: number;
}

export interface DeleteVoiceProfileInput extends SetDefaultVoiceProfileInput {
	confirm: true;
}

export interface AssignVoiceProfileAccountInput {
	workspaceId: string;
	accountId: string;
	voiceProfileId: string | null;
}

export interface VoiceProfileClientOptions {
	signal?: AbortSignal;
}

export interface VoiceProfilesClient {
	list(workspaceId: string, options?: VoiceProfileClientOptions): Promise<VoiceProfile[]>;
	create(
		input: CreateVoiceProfileInput,
		options?: VoiceProfileClientOptions
	): Promise<VoiceProfile>;
	update(
		input: UpdateVoiceProfileInput,
		options?: VoiceProfileClientOptions
	): Promise<VoiceProfile>;
	setDefault(
		input: SetDefaultVoiceProfileInput,
		options?: VoiceProfileClientOptions
	): Promise<VoiceProfile>;
	delete(input: DeleteVoiceProfileInput, options?: VoiceProfileClientOptions): Promise<void>;
	assignAccount(
		input: AssignVoiceProfileAccountInput,
		options?: VoiceProfileClientOptions
	): Promise<void>;
}

export type VoiceProfileValidationCode =
	| 'name_required'
	| 'name_too_long'
	| 'example_text_required'
	| 'correction_pair_required'
	| 'interview_pair_required';

export interface VoiceProfilesCopy {
	title: string;
	description: string;
	newProfile: string;
	profilesHeading: string;
	profilesLabel: string;
	loading: string;
	loadFailed: string;
	retry: string;
	emptyTitle: string;
	emptyDescription: string;
	defaultBadge: string;
	assignedCount: (count: number) => string;
	unsavedSwitch: string;
	name: string;
	namePlaceholder: string;
	identityHeading: string;
	identityDescription: string;
	identitySummary: string;
	identitySummaryPlaceholder: string;
	traits: string;
	traitsDescription: string;
	traitsPlaceholder: string;
	expertise: string;
	expertiseDescription: string;
	expertisePlaceholder: string;
	advancedHeading: string;
	advancedDescription: string;
	languageHeading: string;
	preferredLanguage: string;
	preferredLanguageDescription: string;
	preferredLanguagePlaceholder: string;
	vocabulary: string;
	vocabularyDescription: string;
	vocabularyPlaceholder: string;
	recurringExpressions: string;
	recurringExpressionsDescription: string;
	recurringExpressionsPlaceholder: string;
	opinions: string;
	opinionsDescription: string;
	opinionsPlaceholder: string;
	toneHeading: string;
	humor: string;
	humorPlaceholder: string;
	formality: string;
	formalityPlaceholder: string;
	boundaries: string;
	boundariesDescription: string;
	boundariesPlaceholder: string;
	avoidHeading: string;
	forbiddenPhrases: string;
	forbiddenPhrasesDescription: string;
	forbiddenPhrasesPlaceholder: string;
	dislikedPatterns: string;
	dislikedPatternsDescription: string;
	dislikedPatternsPlaceholder: string;
	learningHeading: string;
	learningDescription: string;
	examples: string;
	addExample: string;
	exampleText: string;
	exampleTextPlaceholder: string;
	examplePlatform: string;
	examplePlatformPlaceholder: string;
	exampleReason: string;
	exampleReasonPlaceholder: string;
	corrections: string;
	addCorrection: string;
	correctionOriginal: string;
	correctionOriginalPlaceholder: string;
	correctionPreferred: string;
	correctionPreferredPlaceholder: string;
	correctionLesson: string;
	correctionLessonPlaceholder: string;
	interviewAnswers: string;
	addInterviewAnswer: string;
	interviewQuestion: string;
	interviewQuestionPlaceholder: string;
	interviewAnswer: string;
	interviewAnswerPlaceholder: string;
	removeItem: string;
	addItem: string;
	save: string;
	create: string;
	saving: string;
	cancel: string;
	setDefault: string;
	settingDefault: string;
	defaultHelp: string;
	delete: string;
	deleteTitle: string;
	deleteDescription: (name: string) => string;
	deleteConfirm: string;
	deleteDefaultHelp: string;
	accountsHeading: string;
	accountsDescription: string;
	accountsLoading: string;
	accountVoiceLabel: (account: string) => string;
	workspaceDefaultOption: (name: string) => string;
	noAccounts: string;
	assignmentFailed: string;
	nameRequired: string;
	nameTooLong: string;
	exampleTextRequired: string;
	correctionPairRequired: string;
	interviewPairRequired: string;
	saveFailed: string;
	deleteFailed: string;
	defaultFailed: string;
	dismissError: string;
}
