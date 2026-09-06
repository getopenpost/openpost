import {
	editorDeleteModeForEvent,
	eventMatchesShortcut,
	type EditorShortcutBindingMap
} from '$lib/video-editor/settings/keyboard-shortcuts';

export type QuickCutShortcutAction =
	| 'previous-frame'
	| 'next-frame'
	| 'go-to-start'
	| 'go-to-end'
	| 'mark-in'
	| 'mark-out'
	| 'clear-marks'
	| 'add-segment'
	| 'delete-segment'
	| 'toggle-loop';

export function quickCutShortcutAction(
	event: KeyboardEvent,
	bindings: EditorShortcutBindingMap
): QuickCutShortcutAction | null {
	if (eventMatchesShortcut(event, bindings.PREVIOUS_FRAME)) return 'previous-frame';
	if (eventMatchesShortcut(event, bindings.NEXT_FRAME)) return 'next-frame';
	if (eventMatchesShortcut(event, bindings.GO_TO_START)) return 'go-to-start';
	if (eventMatchesShortcut(event, bindings.GO_TO_END)) return 'go-to-end';
	if (eventMatchesShortcut(event, bindings.MARK_IN)) return 'mark-in';
	if (eventMatchesShortcut(event, bindings.MARK_OUT)) return 'mark-out';
	if (eventMatchesShortcut(event, bindings.CLEAR_IN_OUT)) return 'clear-marks';
	if (eventMatchesShortcut(event, bindings.QUICK_CUT_ADD_SEGMENT)) return 'add-segment';
	if (editorDeleteModeForEvent(event, bindings)) return 'delete-segment';
	if (eventMatchesShortcut(event, bindings.QUICK_CUT_TOGGLE_LOOP)) return 'toggle-loop';
	return null;
}
