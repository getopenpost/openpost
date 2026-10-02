import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import '../../../routes/layout.css';
import { keyboardShortcuts } from '../settings/keyboard-shortcuts.svelte';
import KeyboardShortcutEditor from './keyboard-shortcut-editor.svelte';
import EditorSettingsDialog from './editor-settings-dialog.svelte';

beforeEach(() => {
	keyboardShortcuts.resetAll();
});

describe('KeyboardShortcutEditor', () => {
	it('cancels shortcut capture before Escape dismisses Settings', async () => {
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog', { name: 'Editor settings' });
		await dialog.getByRole('button', { name: 'Shortcuts', exact: true }).click();
		const play = dialog.getByRole('group', { name: 'Play or pause', exact: true });
		for (const conflict of [false, true]) {
			await play.getByRole('button', { name: 'Change', exact: true }).click();
			if (conflict) {
				await userEvent.keyboard('{ArrowRight}');
				await expect.element(dialog.getByText(/Already used by.*Next frame/)).toBeVisible();
			}
			await userEvent.keyboard('{Escape}');
			await expect.element(dialog).toBeVisible();
			await expect.element(play.getByRole('button', { name: 'Change', exact: true })).toBeVisible();
			expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('space');
		}
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it('groups alternate bindings and filters commands from an accessible keyboard', async () => {
		const screen = await render(KeyboardShortcutEditor);

		await expect.element(screen.getByRole('group', { name: 'Shortcut keyboard' })).toBeVisible();
		await screen.getByRole('button', { name: /B:.*Split at playhead, alternate/ }).click();
		await expect.element(screen.getByRole('group', { name: 'Split at playhead' })).toBeVisible();
		// The B key is shared with the layout-dock sidebar toggles, so the keyboard
		// filter lists every command on that key. Scope the badge assertions to
		// the split group to keep them unambiguous.
		await expect.element(screen.getByRole('group', { name: 'Toggle assets panel' })).toBeVisible();
		await expect.element(screen.getByRole('group', { name: 'Toggle tools panel' })).toBeVisible();
		const splitGroup = screen.getByRole('group', { name: 'Split at playhead' });
		await expect.element(splitGroup.getByText('Primary', { exact: true })).toBeVisible();
		await expect.element(splitGroup.getByText('Alternate', { exact: true })).toBeVisible();
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

	it('exposes the shortcut filter bar as a named group', async () => {
		const screen = await render(KeyboardShortcutEditor);
		const group = screen.getByRole('group', { name: 'Filter shortcuts' });
		await expect.element(group).toBeVisible();
		await expect.element(group.getByRole('button', { name: /^All/ })).toBeVisible();
	});
});
