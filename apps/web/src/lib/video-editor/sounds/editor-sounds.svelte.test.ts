import { describe, expect, it } from 'vitest';
import { emitEditorSound, previewEditorSound } from './editor-sounds';

describe('editor interface sounds', () => {
	it('suppresses edit cues during playback but keeps an explicit theme preview', () => {
		const calls: Array<[string, string | undefined]> = [];
		const preferences = {
			playSemantic(token: string, theme?: string) {
				calls.push([token, theme]);
			}
		};

		emitEditorSound('delete', true, preferences);
		emitEditorSound('delete', false, preferences);
		previewEditorSound('velvet', preferences);
		expect(calls).toEqual([
			['delete', undefined],
			['confirm', 'velvet']
		]);
	});
});
