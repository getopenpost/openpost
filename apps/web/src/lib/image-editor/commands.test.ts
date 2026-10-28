import { describe, expect, it } from 'vitest';
import {
	imageEditorCommandForKeyboardEvent,
	imageEditorCommandsForCompactMenu,
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

	it('distinguishes primary and shifted tool commands', () => {
		expect(imageEditorCommandForKeyboardEvent(key('g'))).toBe('tool_gradient');
		expect(imageEditorCommandForKeyboardEvent(key('g', { shiftKey: true }))).toBe('tool_bucket');
		expect(imageEditorCommandForKeyboardEvent(key('g', { ctrlKey: true }))).toBe('group');
		expect(imageEditorCommandForKeyboardEvent(key('g', { ctrlKey: true, shiftKey: true }))).toBe(
			'ungroup'
		);
		expect(imageEditorCommandForKeyboardEvent(key('l', { shiftKey: true }))).toBe(
			'tool_polygonal_lasso'
		);
	});

	it('formats the same primary shortcut used by menus and help', () => {
		const save = IMAGE_EDITOR_COMMANDS.find((command) => command.id === 'save')!;
		expect(imageEditorShortcutLabel(save, '⌘')).toBe('⌘ S');
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
				imageEditorCommandForKeyboardEvent({ ...key('и', modifiers), code: 'KeyB' })
			).toBeNull();
		}
		expect(imageEditorCommandForKeyboardEvent({ ...key('Dead'), code: 'KeyB' })).toBeNull();
		expect(imageEditorCommandForKeyboardEvent({ ...key(','), code: 'KeyW' })).toBeNull();
		expect(imageEditorCommandForKeyboardEvent({ ...key('é'), code: 'KeyB' })).toBeNull();
		expect(
			imageEditorCommandForKeyboardEvent({ ...key('д', { shiftKey: true }), code: 'KeyL' })
		).toBe('tool_polygonal_lasso');
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

	it('keeps Edit, Layer, Select, and Tools reachable from the compact menu', () => {
		const categories = new Set(
			imageEditorCommandsForCompactMenu().map((command) => command.category)
		);
		expect(categories).toEqual(new Set(['edit', 'layer', 'select', 'tools']));
	});

	it('keeps pixel-selection refinement and layer alpha in the Select menu', () => {
		expect(
			IMAGE_EDITOR_COMMANDS.filter((command) => command.category === 'select').map(
				(command) => command.id
			)
		).toEqual([
			'select_all',
			'deselect',
			'selection_invert',
			'selection_expand',
			'selection_contract',
			'selection_from_layer_alpha'
		]);
	});
});
