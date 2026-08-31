/*
 * User-editable keyboard commands for OpenPost Video Editor.
 * Binding normalization and preset migration follow FreeCut's MIT-licensed
 * hotkey configuration while the command set stays tied to OpenPost actions.
 */
import { z } from 'zod';

export const DEFAULT_EDITOR_SHORTCUTS = {
	PLAY_PAUSE: 'space',
	PREVIOUS_FRAME: 'left',
	NEXT_FRAME: 'right',
	GO_TO_START: 'home',
	GO_TO_END: 'end',
	NEXT_SNAP_POINT: 'down',
	PREVIOUS_SNAP_POINT: 'up',
	SHUTTLE_REVERSE: 'j',
	SHUTTLE_PAUSE: 'k',
	SHUTTLE_FORWARD: 'l',
	MARK_IN: 'i',
	MARK_OUT: 'o',
	CLEAR_IN_OUT: 'alt+x',
	QUICK_CUT_ADD_SEGMENT: 'enter',
	QUICK_CUT_TOGGLE_LOOP: 'alt+l',
	INSERT_EDIT: 'comma',
	OVERWRITE_EDIT: 'period',
	SPLIT_AT_PLAYHEAD: 'alt+c',
	SPLIT_AT_PLAYHEAD_ALT: 'b',
	SPLIT_AT_CURSOR: 'shift+c',
	JOIN_ITEMS: 'shift+j',
	CLEAR_KEYFRAMES: 'shift+a',
	DELETE_SELECTED: 'backspace',
	DELETE_SELECTED_ALT: 'shift+backspace',
	RIPPLE_DELETE: 'delete',
	RIPPLE_DELETE_ALT: 'mod+delete',
	FREEZE_FRAME: 'shift+f',
	LINK_AUDIO_VIDEO: 'mod+alt+l',
	UNLINK_AUDIO_VIDEO: 'alt+shift+l',
	TOGGLE_LINKED_SELECTION: 'shift+l',
	NUDGE_LEFT: 'shift+left',
	NUDGE_RIGHT: 'shift+right',
	NUDGE_UP: 'shift+up',
	NUDGE_DOWN: 'shift+down',
	NUDGE_LEFT_LARGE: 'mod+shift+left',
	NUDGE_RIGHT_LARGE: 'mod+shift+right',
	NUDGE_UP_LARGE: 'mod+shift+up',
	NUDGE_DOWN_LARGE: 'mod+shift+down',
	COPY: 'mod+c',
	CUT: 'mod+x',
	PASTE: 'mod+v',
	COMPOSITION_DUPLICATE: 'mod+d',
	COMPOSITION_SELECT_ALL: 'mod+a',
	COMPOSITION_GROUP: 'mod+g',
	COMPOSITION_NUDGE_LEFT: 'left',
	COMPOSITION_NUDGE_RIGHT: 'right',
	COMPOSITION_NUDGE_LEFT_FAST: 'shift+left',
	COMPOSITION_NUDGE_RIGHT_FAST: 'shift+right',
	COMPOSITION_REORDER_UP: 'alt+up',
	COMPOSITION_REORDER_DOWN: 'alt+down',
	TRACK_RENAME: 'f2',
	TRACK_MOVE_UP: 'alt+up',
	TRACK_MOVE_DOWN: 'alt+down',
	UNDO: 'mod+z',
	REDO: 'mod+shift+z',
	ZOOM_IN: 'mod+equal',
	ZOOM_OUT: 'mod+minus',
	ZOOM_TO_FIT: 'backslash',
	ZOOM_TO_100: 'shift+backslash',
	ZOOM_TO_100_ALT: 'mod+0',
	RATE_STRETCH_TOOL: 'r',
	RAZOR_TOOL: 'c',
	SELECTION_TOOL: 'v',
	SLIP_TOOL: 'y',
	SLIDE_TOOL: 'u',
	SAVE: 'mod+s',
	EXPORT: 'mod+shift+e',
	OPEN_SETTINGS: 'mod+comma',
	OPEN_SCENE_BROWSER: 'mod+shift+f',
	TOGGLE_SNAP: 's',
	TOGGLE_CANVAS_SNAP: 'shift+s',
	WORKSPACE_EDIT: 'alt+1',
	WORKSPACE_COLOR: 'alt+2',
	WORKSPACE_MOTION: 'alt+3',
	ADD_MARKER: 'm',
	REMOVE_MARKER: 'shift+m',
	PREVIOUS_MARKER: 'bracketleft',
	NEXT_MARKER: 'bracketright',
	GRAPH_SELECT_ALL: 'mod+a',
	GRAPH_CLEAR_SELECTION: 'escape',
	GRAPH_NUDGE_LEFT: 'left',
	GRAPH_NUDGE_RIGHT: 'right',
	GRAPH_NUDGE_UP: 'up',
	GRAPH_NUDGE_DOWN: 'down',
	GRAPH_NUDGE_LEFT_FAST: 'shift+left',
	GRAPH_NUDGE_RIGHT_FAST: 'shift+right',
	GRAPH_NUDGE_UP_FAST: 'shift+up',
	GRAPH_NUDGE_DOWN_FAST: 'shift+down',
	KEYFRAME_EDITOR_GRAPH: '1',
	KEYFRAME_EDITOR_DOPESHEET: '2',
	KEYFRAME_EDITOR_SPLIT: '3',
	EDIT_KEYFRAME_ADD: 'k',
	KEYFRAME_PREVIOUS: 'alt+bracketleft',
	KEYFRAME_NEXT: 'alt+bracketright',
	KEYFRAME_TOGGLE_AUTO: 'a',
	KEYFRAME_FIT: 'f'
} as const;

