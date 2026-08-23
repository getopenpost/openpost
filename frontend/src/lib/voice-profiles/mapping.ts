import type {
	CreateVoiceProfileInput,
	UpdateVoiceProfileInput,
	VoiceProfile,
	VoiceProfileAssignments,
	VoiceProfileDefinition,
	VoiceProfileDraft,
	VoiceProfileValidationCode
} from './types';

export function emptyVoiceProfileDefinition(): VoiceProfileDefinition {
	return {
		identitySummary: '',
		traits: [],
		vocabulary: [],
		recurringExpressions: [],
		expertise: [],
		opinions: [],
		humor: '',
		formality: '',
		boundaries: [],
		forbiddenPhrases: [],
		dislikedPatterns: [],
		examples: [],
		corrections: [],
		interviewAnswers: []
	};
}

export function voiceProfileDraft(profile?: VoiceProfile | null): VoiceProfileDraft {
	if (!profile) return { name: '', definition: emptyVoiceProfileDefinition() };
	return {
		name: profile.name,
		definition: structuredClone(profile.definition)
	};
}

function normalizeList(values: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		const key = trimmed.toLocaleLowerCase();
		if (!trimmed || seen.has(key)) continue;
		seen.add(key);
		normalized.push(trimmed);
	}
	return normalized;
}

export function normalizeVoiceProfileDraft(draft: VoiceProfileDraft): VoiceProfileDraft {
	return {
		name: draft.name.trim(),
		definition: {
			identitySummary: draft.definition.identitySummary.trim(),
			traits: normalizeList(draft.definition.traits),
			vocabulary: normalizeList(draft.definition.vocabulary),
			recurringExpressions: normalizeList(draft.definition.recurringExpressions),
			expertise: normalizeList(draft.definition.expertise),
			opinions: normalizeList(draft.definition.opinions),
			humor: draft.definition.humor.trim(),
			formality: draft.definition.formality.trim(),
			boundaries: normalizeList(draft.definition.boundaries),
			forbiddenPhrases: normalizeList(draft.definition.forbiddenPhrases),
			dislikedPatterns: normalizeList(draft.definition.dislikedPatterns),
			examples: draft.definition.examples
				.map((item) => ({
					text: item.text.trim(),
					platform: item.platform?.trim() || undefined,
					whyItFits: item.whyItFits?.trim() || undefined
				}))
				.filter((item) => item.text),
			corrections: draft.definition.corrections
				.map((item) => ({
					original: item.original.trim(),
					preferred: item.preferred.trim(),
					lesson: item.lesson?.trim() || undefined
				}))
				.filter((item) => item.original || item.preferred),
			interviewAnswers: draft.definition.interviewAnswers
				.map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
				.filter((item) => item.question || item.answer)
		}
	};
}

export function validateVoiceProfileDraft(draft: VoiceProfileDraft): VoiceProfileValidationCode[] {
	const issues: VoiceProfileValidationCode[] = [];
	const name = draft.name.trim();
	if (!name) issues.push('name_required');
	if (Array.from(name).length > 80) issues.push('name_too_long');
	if (draft.definition.examples.some((item) => !item.text.trim())) {
		issues.push('example_text_required');
	}
	if (
		draft.definition.corrections.some((item) => !item.original.trim() || !item.preferred.trim())
	) {
		issues.push('correction_pair_required');
	}
	if (
		draft.definition.interviewAnswers.some((item) => !item.question.trim() || !item.answer.trim())
	) {
		issues.push('interview_pair_required');
	}
	return issues;
}

export function voiceProfileDraftFingerprint(draft: VoiceProfileDraft): string {
	return JSON.stringify(normalizeVoiceProfileDraft(draft));
}

export function voiceProfileGuidanceCount(definition: VoiceProfileDefinition): number {
	return [
		definition.identitySummary,
		definition.humor,
		definition.formality,
		...definition.traits,
		...definition.vocabulary,
		...definition.recurringExpressions,
		...definition.expertise,
		...definition.opinions,
		...definition.boundaries,
		...definition.forbiddenPhrases,
		...definition.dislikedPatterns,
		...definition.examples.map((item) => item.text),
		...definition.corrections.map((item) => item.preferred),
		...definition.interviewAnswers.map((item) => item.answer)
	].filter((value) => value.trim()).length;
}

export function createVoiceProfileInput(
	workspaceId: string,
	draft: VoiceProfileDraft,
	isDefault = false
): CreateVoiceProfileInput {
	const normalized = normalizeVoiceProfileDraft(draft);
	return { workspaceId: workspaceId.trim(), isDefault, ...normalized };
}

export function updateVoiceProfileInput(
	workspaceId: string,
	profile: VoiceProfile,
	draft: VoiceProfileDraft
): UpdateVoiceProfileInput {
	const normalized = normalizeVoiceProfileDraft(draft);
	return {
		workspaceId: workspaceId.trim(),
		profileId: profile.id,
		expectedRevision: profile.revision,
		...normalized
	};
}

export function voiceProfileAssignmentMap(
	profiles: VoiceProfile[],
	accountIds: string[]
): VoiceProfileAssignments {
	const defaultProfile = profiles.find((profile) => profile.isDefault);
	const assignments: VoiceProfileAssignments = {};
	for (const accountId of accountIds) {
		if (defaultProfile) assignments[accountId] = defaultProfile.id;
	}
	for (const profile of profiles) {
		for (const accountId of profile.assignedAccountIds) {
			if (accountIds.includes(accountId)) assignments[accountId] = profile.id;
		}
	}
	return assignments;
}

export function replaceVoiceProfile(profiles: VoiceProfile[], next: VoiceProfile): VoiceProfile[] {
	const exists = profiles.some((profile) => profile.id === next.id);
	const values = exists
		? profiles.map((profile) => (profile.id === next.id ? next : profile))
		: [...profiles, next];
	return [...values].sort((left, right) => {
		if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
		return left.name.localeCompare(right.name);
	});
}
