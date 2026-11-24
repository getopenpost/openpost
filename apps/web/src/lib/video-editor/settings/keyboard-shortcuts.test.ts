import { describe, expect, it } from 'vitest';
import {
	SHORTCUT_PRESET_SCHEMA,
	browserShortcutConflict,
	createShortcutImportReview,
	eventMatchesShortcut,
	findShortcutConflicts,
	parseShortcutPreset,
	resolveEditorShortcuts
} from '@openpost/editor-shared/settings';

describe('keyboard shortcuts', () => {
	it('matches command events from their resolved binding', () => {
		const bindings = resolveEditorShortcuts({ PLAY_PAUSE: 'shift+space' });
		expect(
			eventMatchesShortcut({ code: 'Space', key: ' ', shiftKey: true }, bindings.PLAY_PAUSE)
		).toBe(true);
		expect(eventMatchesShortcut({ code: 'Space', key: ' ' }, bindings.PLAY_PAUSE)).toBe(false);
	});

	it('reports command and browser conflicts before a binding is replaced', () => {
		const bindings = resolveEditorShortcuts({ PLAY_PAUSE: 'mod+s' });
		expect(findShortcutConflicts(bindings, 'mod+s', 'PLAY_PAUSE')).toEqual(['SAVE']);
		expect(browserShortcutConflict('Ctrl+P')).toEqual({
			binding: 'mod+p',
			browserAction: 'Print page'
		});
	});

	it('rejects malformed presets instead of partially applying them', () => {
		expect(() => parseShortcutPreset({ schema: SHORTCUT_PRESET_SCHEMA, overrides: [] })).toThrow(
			'Invalid shortcut preset'
		);
	});

	it('previews every imported replacement before storage changes', () => {
		const current = { PLAY_PAUSE: 'shift+space', SAVE: 'alt+s' } as const;
		const imported = parseShortcutPreset({
			schema: SHORTCUT_PRESET_SCHEMA,
			overrides: { PLAY_PAUSE: 'mod+p', COPY: 'mod+p' }
		});

		const review = createShortcutImportReview(imported, current);

		expect(review.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'PLAY_PAUSE',
					from: 'shift+space',
					to: 'mod+p'
				}),
				expect.objectContaining({ id: 'SAVE', from: 'alt+s', to: 'mod+s' })
			])
		);
		expect(review.conflicts).toContainEqual({
			binding: 'mod+p',
			ids: ['PLAY_PAUSE', 'COPY']
		});
		expect(current).toEqual({ PLAY_PAUSE: 'shift+space', SAVE: 'alt+s' });
	});
});