export type EditorShortcutId = keyof typeof DEFAULT_EDITOR_SHORTCUTS;
export type EditorShortcutBindingMap = Record<EditorShortcutId, string>;
export type EditorShortcutOverrideMap = Partial<Record<EditorShortcutId, string>>;
export type EditorShortcutSection = 'playback' | 'editing' | 'timeline' | 'project';

export interface EditorShortcutDefinition {
	id: EditorShortcutId;
	section: EditorShortcutSection;
}

export const EDITOR_SHORTCUT_DEFINITIONS: readonly EditorShortcutDefinition[] = [
	{ id: 'PLAY_PAUSE', section: 'playback' },
	{ id: 'PREVIOUS_FRAME', section: 'playback' },
	{ id: 'NEXT_FRAME', section: 'playback' },
	{ id: 'GO_TO_START', section: 'playback' },
	{ id: 'GO_TO_END', section: 'playback' },
	{ id: 'PREVIOUS_SNAP_POINT', section: 'playback' },
	{ id: 'NEXT_SNAP_POINT', section: 'playback' },
	{ id: 'SHUTTLE_REVERSE', section: 'playback' },
	{ id: 'SHUTTLE_PAUSE', section: 'playback' },
	{ id: 'SHUTTLE_FORWARD', section: 'playback' },
	{ id: 'MARK_IN', section: 'editing' },
	{ id: 'MARK_OUT', section: 'editing' },
	{ id: 'CLEAR_IN_OUT', section: 'editing' },
	{ id: 'QUICK_CUT_ADD_SEGMENT', section: 'editing' },
	{ id: 'QUICK_CUT_TOGGLE_LOOP', section: 'playback' },
	{ id: 'INSERT_EDIT', section: 'editing' },
	{ id: 'OVERWRITE_EDIT', section: 'editing' },
	{ id: 'SPLIT_AT_PLAYHEAD', section: 'editing' },
	{ id: 'SPLIT_AT_PLAYHEAD_ALT', section: 'editing' },
	{ id: 'SPLIT_AT_CURSOR', section: 'editing' },
	{ id: 'JOIN_ITEMS', section: 'editing' },
	{ id: 'CLEAR_KEYFRAMES', section: 'editing' },
	{ id: 'DELETE_SELECTED', section: 'editing' },
	{ id: 'DELETE_SELECTED_ALT', section: 'editing' },
	{ id: 'RIPPLE_DELETE', section: 'editing' },
	{ id: 'RIPPLE_DELETE_ALT', section: 'editing' },
	{ id: 'FREEZE_FRAME', section: 'editing' },
	{ id: 'LINK_AUDIO_VIDEO', section: 'editing' },
	{ id: 'UNLINK_AUDIO_VIDEO', section: 'editing' },
	{ id: 'TOGGLE_LINKED_SELECTION', section: 'editing' },
	{ id: 'NUDGE_LEFT', section: 'editing' },
	{ id: 'NUDGE_RIGHT', section: 'editing' },
	{ id: 'NUDGE_UP', section: 'editing' },
	{ id: 'NUDGE_DOWN', section: 'editing' },
	{ id: 'NUDGE_LEFT_LARGE', section: 'editing' },
	{ id: 'NUDGE_RIGHT_LARGE', section: 'editing' },
	{ id: 'NUDGE_UP_LARGE', section: 'editing' },
	{ id: 'NUDGE_DOWN_LARGE', section: 'editing' },
	{ id: 'COPY', section: 'editing' },
	{ id: 'CUT', section: 'editing' },
	{ id: 'PASTE', section: 'editing' },
	{ id: 'COMPOSITION_DUPLICATE', section: 'editing' },
	{ id: 'COMPOSITION_SELECT_ALL', section: 'editing' },
	{ id: 'COMPOSITION_GROUP', section: 'editing' },
	{ id: 'COMPOSITION_NUDGE_LEFT', section: 'timeline' },
	{ id: 'COMPOSITION_NUDGE_RIGHT', section: 'timeline' },
	{ id: 'COMPOSITION_NUDGE_LEFT_FAST', section: 'timeline' },
	{ id: 'COMPOSITION_NUDGE_RIGHT_FAST', section: 'timeline' },
	{ id: 'COMPOSITION_REORDER_UP', section: 'timeline' },
	{ id: 'COMPOSITION_REORDER_DOWN', section: 'timeline' },
	{ id: 'TRACK_RENAME', section: 'timeline' },
	{ id: 'TRACK_MOVE_UP', section: 'timeline' },
	{ id: 'TRACK_MOVE_DOWN', section: 'timeline' },
	{ id: 'UNDO', section: 'editing' },
	{ id: 'REDO', section: 'editing' },
	{ id: 'GRAPH_SELECT_ALL', section: 'editing' },
	{ id: 'GRAPH_CLEAR_SELECTION', section: 'editing' },
	{ id: 'GRAPH_NUDGE_LEFT', section: 'editing' },
	{ id: 'GRAPH_NUDGE_RIGHT', section: 'editing' },
	{ id: 'GRAPH_NUDGE_UP', section: 'editing' },
	{ id: 'GRAPH_NUDGE_DOWN', section: 'editing' },
	{ id: 'GRAPH_NUDGE_LEFT_FAST', section: 'editing' },
	{ id: 'GRAPH_NUDGE_RIGHT_FAST', section: 'editing' },
	{ id: 'GRAPH_NUDGE_UP_FAST', section: 'editing' },
	{ id: 'GRAPH_NUDGE_DOWN_FAST', section: 'editing' },
	{ id: 'KEYFRAME_EDITOR_GRAPH', section: 'editing' },
	{ id: 'KEYFRAME_EDITOR_DOPESHEET', section: 'editing' },
	{ id: 'KEYFRAME_EDITOR_SPLIT', section: 'editing' },
	{ id: 'EDIT_KEYFRAME_ADD', section: 'editing' },
	{ id: 'KEYFRAME_PREVIOUS', section: 'editing' },
	{ id: 'KEYFRAME_NEXT', section: 'editing' },
	{ id: 'KEYFRAME_TOGGLE_AUTO', section: 'editing' },
	{ id: 'KEYFRAME_FIT', section: 'editing' },
	{ id: 'ZOOM_IN', section: 'timeline' },
	{ id: 'ZOOM_OUT', section: 'timeline' },
	{ id: 'ZOOM_TO_FIT', section: 'timeline' },
	{ id: 'ZOOM_TO_100', section: 'timeline' },
	{ id: 'ZOOM_TO_100_ALT', section: 'timeline' },
	{ id: 'RATE_STRETCH_TOOL', section: 'timeline' },
	{ id: 'RAZOR_TOOL', section: 'timeline' },
	{ id: 'SELECTION_TOOL', section: 'timeline' },
	{ id: 'SLIP_TOOL', section: 'timeline' },
	{ id: 'SLIDE_TOOL', section: 'timeline' },
	{ id: 'TOGGLE_SNAP', section: 'timeline' },
	{ id: 'TOGGLE_CANVAS_SNAP', section: 'timeline' },
	{ id: 'ADD_MARKER', section: 'timeline' },
	{ id: 'REMOVE_MARKER', section: 'timeline' },
	{ id: 'PREVIOUS_MARKER', section: 'timeline' },
	{ id: 'NEXT_MARKER', section: 'timeline' },
	{ id: 'SAVE', section: 'project' },
	{ id: 'EXPORT', section: 'project' },
	{ id: 'OPEN_SETTINGS', section: 'project' },
	{ id: 'OPEN_SCENE_BROWSER', section: 'project' },
	{ id: 'WORKSPACE_EDIT', section: 'project' },
	{ id: 'WORKSPACE_COLOR', section: 'project' },
	{ id: 'WORKSPACE_MOTION', section: 'project' }
] as const;

