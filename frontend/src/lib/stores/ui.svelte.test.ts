import { describe, expect, it, vi } from 'vitest';
import { UIState, type RepurposeHandoff } from './ui.svelte';

function repurposeHandoff(id: string): RepurposeHandoff {
	return {
		handoff_id: id,
		workspace_id: 'workspace-1',
		title: 'Source',
		source_text: 'Stored source text',
		content_profile: 'short_text',
		destination_account_ids: ['account-1'],
		range: { days: 30 },
		provenance: {
			origin: 'external',
			platform: 'x',
			published_at: '2026-09-08T12:00:00Z',
			reference: { type: 'external', account_content_id: 'content-1' }
		},
		evidence: []
	};
}

describe('UIState repurpose handoff', () => {
	it('replaces repeated invocations with fresh local state and only consumes the matching handoff', () => {
		const state = new UIState();
		state.setRepurposeHandoff(repurposeHandoff('first'));
		state.setRepurposeHandoff(repurposeHandoff('second'));

		expect(state.pendingRepurposeHandoff?.handoff_id).toBe('second');
		state.consumeRepurposeHandoff('first');
		expect(state.pendingRepurposeHandoff?.handoff_id).toBe('second');
		state.consumeRepurposeHandoff('second');
		expect(state.pendingRepurposeHandoff).toBeNull();
	});
});

describe('UIState composer reset guards', () => {
	it('keeps the active composer mounted until its transient work can be discarded safely', () => {
		const state = new UIState();
		state.setActiveComposerDraft('draft-1');
		const guard = vi.fn(() => false);
		const unregister = state.registerComposerResetGuard(guard);

		expect(state.startNewPost()).toBe(false);
		expect(guard).toHaveBeenCalledOnce();
		expect(state.activeComposerDraftId).toBe('draft-1');
		expect(state.composerResetCounter).toBe(0);

		unregister();
		expect(state.startNewPost()).toBe(true);
		expect(state.activeComposerDraftId).toBeNull();
		expect(state.composerResetCounter).toBe(1);
	});
});
