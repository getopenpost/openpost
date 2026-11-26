import { describe, expect, it } from 'vitest';
import { imageEditorCommandForKeyboardEvent, IMAGE_EDITOR_COMMANDS } from './commands';

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
		const shortcuts = IMAGE_EDITOR_COMMANDS.flatMap((command) =>
			command.shortcuts.map((shortcut) => ({ command: command.id, shortcut }))
		);
		expect(shortcuts.length).toBeGreaterThan(0);
		for (const { command, shortcut } of shortcuts) {
			expect(
				imageEditorCommandForKeyboardEvent(
					key(shortcut.key, {
						ctrlKey: Boolean(shortcut.primary),
						shiftKey: Boolean(shortcut.shift),
						altKey: Boolean(shortcut.alt)
					})
				)
			).toBe(command);
		}
	});

	it.each(['и', 'β', 'لا'])('selects the brush using its physical key under %s input', (value) => {
		expect(imageEditorCommandForKeyboardEvent({ ...key(value), code: 'KeyB' })).toBe('tool_pencil');
	});

	it('keeps Latin layouts, browser modifiers, dead keys, and composition character-based', () => {
		expect(imageEditorCommandForKeyboardEvent({ ...key('v'), code: 'KeyB' })).toBe('tool_select');
		for (const modifiers of [
			{ ctrlKey: true },
			{ metaKey: true },
			{ altKey: true },
			{ isComposing: true }
		]) {
			expect(
				imageEditorCommandForKeyboardEvent({
					...key('и', modifiers),
					code: 'KeyB'
				})
			).toBeNull();
		}
		expect(imageEditorCommandForKeyboardEvent({ ...key('Dead'), code: 'KeyB' })).toBeNull();
		expect(imageEditorCommandForKeyboardEvent({ ...key(','), code: 'KeyW' })).toBeNull();
		expect(imageEditorCommandForKeyboardEvent({ ...key('é'), code: 'KeyB' })).toBeNull();
		expect(
			imageEditorCommandForKeyboardEvent({
				...key('д', { shiftKey: true }),
				code: 'KeyL'
			})
		).toBe('tool_polygonal_lasso');
	});

	it('never dispatches commands while an IME composition is active', () => {
		expect(imageEditorCommandForKeyboardEvent(key('t', { isComposing: true }))).toBeNull();
		expect(
			imageEditorCommandForKeyboardEvent(key('s', { ctrlKey: true, isComposing: true }))
		).toBeNull();
	});
});