const MODIFIERS = ['mod', 'alt', 'shift'] as const;
const FUNCTION_KEY_COUNT = 12;
const MODIFIER_SET = new Set<string>(MODIFIERS);
const MODIFIER_ORDER = new Map<string, number>(MODIFIERS.map((token, index) => [token, index]));

const TOKEN_ALIASES = new Map<string, string>([
	['cmd', 'mod'],
	['command', 'mod'],
	['ctrl', 'mod'],
	['control', 'mod'],
	['option', 'alt'],
	['return', 'enter'],
	['esc', 'escape'],
	['del', 'delete'],
	['=', 'equal'],
	['equals', 'equal'],
	['-', 'minus'],
	['arrowleft', 'left'],
	['arrowright', 'right'],
	['arrowup', 'up'],
	['arrowdown', 'down']
]);

const KEY_LABELS = new Map<string, string>([
	['space', 'Space'],
	['comma', ','],
	['period', '.'],
	['bracketleft', '['],
	['bracketright', ']'],
	['minus', '-'],
	['equal', '='],
	['slash', '/'],
	['backslash', '\\'],
	['semicolon', ';'],
	['quote', "'"],
	['backquote', '`'],
	['left', 'Left'],
	['right', 'Right'],
	['up', 'Up'],
	['down', 'Down'],
	['home', 'Home'],
	['end', 'End'],
	['delete', 'Delete'],
	['backspace', 'Backspace'],
	['escape', 'Esc'],
	['tab', 'Tab'],
	['enter', 'Enter']
]);

