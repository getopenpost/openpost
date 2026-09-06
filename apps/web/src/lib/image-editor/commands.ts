export type ImageEditorCommandID =
	| 'save'
	| 'save_to_openpost'
	| 'version_history'
	| 'create_checkpoint'
	| 'save_template'
	| 'resize_design'
	| 'export_project'
	| 'import_project'
	| 'export_design'
	| 'undo'
	| 'redo'
	| 'duplicate'
	| 'group'
	| 'ungroup'
	| 'remove_background'
	| 'select_all'
	| 'deselect'
	| 'copy'
	| 'cut'
	| 'paste'
	| 'delete'
	| 'fit_canvas'
	| 'zoom_100'
	| 'focus_canvas'
	| 'toggle_inspector'
	| 'toggle_snapping'
	| 'toggle_rulers'
	| 'toggle_guides'
	| 'toggle_grid'
	| 'toggle_snap_grid'
	| 'clear_guides'
	| 'add_guide'
	| 'open_help'
	| 'tool_select'
	| 'tool_marquee'
	| 'tool_ellipse_marquee'
	| 'tool_lasso'
	| 'tool_magic_wand'
	| 'tool_crop'
	| 'tool_eyedropper'
	| 'tool_text'
	| 'tool_shape'
	| 'tool_pencil'
	| 'tool_eraser'
	| 'tool_magic_eraser'
	| 'tool_bucket'
	| 'tool_gradient'
	| 'tool_hand'
	| 'tool_zoom';

import type { ImageEditorTool } from './types';

export type ImageEditorCommandCategory =
	| 'file'
	| 'edit'
	| 'layer'
	| 'view'
	| 'select'
	| 'tools'
	| 'help';
export type ImageEditorCommandAvailability =
	| 'always'
	| 'editable'
	| 'undo'
	| 'redo'
	| 'selection'
	| 'multi_selection'
	| 'group_selection'
	| 'clipboard'
	| 'crop_target'
	| 'image_selection'
	| 'project_idle'
	| 'guides';
export type ImageEditorCommandMobileGroup = 'select' | 'draw' | 'retouch';
export type ImageEditorCommandRailSlot =
	| 'select'
	| 'pixel_select'
	| 'lasso'
	| 'magic_select'
	| 'crop'
	| 'eyedropper'
	| 'text'
	| 'shape'
	| 'pencil'
	| 'fill'
	| 'erase'
	| 'hand'
	| 'zoom';

export interface ImageEditorCommandShortcut {
	key: string;
	primary?: boolean;
	shift?: boolean;
	alt?: boolean;
	display?: string;
}

export interface ImageEditorCommandDescriptor {
	id: ImageEditorCommandID;
	category: ImageEditorCommandCategory;
	shortcuts: readonly ImageEditorCommandShortcut[];
	availability: ImageEditorCommandAvailability;
	tool?: ImageEditorTool;
	mobileGroup?: ImageEditorCommandMobileGroup;
	railSlot?: ImageEditorCommandRailSlot;
	menuOrder?: number;
	separatorBefore?: boolean;
	menuKind?: 'item' | 'checkbox';
	audience?: 'all' | 'guest' | 'cloud';
}

