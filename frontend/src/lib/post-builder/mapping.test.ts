import { describe, expect, it } from 'vitest';
import {
	createPostBuilderRunInput,
	postBuilderDirectionLabel,
	postBuilderRunIsActive,
	postBuilderRunIsTerminal,
	postBuilderRunProgress,
	validatePostBuilderDraft,
	type PostBuilderDraftInput
} from './mapping';
import type { PostBuilderRun } from './types';

function sourceDraft(overrides: Partial<PostBuilderDraftInput> = {}): PostBuilderDraftInput {
	return {
		workspaceId: ' workspace-1 ',
		mode: 'source',
		sourceText: ' A real product update ',
		sources: [],
		selectedAccountIds: [' account-1 '],
		...overrides
	};
}

describe('post builder input mapping', () => {
	it('reports every blocking input issue without treating incomplete uploads as source material', () => {
		expect(
			validatePostBuilderDraft(
				sourceDraft({
					workspaceId: ' ',
					sourceText: ' ',
					selectedAccountIds: [],
					sources: [
						{ id: 'failed-source', kind: 'link', label: 'Broken link', status: 'failed' },
						{ id: 'pending-source', kind: 'audio', label: 'Voice note', status: 'processing' }
					]
				})
			)
		).toEqual(['workspace_required', 'source_required', 'destinations_required']);
	});

	it('requires an opportunity in discover mode and can defer destination validation', () => {
		expect(
			validatePostBuilderDraft(
				sourceDraft({
					mode: 'discover',
					sourceText: '',
					selectedAccountIds: [],
					requiresDestinations: false
				})
			)
		).toEqual(['opportunity_required']);
	});

	it('trims identifiers, removes duplicates, and excludes incomplete source records', () => {
		expect(
			createPostBuilderRunInput(
				sourceDraft({
					sources: [
						{ id: ' source-1 ', kind: 'note', label: 'Notes' },
						{ id: 'source-1', kind: 'text', label: 'Duplicate notes' },
						{ id: 'source-2', kind: 'link', label: 'Failed link', status: 'failed' },
						{ id: 'source-3', kind: 'audio', label: 'Voice note', status: 'processing' }
					],
					selectedAccountIds: [' account-1 ', 'account-1', 'account-2'],
					socialSetId: ' set-1 ',
					voiceProfileId: ' voice-1 ',
					direction: {
						goal: ' Start discussion ',
						tone: ' ',
						research: 'required',
						destinationStrategy: 'curated'
					}
				})
			)
		).toMatchObject({
			workspaceId: 'workspace-1',
			sourceText: 'A real product update',
			sourceIds: ['source-1'],
			accountIds: ['account-1', 'account-2'],
			socialSetId: 'set-1',
			voiceProfileId: 'voice-1',
			direction: {
				goal: 'Start discussion',
				tone: undefined,
				research: 'required',
				destinationStrategy: 'curated'
			}
		});
	});
});

describe('post builder run presentation', () => {
	it('keeps active and terminal phases distinct', () => {
		const active = { id: 'run-1', phase: 'drafting' } satisfies PostBuilderRun;
		const terminal = { id: 'run-1', phase: 'ready' } satisfies PostBuilderRun;

		expect(postBuilderRunIsActive(active)).toBe(true);
		expect(postBuilderRunIsTerminal(active)).toBe(false);
		expect(postBuilderRunIsActive(terminal)).toBe(false);
		expect(postBuilderRunIsTerminal(terminal)).toBe(true);
	});

	it('uses server progress when present and clamps it into the visible range', () => {
		expect(postBuilderRunProgress({ id: 'run-1', phase: 'planning' })).toBe(44);
		expect(postBuilderRunProgress({ id: 'run-1', phase: 'drafting', progress: 128.4 })).toBe(100);
	});

	it('summarizes explicit direction choices without exposing their content', () => {
		expect(postBuilderDirectionLabel(undefined)).toBe('Auto');
		expect(postBuilderDirectionLabel({ goal: 'Announce' })).toBe('1 choice');
		expect(postBuilderDirectionLabel({ goal: 'Announce', research: 'required', tone: 'Dry' })).toBe(
			'3 choices'
		);
	});
});