for (let index = 1; index <= FUNCTION_KEY_COUNT; index += 1)
	KEY_LABELS.set(`f${index}`, `F${index}`);

const CODE_TOKENS = new Map<string, string>([
	['Space', 'space'],
	['Comma', 'comma'],
	['Period', 'period'],
	['BracketLeft', 'bracketleft'],
	['BracketRight', 'bracketright'],
	['Minus', 'minus'],
	['Equal', 'equal'],
	['Slash', 'slash'],
	['Backslash', 'backslash'],
	['Semicolon', 'semicolon'],
	['Quote', 'quote'],
	['Backquote', 'backquote'],
	['ArrowLeft', 'left'],
	['ArrowRight', 'right'],
	['ArrowUp', 'up'],
	['ArrowDown', 'down'],
	['Home', 'home'],
	['End', 'end'],
	['Delete', 'delete'],
	['Backspace', 'backspace'],
	['Escape', 'escape'],
	['Tab', 'tab'],
	['Enter', 'enter']
]);

for (let index = 1; index <= FUNCTION_KEY_COUNT; index += 1)
	CODE_TOKENS.set(`F${index}`, `f${index}`);

export interface ShortcutEventData {
	key?: string;
	code?: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

export interface BrowserShortcutConflict {
	binding: string;
	browserAction: string;
}

const BROWSER_CONFLICTS: readonly BrowserShortcutConflict[] = [
	{ binding: 'alt+left', browserAction: 'Back navigation' },
	{ binding: 'alt+right', browserAction: 'Forward navigation' },
	{ binding: 'f5', browserAction: 'Reload page' },
	{ binding: 'mod+r', browserAction: 'Reload page' },
	{ binding: 'mod+shift+r', browserAction: 'Hard reload page' },
	{ binding: 'mod+t', browserAction: 'New tab' },
	{ binding: 'mod+shift+t', browserAction: 'Reopen closed tab' },
	{ binding: 'mod+w', browserAction: 'Close tab' },
	{ binding: 'mod+n', browserAction: 'New window' },
	{ binding: 'mod+l', browserAction: 'Focus address bar' },
	{ binding: 'mod+d', browserAction: 'Bookmark page' },
	{ binding: 'mod+p', browserAction: 'Print page' },
	{ binding: 'mod+f', browserAction: 'Find in page' },
	{ binding: 'mod+equal', browserAction: 'Browser zoom in' },
	{ binding: 'mod+minus', browserAction: 'Browser zoom out' },
	{ binding: 'mod+0', browserAction: 'Reset browser zoom' }
] as const;

const BROWSER_CONFLICT_MAP = new Map(BROWSER_CONFLICTS.map((entry) => [entry.binding, entry]));

function normalizeToken(token: string): string {
	const normalized = token.trim().toLowerCase();
	return TOKEN_ALIASES.get(normalized) ?? normalized;
}

export function splitShortcutBinding(binding: string): string[] {
	return binding.split('+').map(normalizeToken).filter(Boolean);
}

export function normalizeShortcutBinding(binding: string): string {
	const modifiers = new Set<string>();
	const keys: string[] = [];
	for (const token of splitShortcutBinding(binding)) {
		if (MODIFIER_SET.has(token)) modifiers.add(token);
		else if (!keys.includes(token)) keys.push(token);
	}
	return [
		...Array.from(modifiers).sort(
			(left, right) => (MODIFIER_ORDER.get(left) ?? 99) - (MODIFIER_ORDER.get(right) ?? 99)
		),
		...keys
	].join('+');
}

export function hasShortcutPrimaryToken(binding: string): boolean {
	return splitShortcutBinding(binding).some((token) => !MODIFIER_SET.has(token));
}

function isShortcutId(value: string): value is EditorShortcutId {
	return value in DEFAULT_EDITOR_SHORTCUTS;
}

export function sanitizeShortcutOverrides(
	value: EditorShortcutOverrideMap | Record<string, string>
): EditorShortcutOverrideMap {
	const entries: Array<[EditorShortcutId, string]> = [];
	for (const [rawId, rawBinding] of Object.entries(value)) {
		if (!isShortcutId(rawId) || rawBinding === undefined) continue;
		if (rawBinding.trim() === '') {
			entries.push([rawId, '']);
			continue;
		}
		const binding = normalizeShortcutBinding(rawBinding);
		if (!binding || !hasShortcutPrimaryToken(binding)) continue;
		if (binding !== DEFAULT_EDITOR_SHORTCUTS[rawId]) entries.push([rawId, binding]);
	}
	// SAFETY: every entry key passed isShortCutId and every value is a normalized string.
	return Object.fromEntries(entries) as EditorShortcutOverrideMap;
}

export function resolveEditorShortcuts(overrides: EditorShortcutOverrideMap = {}) {
	return { ...DEFAULT_EDITOR_SHORTCUTS, ...sanitizeShortcutOverrides(overrides) };
}

export function shortcutPrimaryToken(event: ShortcutEventData): string | null {
	const code = event.code ?? '';
	const codeToken = CODE_TOKENS.get(code);
	if (codeToken) return codeToken;
	if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
	if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
	if (code.startsWith('Numpad') && code.length === 7) return code.slice(6);
	const key = normalizeToken(event.key ?? '');
	if (!key || MODIFIER_SET.has(key)) return null;
	if (key.length === 1 && /^[a-z0-9]$/.test(key)) return key;
	return KEY_LABELS.has(key) ? key : null;
}

export function shortcutBindingFromEvent(event: ShortcutEventData): string | null {
	const tokens: string[] = [];
	if (event.ctrlKey || event.metaKey) tokens.push('mod');
	if (event.altKey) tokens.push('alt');
	if (event.shiftKey) tokens.push('shift');
	const primary = shortcutPrimaryToken(event);
	if (primary) tokens.push(primary);
	return tokens.length > 0 ? normalizeShortcutBinding(tokens.join('+')) : null;
}

export function eventMatchesShortcut(event: ShortcutEventData, binding: string): boolean {
	if (!binding) return false;
	return shortcutBindingFromEvent(event) === normalizeShortcutBinding(binding);
}

export type EditorDeleteMode = 'lift' | 'ripple';

export function editorDeleteModeForEvent(
	event: ShortcutEventData,
	bindings: EditorShortcutBindingMap
): EditorDeleteMode | null {
	if (
		eventMatchesShortcut(event, bindings.RIPPLE_DELETE) ||
		eventMatchesShortcut(event, bindings.RIPPLE_DELETE_ALT)
	) {
		return 'ripple';
	}
	if (
		eventMatchesShortcut(event, bindings.DELETE_SELECTED) ||
		eventMatchesShortcut(event, bindings.DELETE_SELECTED_ALT)
	) {
		return 'lift';
	}
	return null;
}

export function findShortcutConflicts(
	bindings: EditorShortcutBindingMap,
	binding: string,
	currentId?: EditorShortcutId
): EditorShortcutId[] {
	const normalized = normalizeShortcutBinding(binding);
	if (!normalized || !hasShortcutPrimaryToken(normalized)) return [];
	return EDITOR_SHORTCUT_DEFINITIONS.map(({ id }) => id).filter(
		(id) => id !== currentId && normalizeShortcutBinding(bindings[id]) === normalized
	);
}

export function browserShortcutConflict(binding: string): BrowserShortcutConflict | null {
	return BROWSER_CONFLICT_MAP.get(normalizeShortcutBinding(binding)) ?? null;
}

function platformIsMac(platformValue?: string): boolean {
	const platform = (
		platformValue ??
		(globalThis.navigator?.platform || globalThis.navigator?.userAgent || 'Windows')
	).toLowerCase();
	return platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad');
}

export function formatShortcutBinding(binding: string, platformValue?: string): string {
	return formatShortcutBindingWithLabels(binding, { platform: platformValue });
}

const ARIA_KEY_TOKENS = new Map<string, string>([
	['left', 'ArrowLeft'],
	['right', 'ArrowRight'],
	['up', 'ArrowUp'],
	['down', 'ArrowDown'],
	['escape', 'Escape'],
	['space', 'Space']
]);

export function formatShortcutAriaKey(binding: string, platformValue?: string): string {
	const mac = platformIsMac(platformValue);
	return splitShortcutBinding(normalizeShortcutBinding(binding))
		.map((token) => {
			if (token === 'mod') return mac ? 'Meta' : 'Control';
			if (token === 'alt') return 'Alt';
			if (token === 'shift') return 'Shift';
			return ARIA_KEY_TOKENS.get(token) ?? KEY_LABELS.get(token) ?? token.toUpperCase();
		})
		.join('+');
}

export interface ShortcutBindingLabelOptions {
	platform?: string;
	labelForToken?: (token: string) => string | null;
}

export function formatShortcutBindingWithLabels(
	binding: string,
	options: ShortcutBindingLabelOptions = {}
): string {
	const mac = platformIsMac(options.platform);
	return splitShortcutBinding(normalizeShortcutBinding(binding))
		.map((token) => {
			if (token === 'mod') return mac ? 'Cmd' : 'Ctrl';
			if (token === 'alt') return mac ? 'Option' : 'Alt';
			if (token === 'shift') return 'Shift';
			const layoutLabel = options.labelForToken?.(token);
			if (layoutLabel) return layoutLabel;
			const label = KEY_LABELS.get(token);
			if (label) return label;
			return /^[a-z]$/.test(token) ? token.toUpperCase() : token;
		})
		.join(' + ');
}

export const SHORTCUT_PRESET_SCHEMA = 'openpost-video-editor-shortcuts';
export const SHORTCUT_PRESET_VERSION = 1;

const presetCommandSchema = z.object({
	id: z.string().optional(),
	key: z.string().optional(),
	binding: z.string().optional(),
	shortcut: z.string().optional()
});

export const shortcutOverrideRecordSchema = z.record(z.string(), z.string());

const presetSchema = z.object({
	schema: z.string().optional(),
	version: z.number().optional(),
	overrides: shortcutOverrideRecordSchema.optional(),
	commands: z.array(presetCommandSchema).optional()
});

export type ShortcutPresetJson =
	| null
	| boolean
	| number
	| string
	| ShortcutPresetJson[]
	| { [key: string]: ShortcutPresetJson };

export interface ShortcutPresetDocument {
	schema: typeof SHORTCUT_PRESET_SCHEMA;
	version: typeof SHORTCUT_PRESET_VERSION;
	exportedAt: string;
	overrides: EditorShortcutOverrideMap;
	commands: Array<{
		id: EditorShortcutId;
		binding: string;
		defaultBinding: string;
		isCustom: boolean;
	}>;
}

export interface ShortcutPresetImport {
	overrides: EditorShortcutOverrideMap;
	importedCount: number;
	ignoredCount: number;
	sourceSchema: string | null;
	sourceVersion: number | null;
}

export function createShortcutPreset(
	overrides: EditorShortcutOverrideMap = {},
	now = new Date()
): ShortcutPresetDocument {
	const clean = sanitizeShortcutOverrides(overrides);
	const bindings = resolveEditorShortcuts(clean);
	return {
		schema: SHORTCUT_PRESET_SCHEMA,
		version: SHORTCUT_PRESET_VERSION,
		exportedAt: now.toISOString(),
		overrides: clean,
		commands: EDITOR_SHORTCUT_DEFINITIONS.map(({ id }) => ({
			id,
			binding: bindings[id],
			defaultBinding: DEFAULT_EDITOR_SHORTCUTS[id],
			isCustom: id in clean
		}))
	};
}

export function parseShortcutPreset(
	value: ShortcutPresetJson | ShortcutPresetDocument
): ShortcutPresetImport {
	const parsed = presetSchema.safeParse(value);
	if (!parsed.success) throw new Error('Invalid shortcut preset');
	const source = parsed.data;
	const raw: Record<string, string> = {};
	let ignoredCount = 0;
	if (source.overrides) Object.assign(raw, source.overrides);
	else {
		for (const command of source.commands ?? []) {
			const id = command.id ?? command.key;
			const binding = command.binding ?? command.shortcut;
			if (!id || binding === undefined) {
				ignoredCount += 1;
				continue;
			}
			raw[id] = binding;
		}
	}
	for (const id of Object.keys(raw)) if (!isShortcutId(id)) ignoredCount += 1;
	const overrides = sanitizeShortcutOverrides(raw);
	const importedCount = Object.keys(raw).filter(isShortcutId).length;
	return {
		overrides,
		importedCount,
		ignoredCount,
		sourceSchema: source.schema ?? null,
		sourceVersion: source.version ?? null
	};
}

export function editorShortcutTargetIsDisabled(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.closest('[data-editor-shortcuts-disabled]')) return true;
	if (target.closest('[data-editor-shortcuts-enabled]')) return false;
	if (target.closest('[data-editor-shortcuts-owned]')) return true;
	return Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"]'));
}

function editorPlaybackTargetIsDisabled(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		Boolean(
			target.closest(
				'input, textarea, select, [contenteditable="true"], [data-editor-shortcuts-disabled]'
			)
		)
	);
}

export function handleGlobalPlayPauseShortcut(
	event: KeyboardEvent,
	binding: string,
	onToggle: () => void
): boolean {
	if (
		event.repeat ||
		event.defaultPrevented ||
		!eventMatchesShortcut(event, binding) ||
		editorPlaybackTargetIsDisabled(event.target)
	) {
		return false;
	}
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	onToggle();
	return true;
}

function sceneBrowserShortcutTargetIsDisabled(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		Boolean(
			target.closest(
				'input, textarea, select, [contenteditable="true"], [data-editor-shortcuts-disabled]'
			)
		)
	);
}

export function handleOpenSceneBrowserShortcut(
	event: KeyboardEvent,
	binding: string,
	onOpen: () => void
): boolean {
	if (
		event.repeat ||
		event.defaultPrevented ||
		!eventMatchesShortcut(event, binding) ||
		sceneBrowserShortcutTargetIsDisabled(event.target)
	)
		return false;
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	onOpen();
	return true;
}