export const IMAGE_EDITOR_COMMANDS: readonly ImageEditorCommandDescriptor[] = [
	{
		id: 'save',
		category: 'file',
		shortcuts: [{ key: 's', primary: true }],
		availability: 'editable',
		menuOrder: 10
	},
	{
		id: 'save_to_openpost',
		category: 'file',
		shortcuts: [],
		availability: 'always',
		audience: 'guest',
		menuOrder: 20
	},
	{
		id: 'version_history',
		category: 'file',
		shortcuts: [],
		availability: 'always',
		audience: 'cloud',
		menuOrder: 20
	},
	{
		id: 'create_checkpoint',
		category: 'file',
		shortcuts: [],
		availability: 'editable',
		audience: 'cloud',
		menuOrder: 30
	},
	{
		id: 'save_template',
		category: 'file',
		shortcuts: [],
		availability: 'editable',
		audience: 'cloud',
		menuOrder: 40
	},
	{
		id: 'resize_design',
		category: 'file',
		shortcuts: [],
		availability: 'editable',
		menuOrder: 50
	},
	{
		id: 'export_project',
		category: 'file',
		shortcuts: [],
		availability: 'project_idle',
		separatorBefore: true,
		menuOrder: 60
	},
	{
		id: 'import_project',
		category: 'file',
		shortcuts: [],
		availability: 'project_idle',
		menuOrder: 70
	},
	{
		id: 'export_design',
		category: 'file',
		shortcuts: [{ key: 'e', primary: true, shift: true }],
		availability: 'always',
		separatorBefore: true,
		menuOrder: 80
	},
	{
		id: 'undo',
		category: 'edit',
		shortcuts: [{ key: 'z', primary: true }],
		availability: 'undo',
		menuOrder: 10
	},
	{
		id: 'redo',
		category: 'edit',
		shortcuts: [
			{ key: 'z', primary: true, shift: true },
			{ key: 'y', primary: true }
		],
		availability: 'redo',
		menuOrder: 20
	},
	{
		id: 'duplicate',
		category: 'edit',
		shortcuts: [{ key: 'j', primary: true }],
		availability: 'selection',
		menuOrder: 70
	},
	{
		id: 'group',
		category: 'layer',
		shortcuts: [{ key: 'g', primary: true }],
		availability: 'multi_selection',
		menuOrder: 10
	},
	{
		id: 'ungroup',
		category: 'layer',
		shortcuts: [{ key: 'g', primary: true, shift: true }],
		availability: 'group_selection',
		menuOrder: 20
	},
	{
		id: 'remove_background',
		category: 'layer',
		shortcuts: [],
		availability: 'image_selection',
		separatorBefore: true,
		menuOrder: 30
	},
	{
		id: 'select_all',
		category: 'select',
		shortcuts: [{ key: 'a', primary: true }],
		availability: 'always',
		menuOrder: 10
	},
	{
		id: 'deselect',
		category: 'select',
		shortcuts: [{ key: 'd', primary: true }],
		availability: 'selection',
		menuOrder: 20
	},
	{
		id: 'copy',
		category: 'edit',
		shortcuts: [{ key: 'c', primary: true }],
		availability: 'selection',
		separatorBefore: true,
		menuOrder: 30
	},
	{
		id: 'cut',
		category: 'edit',
		shortcuts: [{ key: 'x', primary: true }],
		availability: 'selection',
		menuOrder: 40
	},
	{
		id: 'paste',
		category: 'edit',
		shortcuts: [{ key: 'v', primary: true }],
		availability: 'clipboard',
		menuOrder: 50
	},
	{
		id: 'delete',
		category: 'edit',
		shortcuts: [
			{ key: 'delete', display: 'Delete' },
			{ key: 'backspace', display: '⌫' }
		],
		availability: 'selection',
		menuOrder: 60
	},
	{
		id: 'fit_canvas',
		category: 'view',
		shortcuts: [{ key: '0', primary: true }],
		availability: 'always',
		separatorBefore: true,
		menuOrder: 100
	},
	{
		id: 'zoom_100',
		category: 'view',
		shortcuts: [{ key: '1', primary: true }],
		availability: 'always',
		menuOrder: 110
	},
	{
		id: 'focus_canvas',
		category: 'view',
		shortcuts: [{ key: 'f' }],
		availability: 'always',
		menuOrder: 120
	},
	{
		id: 'toggle_inspector',
		category: 'view',
		shortcuts: [],
		availability: 'always',
		menuKind: 'checkbox',
		menuOrder: 10
	},
	{
		id: 'toggle_snapping',
		category: 'view',
		shortcuts: [],
		availability: 'always',
		menuKind: 'checkbox',
		separatorBefore: true,
		menuOrder: 20
	},
	{
		id: 'toggle_rulers',
		category: 'view',
		shortcuts: [],
		availability: 'always',
		menuKind: 'checkbox',
		menuOrder: 30
	},
	{
		id: 'toggle_guides',
		category: 'view',
		shortcuts: [],
		availability: 'always',
		menuKind: 'checkbox',
		menuOrder: 40
	},
	{
		id: 'toggle_grid',
		category: 'view',
		shortcuts: [],
		availability: 'always',
		menuKind: 'checkbox',
		menuOrder: 50
	},
	{
		id: 'toggle_snap_grid',
		category: 'view',
		shortcuts: [],
		availability: 'always',
		menuKind: 'checkbox',
		menuOrder: 60
	},
	{
		id: 'clear_guides',
		category: 'view',
		shortcuts: [],
		availability: 'guides',
		menuOrder: 80
	},
	{
		id: 'add_guide',
		category: 'view',
		shortcuts: [],
		availability: 'editable',
		menuOrder: 90
	},
	{
		id: 'open_help',
		category: 'help',
		shortcuts: [],
		availability: 'always',
		menuOrder: 10
	},
	{
		id: 'tool_select',
		category: 'tools',
		shortcuts: [{ key: 'v' }],
		availability: 'always',
		tool: 'select',
		mobileGroup: 'select',
		railSlot: 'select'
	},
	{
		id: 'tool_marquee',
		category: 'tools',
		shortcuts: [{ key: 'm' }],
		availability: 'editable',
		tool: 'marquee',
		mobileGroup: 'select',
		railSlot: 'pixel_select'
	},
	{
		id: 'tool_ellipse_marquee',
		category: 'tools',
		shortcuts: [{ key: 'm', shift: true }],
		availability: 'editable',
		tool: 'ellipse_marquee',
		mobileGroup: 'select',
		railSlot: 'pixel_select'
	},
	{
		id: 'tool_lasso',
		category: 'tools',
		shortcuts: [{ key: 'l' }],
		availability: 'editable',
		tool: 'lasso',
		mobileGroup: 'select',
		railSlot: 'lasso'
	},
	{
		id: 'tool_magic_wand',
		category: 'tools',
		shortcuts: [{ key: 'w' }],
		availability: 'editable',
		tool: 'magic_wand',
		mobileGroup: 'select',
		railSlot: 'magic_select'
	},
	{
		id: 'tool_crop',
		category: 'tools',
		shortcuts: [{ key: 'c' }],
		availability: 'crop_target',
		tool: 'crop',
		mobileGroup: 'retouch',
		railSlot: 'crop'
	},
	{
		id: 'tool_eyedropper',
		category: 'tools',
		shortcuts: [{ key: 'i' }],
		availability: 'always',
		tool: 'eyedropper',
		mobileGroup: 'select',
		railSlot: 'eyedropper'
	},
	{
		id: 'tool_text',
		category: 'tools',
		shortcuts: [{ key: 't' }],
		availability: 'editable',
		tool: 'text',
		mobileGroup: 'draw',
		railSlot: 'text'
	},
	{
		id: 'tool_shape',
		category: 'tools',
		shortcuts: [{ key: 'u' }],
		availability: 'editable',
		tool: 'shape',
		mobileGroup: 'draw',
		railSlot: 'shape'
	},
	{
		id: 'tool_pencil',
		category: 'tools',
		shortcuts: [{ key: 'b', display: 'B / P' }, { key: 'p' }],
		availability: 'editable',
		tool: 'pencil',
		mobileGroup: 'draw',
		railSlot: 'pencil'
	},
	{
		id: 'tool_eraser',
		category: 'tools',
		shortcuts: [{ key: 'e' }],
		availability: 'editable',
		tool: 'eraser',
		mobileGroup: 'retouch',
		railSlot: 'erase'
	},
	{
		id: 'tool_magic_eraser',
		category: 'tools',
		shortcuts: [{ key: 'e', shift: true }],
		availability: 'editable',
		tool: 'magic_eraser',
		mobileGroup: 'retouch',
		railSlot: 'erase'
	},
	{
		id: 'tool_bucket',
		category: 'tools',
		shortcuts: [{ key: 'g', shift: true }],
		availability: 'editable',
		tool: 'bucket',
		mobileGroup: 'draw',
		railSlot: 'fill'
	},
	{
		id: 'tool_gradient',
		category: 'tools',
		shortcuts: [{ key: 'g' }],
		availability: 'editable',
		tool: 'gradient',
		mobileGroup: 'draw',
		railSlot: 'fill'
	},
	{
		id: 'tool_hand',
		category: 'tools',
		shortcuts: [{ key: 'h' }],
		availability: 'always',
		tool: 'hand',
		mobileGroup: 'select',
		railSlot: 'hand'
	},
	{
		id: 'tool_zoom',
		category: 'tools',
		shortcuts: [{ key: 'z' }],
		availability: 'always',
		tool: 'zoom',
		mobileGroup: 'select',
		railSlot: 'zoom'
	}
] as const;

