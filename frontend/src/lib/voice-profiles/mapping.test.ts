import { describe, expect, it } from 'vitest';
import {
	createVoiceProfileInput,
	emptyVoiceProfileDefinition,
	normalizeVoiceProfileDraft,
	replaceVoiceProfile,
	updateVoiceProfileInput,
	validateVoiceProfileDraft,
	voiceProfileAssignmentMap,
	voiceProfileDraft,
	voiceProfileDraftFingerprint,
	voiceProfileGuidanceCount
} from './mapping';
import type { VoiceProfile, VoiceProfileDraft } from './types';

function profile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
	return {
		id: 'voice-1',
		workspaceId: 'workspace-1',
		name: 'Rodrigo',
		isDefault: true,
		revision: 3,
		schemaVersion: 1,
		definition: emptyVoiceProfileDefinition(),
		assignedAccountIds: [],
		...overrides
	};
}

function draft(overrides: Partial<VoiceProfileDraft> = {}): VoiceProfileDraft {
	return {
		name: ' Rodrigo ',
		definition: emptyVoiceProfileDefinition(),
		...overrides
	};
}

describe('voice profile draft mapping', () => {
	it('creates an independent draft from a stored profile', () => {
		const stored = profile({
			definition: { ...emptyVoiceProfileDefinition(), traits: ['Direct'] }
		});
		const next = voiceProfileDraft(stored);
		next.definition.traits.push('Technical');

		expect(stored.definition.traits).toEqual(['Direct']);
		expect(next.definition.traits).toEqual(['Direct', 'Technical']);
	});

	it('trims fields, removes duplicate list values, and drops blank learning rows', () => {
		const normalized = normalizeVoiceProfileDraft(
			draft({
				definition: {
					...emptyVoiceProfileDefinition(),
					identitySummary: ' Technical founder ',
					traits: [' Direct ', 'direct', ' Technical '],
					examples: [{ text: ' A real post ', platform: ' X ' }, { text: ' ' }],
					corrections: [{ original: ' ', preferred: ' ' }],
					interviewAnswers: [{ question: ' ', answer: ' ' }]
				}
			})
		);

		expect(normalized).toMatchObject({
			name: 'Rodrigo',
			definition: {
				identitySummary: 'Technical founder',
				traits: ['Direct', 'Technical'],
				examples: [{ text: 'A real post', platform: 'X', whyItFits: undefined }],
				corrections: [],
				interviewAnswers: []
			}
		});
	});

	it('reports incomplete names and learning records before transport', () => {
		expect(
			validateVoiceProfileDraft(
				draft({
					name: ' ',
					definition: {
						...emptyVoiceProfileDefinition(),
						examples: [{ text: '' }],
						corrections: [{ original: 'Draft', preferred: '' }],
						interviewAnswers: [{ question: 'Why?', answer: '' }]
					}
				})
			)
		).toEqual([
			'name_required',
			'example_text_required',
			'correction_pair_required',
			'interview_pair_required'
		]);
	});

	it('builds create and revision-safe update requests', () => {
		const source = draft({
			definition: { ...emptyVoiceProfileDefinition(), traits: [' Direct '] }
		});

		expect(createVoiceProfileInput(' workspace-1 ', source, true)).toMatchObject({
			workspaceId: 'workspace-1',
			name: 'Rodrigo',
			isDefault: true,
			definition: { traits: ['Direct'] }
		});
		expect(updateVoiceProfileInput('workspace-1', profile(), source)).toMatchObject({
			profileId: 'voice-1',
			expectedRevision: 3,
			name: 'Rodrigo'
		});
	});

	it('uses a normalized fingerprint and counts concrete guidance', () => {
		const left = draft({ definition: { ...emptyVoiceProfileDefinition(), traits: ['Direct'] } });
		const right = draft({
			name: 'Rodrigo',
			definition: { ...emptyVoiceProfileDefinition(), traits: [' Direct '] }
		});

		expect(voiceProfileDraftFingerprint(left)).toBe(voiceProfileDraftFingerprint(right));
		expect(voiceProfileGuidanceCount(right.definition)).toBe(1);
	});
});

describe('voice profile collection mapping', () => {
	it('resolves account overrides over the workspace default', () => {
		const profiles = [
			profile(),
			profile({
				id: 'voice-2',
				name: 'OpenPost',
				isDefault: false,
				assignedAccountIds: ['account-2']
			})
		];

		expect(voiceProfileAssignmentMap(profiles, ['account-1', 'account-2'])).toEqual({
			'account-1': 'voice-1',
			'account-2': 'voice-2'
		});
	});

	it('keeps the default first and sorts the remaining profiles by name', () => {
		const profiles = [profile(), profile({ id: 'voice-3', name: 'Zulu', isDefault: false })];
		const values = replaceVoiceProfile(
			profiles,
			profile({ id: 'voice-2', name: 'Alpha', isDefault: false })
		);

		expect(values.map((item) => item.id)).toEqual(['voice-1', 'voice-2', 'voice-3']);
	});
});
