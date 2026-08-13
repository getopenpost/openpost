import { describe, expect, it, vi } from 'vitest';
import { UIState } from './ui.svelte';

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