const IMAGE_EDITOR_COMMAND_BY_ID = new Map(
	IMAGE_EDITOR_COMMANDS.map((command) => [command.id, command] as const)
);

export function imageEditorCommand(id: ImageEditorCommandID): ImageEditorCommandDescriptor {
	const command = IMAGE_EDITOR_COMMAND_BY_ID.get(id);
	if (!command) throw new Error(`Unknown Image Editor command: ${id}`);
	return command;
}

export function imageEditorCommandsForCategory(
	category: ImageEditorCommandCategory
): ImageEditorCommandDescriptor[] {
	return IMAGE_EDITOR_COMMANDS.filter((command) => command.category === category).sort(
		(left, right) => (left.menuOrder ?? 0) - (right.menuOrder ?? 0)
	);
}

export function imageEditorCommandsForMobileGroup(
	group: ImageEditorCommandMobileGroup
): ImageEditorCommandDescriptor[] {
	return IMAGE_EDITOR_COMMANDS.filter((command) => command.mobileGroup === group);
}

export function imageEditorCommandsForRail(): ImageEditorCommandDescriptor[] {
	const seen = new Set<ImageEditorCommandRailSlot>();
	return IMAGE_EDITOR_COMMANDS.filter((command) => {
		if (!command.railSlot || seen.has(command.railSlot)) return false;
		seen.add(command.railSlot);
		return true;
	});
}

