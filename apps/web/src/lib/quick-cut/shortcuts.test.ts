import { describe, expect, it } from 'vitest';
import { resolveEditorShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts';
import { quickCutShortcutAction } from './shortcuts';

function keyEvent(code: string, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
	// SAFETY: The resolver reads only KeyboardEvent fields supplied by this fixture.
	return { code, key, ...modifiers } as KeyboardEvent;
}

describe('Quick Cut shortcuts', () => {
	it('resolves Quick Cut actions from the shared command catalog', () => {
		const bindings = resolveEditorShortcuts();
		expect(quickCutShortcutAction(keyEvent('KeyI', 'i'), bindings)).toBe('mark-in');
		expect(quickCutShortcutAction(keyEvent('Enter', 'Enter'), bindings)).toBe('add-segment');
		expect(quickCutShortcutAction(keyEvent('Backspace', 'Backspace'), bindings)).toBe(
			'delete-segment'
		);
		expect(quickCutShortcutAction(keyEvent('Delete', 'Delete'), bindings)).toBe('delete-segment');
		expect(
			quickCutShortcutAction(keyEvent('Backspace', 'Backspace', { shiftKey: true }), bindings)
		).toBe('delete-segment');
		expect(quickCutShortcutAction(keyEvent('KeyL', 'l', { altKey: true }), bindings)).toBe(
			'toggle-loop'
		);
	});

	it('honors remapped and unbound commands without retaining hardcoded keys', () => {
		const bindings = resolveEditorShortcuts({
			MARK_IN: 'alt+9',
			PREVIOUS_FRAME: 'comma',
			RIPPLE_DELETE: 'alt+delete',
			QUICK_CUT_ADD_SEGMENT: '',
			QUICK_CUT_TOGGLE_LOOP: 'shift+7'
		});
		expect(quickCutShortcutAction(keyEvent('KeyI', 'i'), bindings)).toBeNull();
		expect(quickCutShortcutAction(keyEvent('Digit9', '9', { altKey: true }), bindings)).toBe(
			'mark-in'
		);
		expect(quickCutShortcutAction(keyEvent('ArrowLeft', 'ArrowLeft'), bindings)).toBeNull();
		expect(quickCutShortcutAction(keyEvent('Comma', ','), bindings)).toBe('previous-frame');
		expect(quickCutShortcutAction(keyEvent('Enter', 'Enter'), bindings)).toBeNull();
		expect(quickCutShortcutAction(keyEvent('Delete', 'Delete'), bindings)).toBeNull();
		expect(quickCutShortcutAction(keyEvent('Delete', 'Delete', { altKey: true }), bindings)).toBe(
			'delete-segment'
		);
		expect(quickCutShortcutAction(keyEvent('Digit7', '7', { shiftKey: true }), bindings)).toBe(
			'toggle-loop'
		);
	});
});
