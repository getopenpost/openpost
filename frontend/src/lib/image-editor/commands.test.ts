import { describe, expect, it } from 'vitest';
import {
	duplicateImageEditorShortcuts,
	imageEditorCommand,
	imageEditorCommandForKeyboardEvent,
	imageEditorCommandsForCategory,
	imageEditorCommandsForMobileGroup,
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

	it('owns tool placement and availability metadata for every tool command', () => {
		const tools = IMAGE_EDITOR_COMMANDS.filter((command) => command.category === 'tools');
		expect(tools).not.toHaveLength(0);
		for (const command of tools) {
			expect(command.tool).toBeTruthy();
			expect(command.mobileGroup).toBeTruthy();
			expect(command.railSlot).toBeTruthy();
			expect(command.availability).toBeTruthy();
		}
	});

	it('derives mobile groups and one primary command per rail slot from the registry', () => {
		expect(imageEditorCommandsForMobileGroup('retouch').map((command) => command.id)).toEqual([
			'tool_crop',
			'tool_eraser',
			'tool_magic_eraser'
		]);
		const rail = imageEditorCommandsForRail();
		expect(new Set(rail.map((command) => command.railSlot)).size).toBe(rail.length);
		expect(rail.map((command) => command.id)).toContain('tool_select');
		expect(imageEditorCommand('tool_bucket').availability).toBe('editable');
	});

	it('owns every desktop file, layer, view, and help menu action', () => {
		expect(imageEditorCommandsForCategory('file').map((command) => command.id)).toEqual([
			'save',
			'save_to_openpost',
			'version_history',
			'create_checkpoint',
			'save_template',
			'resize_design',
			'export_project',
			'import_project',
			'export_design'
		]);
		expect(imageEditorCommandsForCategory('layer').at(-1)?.id).toBe('remove_background');
		expect(
			imageEditorCommandsForCategory('view').some((command) => command.menuKind === 'checkbox')
		).toBe(true);
		expect(imageEditorCommandsForCategory('help').map((command) => command.id)).toEqual([
			'open_help'
		]);
	});
});
