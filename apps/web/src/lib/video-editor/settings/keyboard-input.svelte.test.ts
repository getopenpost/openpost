import { describe, expect, it, vi } from 'vitest';
import {
	editorShortcutTargetIsDisabled,
	createShortcutMatcher,
	DEFAULT_EDITOR_SHORTCUTS,
	handleGlobalPlayPauseShortcut
} from './keyboard-shortcuts';

describe('canvas text keyboard ownership', () => {
	it.each(['plaintext-only', 'true', ''])('preserves spaces in contenteditable=%s', (mode) => {
		const editor = document.createElement('div');
		editor.setAttribute('contenteditable', mode);
		const text = document.createElement('span');
		editor.append(text);
		document.body.append(editor);
		const toggle = vi.fn();
		const listener = (event: KeyboardEvent) =>
			handleGlobalPlayPauseShortcut(event, 'space', toggle);
		window.addEventListener('keydown', listener, true);
		try {
			const event = new KeyboardEvent('keydown', {
				key: ' ',
				code: 'Space',
				bubbles: true,
				cancelable: true
			});
			text.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
			expect(toggle).not.toHaveBeenCalled();
			expect(editorShortcutTargetIsDisabled(text)).toBe(true);
		} finally {
			window.removeEventListener('keydown', listener, true);
			editor.remove();
		}
	});
});

describe('project shortcut focus', () => {
	it.each(['button', 'a'])(
		'allows history and save from a focused %s without taking its navigation keys',
		(tag) => {
			const control = document.createElement(tag);
			document.body.append(control);
			try {
				const dispatch = (key: string, code: string, ctrlKey = false) => {
					const event = new KeyboardEvent('keydown', { key, code, ctrlKey, bubbles: true });
					control.dispatchEvent(event);
					return createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS);
				};
				expect(dispatch('z', 'KeyZ', true)?.('UNDO')).toBe(true);
				expect(dispatch('s', 'KeyS', true)?.('SAVE')).toBe(true);
				expect(dispatch('ArrowRight', 'ArrowRight')?.('NEXT_FRAME')).not.toBe(true);
			} finally {
				control.remove();
			}
		}
	);

	it.each(['input', 'textarea', 'select'])('leaves native editing in %s alone', (tag) => {
		const input = document.createElement(tag);
		input.setAttribute('data-editor-shortcuts-enabled', '');
		const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true });
		input.dispatchEvent(event);
		expect(createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS)).toBeNull();
	});
});
