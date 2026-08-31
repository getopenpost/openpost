import { describe, expect, it } from 'vitest';
import {
	duplicateImageEditorShortcuts,
	imageEditorCommandForKeyboardEvent,
	imageEditorCommandsForRail,
	imageEditorShortcutLabel,
	IMAGE_EDITOR_COMMANDS
} from './commands';

function key(
	value: string,
	modifiers: Partial<
		Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing'>
	> = {}
) {
	return {
		key: value,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		...modifiers
	};
}

describe('OpenPost Image Editor command registry', () => {
	it('has no shortcut collisions', () => {
		expect(duplicateImageEditorShortcuts()).toEqual([]);
	});

	it('distinguishes primary and shifted tool commands', () => {
		expect(imageEditorCommandForKeyboardEvent(key('g'))).toBe('tool_gradient');
		expect(imageEditorCommandForKeyboardEvent(key('g', { shiftKey: true }))).toBe('tool_bucket');
		expect(imageEditorCommandForKeyboardEvent(key('g', { ctrlKey: true }))).toBe('group');
		expect(imageEditorCommandForKeyboardEvent(key('g', { ctrlKey: true, shiftKey: true }))).toBe(
			'ungroup'
		);
	});

	it('formats the same primary shortcut used by menus and help', () => {
		const save = IMAGE_EDITOR_COMMANDS.find((command) => command.id === 'save')!;
		expect(imageEditorShortcutLabel(save, '⌘')).toBe('⌘ S');
	});

	it('never dispatches commands while an IME composition is active', () => {
		expect(imageEditorCommandForKeyboardEvent(key('t', { isComposing: true }))).toBeNull();
		expect(
			imageEditorCommandForKeyboardEvent(key('s', { ctrlKey: true, isComposing: true }))
		).toBeNull();
	});

	it('keeps one primary command per rail slot', () => {
		const rail = imageEditorCommandsForRail();
		expect(new Set(rail.map((command) => command.railSlot)).size).toBe(rail.length);
	});
});
