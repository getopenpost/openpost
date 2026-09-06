import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { keyboardShortcuts } from '../settings/keyboard-shortcuts.svelte';
import KeyboardShortcutEditor from './keyboard-shortcut-editor.svelte';

beforeEach(() => {
	keyboardShortcuts.resetAll();
});

describe('KeyboardShortcutEditor', () => {
	it('groups alternate bindings and filters commands from an accessible keyboard', async () => {
		const screen = await render(KeyboardShortcutEditor);

		await expect.element(screen.getByRole('group', { name: 'Shortcut keyboard' })).toBeVisible();
		await screen.getByRole('button', { name: /B:.*Split at playhead, alternate/ }).click();
		await expect.element(screen.getByRole('group', { name: 'Split at playhead' })).toBeVisible();
		await expect.element(screen.getByText('Primary', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Alternate', { exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole('group', { name: 'Save project' }))
			.not.toBeInTheDocument();
	});

	it('reviews an import before applying it and can undo it after apply', async () => {
		keyboardShortcuts.setBinding('SAVE', 'alt+s');
		const screen = await render(KeyboardShortcutEditor);
		const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const file = new File(
			[
				JSON.stringify({
					schema: 'openpost-video-editor-shortcuts',
					version: 1,
					overrides: { PLAY_PAUSE: 'shift+space' }
				})
			],
			'shortcuts.json',
			{ type: 'application/json' }
		);
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect.element(screen.getByText('Review imported shortcuts')).toBeVisible();
		expect(keyboardShortcuts.bindings.SAVE).toBe('alt+s');
		await screen.getByRole('button', { name: 'Apply import' }).click();
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('shift+space');
		expect(keyboardShortcuts.bindings.SAVE).toBe('mod+s');

		await screen.getByRole('button', { name: 'Undo import' }).click();
		expect(keyboardShortcuts.bindings.SAVE).toBe('alt+s');
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('space');
	});

	it('shows the commands involved in an imported binding conflict', async () => {
		const screen = await render(KeyboardShortcutEditor);
		const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const file = new File(
			[
				JSON.stringify({
					schema: 'openpost-video-editor-shortcuts',
					version: 1,
					overrides: { PLAY_PAUSE: 'mod+s' }
				})
			],
			'conflicting-shortcuts.json',
			{ type: 'application/json' }
		);
		const transfer = new DataTransfer();
		transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect.element(screen.getByRole('alert')).toHaveTextContent('Save project');
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Play or pause');
		await expect.element(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
	});
});
