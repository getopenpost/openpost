import { describe, expect, it, vi } from 'vitest';
import {
	editorShortcutTargetIsDisabled,
	createShortcutMatcher,
	DEFAULT_EDITOR_SHORTCUTS,
	handleGlobalPlayPauseShortcut
} from './keyboard-shortcuts';
import { userEvent } from 'vitest/browser';

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
	it.each(['button', 'a', 'summary'])(
		'allows history and save from a focused %s without taking its navigation keys',
		(tag) => {
			const control = document.createElement(tag);
			document.body.append(control);
			try {
				const dispatch = (key: string, code: string, ctrlKey = false, shiftKey = false) => {
					const event = new KeyboardEvent('keydown', {
						key,
						code,
						ctrlKey,
						shiftKey,
						bubbles: true
					});
					control.dispatchEvent(event);
					return createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS);
				};
				expect(dispatch('z', 'KeyZ', true)?.('UNDO')).toBe(true);
				expect(dispatch('s', 'KeyS', true)?.('SAVE')).toBe(true);
				expect(dispatch('z', 'KeyZ', true, true)?.('REDO')).toBe(true);
				expect(dispatch('e', 'KeyE', true, true)?.('EXPORT')).toBe(true);
				expect(dispatch('ArrowRight', 'ArrowRight')?.('NEXT_FRAME')).not.toBe(true);
			} finally {
				control.remove();
			}
		}
	);

	it.each(['input', 'textarea', 'select'])('leaves native editing in %s alone', (tag) => {
		const input = document.createElement(tag);
		input.setAttribute('data-editor-shortcuts-enabled', '');
		const event = new KeyboardEvent('keydown', {
			key: 'z',
			code: 'KeyZ',
			ctrlKey: true
		});
		input.dispatchEvent(event);
		expect(createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS)).toBeNull();
	});
});

describe('native control activation', () => {
	it('leaves Enter and Space to a disclosure and Space to a button', async () => {
		const details = document.createElement('details');
		const summary = document.createElement('summary');
		summary.textContent = 'Advanced options';
		details.append(summary);
		const button = document.createElement('button');
		button.textContent = 'Choose source';
		const activate = vi.fn();
		button.addEventListener('click', activate);
		document.body.append(details, button);
		const toggle = vi.fn();
		const add = vi.fn();
		const listener = (event: KeyboardEvent) => {
			if (handleGlobalPlayPauseShortcut(event, 'space', toggle)) return;
			if (createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS)?.('QUICK_CUT_ADD_SEGMENT')) {
				event.preventDefault();
				add();
			}
		};
		window.addEventListener('keydown', listener, true);
		try {
			summary.focus();
			await userEvent.keyboard('{Enter}');
			expect(details.open).toBe(true);
			await userEvent.keyboard(' ');
			expect(details.open).toBe(false);
			button.focus();
			await userEvent.keyboard(' ');
			expect(activate).toHaveBeenCalledOnce();
			expect(toggle).not.toHaveBeenCalled();
			expect(add).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener('keydown', listener, true);
			details.remove();
			button.remove();
		}
	});

	it('keeps SVG slider navigation local while allowing project history and save', () => {
		const slider = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		slider.setAttribute('role', 'slider');
		const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		slider.append(handle);
		document.body.append(slider);
		try {
			const dispatch = (key: string, code: string, ctrlKey = false, shiftKey = false) => {
				const event = new KeyboardEvent('keydown', {
					key,
					code,
					ctrlKey,
					shiftKey,
					bubbles: true
				});
				handle.dispatchEvent(event);
				return createShortcutMatcher(event, DEFAULT_EDITOR_SHORTCUTS);
			};
			expect(dispatch('ArrowRight', 'ArrowRight')?.('NEXT_FRAME')).not.toBe(true);
			expect(dispatch('z', 'KeyZ', true)?.('UNDO')).toBe(true);
			expect(dispatch('s', 'KeyS', true)?.('SAVE')).toBe(true);
			expect(dispatch('z', 'KeyZ', true, true)?.('REDO')).toBe(true);
			expect(dispatch('e', 'KeyE', true, true)?.('EXPORT')).toBe(true);
		} finally {
			slider.remove();
		}
	});
});
