import { describe, expect, it } from 'vitest';
import {
	SHORTCUT_PRESET_SCHEMA,
	browserShortcutConflict,
	createShortcutPreset,
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
});