export function imageEditorCommandForKeyboardEvent(
	event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing'>
): ImageEditorCommandID | null {
	if (event.isComposing) return null;
	const key = event.key.toLowerCase();
	const primary = event.metaKey || event.ctrlKey;
	for (const command of IMAGE_EDITOR_COMMANDS) {
		for (const shortcut of command.shortcuts) {
			if (
				shortcut.key === key &&
				Boolean(shortcut.primary) === primary &&
				Boolean(shortcut.shift) === event.shiftKey &&
				Boolean(shortcut.alt) === event.altKey
			)
				return command.id;
		}
	}
	return null;
}

export function imageEditorShortcutLabel(
	command: ImageEditorCommandDescriptor,
	primaryLabel: string
): string {
	const shortcut = command.shortcuts[0];
	if (!shortcut) return '';
	if (shortcut.display) return shortcut.display;
	return [
		shortcut.primary ? primaryLabel : '',
		shortcut.shift ? '⇧' : '',
		shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key
	]
		.filter(Boolean)
		.join(' ');
}

export function duplicateImageEditorShortcuts(): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const command of IMAGE_EDITOR_COMMANDS) {
		for (const shortcut of command.shortcuts) {
			const key = [
				shortcut.primary ? 'primary' : '',
				shortcut.shift ? 'shift' : '',
				shortcut.alt ? 'alt' : '',
				shortcut.key
			].join('+');
			if (seen.has(key)) duplicates.add(key);
			else seen.add(key);
		}
	}
	return [...duplicates];
}
