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

	it('uses Resolve-style Backspace lift delete and Delete ripple delete defaults', () => {
		const bindings = resolveEditorShortcuts();
		expect(editorDeleteModeForEvent({ code: 'Backspace', key: 'Backspace' }, bindings)).toBe(
			'lift'
		);
		expect(editorDeleteModeForEvent({ code: 'Delete', key: 'Delete' }, bindings)).toBe('ripple');
		expect(
			editorDeleteModeForEvent({ code: 'Delete', key: 'Delete', metaKey: true }, bindings)
		).toBe('ripple');
	});

	it('keeps timeline and canvas snapping on separate FreeCut-compatible bindings', () => {
		const bindings = resolveEditorShortcuts();
		expect(bindings.TOGGLE_SNAP).toBe('s');
		expect(bindings.TOGGLE_CANVAS_SNAP).toBe('shift+s');
		expect(
			findShortcutConflicts(bindings, bindings.TOGGLE_CANVAS_SNAP, 'TOGGLE_CANVAS_SNAP')
		).toEqual([]);
	});

	it('includes the FreeCut-compatible Scene Browser binding', () => {
		const bindings = resolveEditorShortcuts();
		expect(bindings.OPEN_SCENE_BROWSER).toBe('mod+shift+f');
	});

	it('includes FreeCut-compatible timeline tool and edit-point navigation bindings', () => {
		const bindings = resolveEditorShortcuts();
		expect(bindings.SELECTION_TOOL).toBe('v');
		expect(bindings.RAZOR_TOOL).toBe('c');
		expect(bindings.SPLIT_AT_CURSOR).toBe('shift+c');
		expect(bindings.SLIP_TOOL).toBe('y');
		expect(bindings.SLIDE_TOOL).toBe('u');
		expect(bindings.PREVIOUS_SNAP_POINT).toBe('up');
		expect(bindings.NEXT_SNAP_POINT).toBe('down');
	});

	it('includes FreeCut-compatible visual nudge bindings', () => {
		const bindings = resolveEditorShortcuts();
		expect(bindings.NUDGE_LEFT).toBe('shift+left');
		expect(bindings.NUDGE_RIGHT).toBe('shift+right');
		expect(bindings.NUDGE_UP).toBe('shift+up');
		expect(bindings.NUDGE_DOWN).toBe('shift+down');
		expect(bindings.NUDGE_LEFT_LARGE).toBe('mod+shift+left');
		expect(bindings.NUDGE_RIGHT_LARGE).toBe('mod+shift+right');
		expect(bindings.NUDGE_UP_LARGE).toBe('mod+shift+up');
		expect(bindings.NUDGE_DOWN_LARGE).toBe('mod+shift+down');
	});

	it('includes FreeCut-compatible scoped keyframe editor bindings', () => {
		const bindings = resolveEditorShortcuts();
		expect(bindings.KEYFRAME_EDITOR_GRAPH).toBe('1');
		expect(bindings.KEYFRAME_EDITOR_DOPESHEET).toBe('2');
		expect(bindings.KEYFRAME_EDITOR_SPLIT).toBe('3');
		expect(bindings.EDIT_KEYFRAME_ADD).toBe('k');
		expect(bindings.KEYFRAME_PREVIOUS).toBe('alt+bracketleft');
		expect(bindings.KEYFRAME_NEXT).toBe('alt+bracketright');
		expect(bindings.KEYFRAME_TOGGLE_AUTO).toBe('a');
		expect(bindings.KEYFRAME_FIT).toBe('f');
	});

	it('includes editable track-header bindings and recognizes function keys', () => {
		const bindings = resolveEditorShortcuts();
		expect(bindings.TRACK_RENAME).toBe('f2');
		expect(bindings.TRACK_MOVE_UP).toBe('alt+up');
		expect(bindings.TRACK_MOVE_DOWN).toBe('alt+down');
		expect(shortcutBindingFromEvent({ code: 'F2', key: 'F2' })).toBe('f2');
	});

	it('reports command and browser conflicts before a binding is replaced', () => {
		const bindings = resolveEditorShortcuts({ PLAY_PAUSE: 'mod+s' });
		expect(findShortcutConflicts(bindings, 'mod+s', 'PLAY_PAUSE')).toEqual(['SAVE']);
		expect(browserShortcutConflict('Ctrl+P')).toEqual({
			binding: 'mod+p',
			browserAction: 'Print page'
		});
	});

	it('round trips custom and unassigned commands through a versioned preset', () => {
		const preset = createShortcutPreset(
			{ PLAY_PAUSE: 'Shift+Space', DELETE_SELECTED: '' },
			new Date('2026-08-25T12:00:00.000Z')
		);
		expect(preset).toMatchObject({
			schema: SHORTCUT_PRESET_SCHEMA,
			version: 1,
			exportedAt: '2026-08-25T12:00:00.000Z',
			overrides: { PLAY_PAUSE: 'shift+space', DELETE_SELECTED: '' }
		});
		expect(parseShortcutPreset(preset)).toEqual({
			overrides: { PLAY_PAUSE: 'shift+space', DELETE_SELECTED: '' },
			importedCount: 2,
			ignoredCount: 0,
			sourceSchema: SHORTCUT_PRESET_SCHEMA,
			sourceVersion: 1
		});
	});

	it('imports matching FreeCut command ids', () => {
		expect(
			parseShortcutPreset({
				schema: 'freecut-hotkeys',
				version: 1,
				overrides: {
					PLAY_PAUSE: 'Shift+Space',
					WORKSPACE_COLOR: 'Alt+8',
					OPEN_SCENE_BROWSER: 'Ctrl+Shift+F',
					KEYFRAME_EDITOR_SPLIT: '4'
				}
			})
		).toEqual({
			overrides: {
				PLAY_PAUSE: 'shift+space',
				WORKSPACE_COLOR: 'alt+8',
				KEYFRAME_EDITOR_SPLIT: '4'
			},
			importedCount: 4,
			ignoredCount: 0,
			sourceSchema: 'freecut-hotkeys',
			sourceVersion: 1
		});
	});

	it('rejects malformed presets instead of partially applying them', () => {
		expect(() => parseShortcutPreset({ schema: SHORTCUT_PRESET_SCHEMA, overrides: [] })).toThrow(
			'Invalid shortcut preset'
		);
	});
});
