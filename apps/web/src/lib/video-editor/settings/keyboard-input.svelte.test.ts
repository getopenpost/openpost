import { describe, expect, it, vi } from 'vitest';
import {
	editorShortcutTargetIsDisabled,
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
