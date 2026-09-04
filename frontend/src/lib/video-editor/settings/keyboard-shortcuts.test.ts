import { describe, expect, it } from 'vitest';
import {
	SHORTCUT_PRESET_SCHEMA,
	browserShortcutConflict,
	createShortcutImportReview,
	createShortcutPreset,
	EDITOR_SHORTCUT_GROUPS,
	editorDeleteModeForEvent,
	eventMatchesShortcut,
	findShortcutConflicts,
	formatShortcutAriaKey,
	formatShortcutBinding,
	normalizeShortcutBinding,
	parseShortcutPreset,
	resolveEditorShortcuts,
	shortcutBindingFromEvent
} from './keyboard-shortcuts';

describe('keyboard shortcuts', () => {
	it('normalizes aliases, physical keys, and cross-platform modifiers', () => {
		expect(normalizeShortcutBinding('Shift+Ctrl+ArrowLeft')).toBe('mod+shift+left');
		expect(
			shortcutBindingFromEvent({
				code: 'Comma',
				key: '<',
				metaKey: true,
				shiftKey: true
			})
		).toBe('mod+shift+comma');
		expect(formatShortcutBinding('mod+alt+k', 'MacIntel')).toBe('Cmd + Option + K');
		expect(formatShortcutBinding('mod+alt+k', 'Win32')).toBe('Ctrl + Alt + K');
		expect(formatShortcutAriaKey('mod+alt+left', 'MacIntel')).toBe('Meta+Alt+ArrowLeft');
	});

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

	it('groups primary and alternate bindings under one command', () => {
		expect(
			EDITOR_SHORTCUT_GROUPS.find((group) => group.primaryId === 'SPLIT_AT_PLAYHEAD')?.alternateIds
		).toEqual(['SPLIT_AT_PLAYHEAD_ALT']);
		expect(
			EDITOR_SHORTCUT_GROUPS.find((group) => group.primaryId === 'DELETE_SELECTED')?.alternateIds
		).toEqual(['DELETE_SELECTED_ALT']);
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
				expect.objectContaining({ id: 'PLAY_PAUSE', from: 'shift+space', to: 'mod+p' }),
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
