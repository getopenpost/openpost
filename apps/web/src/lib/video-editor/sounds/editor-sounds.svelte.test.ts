import { describe, expect, it, vi } from 'vitest';
import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
import { emitEditorSound, previewEditorSound } from './editor-sounds';

describe('editor interface sounds', () => {
	it('suppresses edit cues during playback but keeps an explicit theme preview', () => {
		// Spy on the real owner so the default production dependency is exercised
		// instead of an injected stand-in.
		const playSemantic = vi
			.spyOn(soundPreferences, 'playSemantic')
			.mockImplementation(() => undefined);
		try {
			emitEditorSound('delete', true);
			expect(playSemantic).not.toHaveBeenCalled();
			emitEditorSound('delete', false);
			previewEditorSound('velvet');
			expect(playSemantic).toHaveBeenCalledTimes(2);
			expect(playSemantic).toHaveBeenNthCalledWith(1, 'delete');
			expect(playSemantic).toHaveBeenNthCalledWith(2, 'confirm', 'velvet');
		} finally {
			playSemantic.mockRestore();
		}
	});
});
