import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
	DEFAULT_EDITOR_SHORTCUTS,
	handleGlobalPlayPauseShortcut,
	handleOpenSceneBrowserShortcut
} from './keyboard-shortcuts';

afterEach(() => {
	document.body.replaceChildren();
});

describe('global playback shortcut', () => {
	it('toggles playback from a focused button without clicking it', async () => {
		const button = document.createElement('button');
		button.textContent = 'Export';
		document.body.append(button);
		const onclick = vi.fn();
		const onToggle = vi.fn();
		button.addEventListener('click', onclick);
		button.addEventListener('keydown', (event) => event.preventDefault());
		const onKeydown = (event: KeyboardEvent) => {
			handleGlobalPlayPauseShortcut(event, DEFAULT_EDITOR_SHORTCUTS.PLAY_PAUSE, onToggle);
		};
		window.addEventListener('keydown', onKeydown, { capture: true });
		button.focus();

		await userEvent.keyboard(' ');

		expect(onToggle).toHaveBeenCalledOnce();
		expect(onclick).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onKeydown, { capture: true });
	});

	it('leaves Space available to text fields and explicit shortcut-disabled surfaces', async () => {
		const input = document.createElement('input');
		const disabled = document.createElement('button');
		disabled.dataset.editorShortcutsDisabled = '';
		document.body.append(input, disabled);
		const onToggle = vi.fn();
		const onKeydown = (event: KeyboardEvent) => {
			handleGlobalPlayPauseShortcut(event, DEFAULT_EDITOR_SHORTCUTS.PLAY_PAUSE, onToggle);
		};
		window.addEventListener('keydown', onKeydown);

		input.focus();
		await userEvent.keyboard(' ');
		expect(input.value).toBe(' ');
		disabled.focus();
		await userEvent.keyboard(' ');
		expect(onToggle).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onKeydown);
	});
});

describe('Scene Browser shortcut', () => {
	it('captures the global binding from a focused button without clicking it', async () => {
		const button = document.createElement('button');
		button.textContent = 'Export';
		document.body.append(button);
		const onclick = vi.fn();
		const onOpen = vi.fn();
		button.addEventListener('click', onclick);
		const onKeydown = (event: KeyboardEvent) => {
			handleOpenSceneBrowserShortcut(event, DEFAULT_EDITOR_SHORTCUTS.OPEN_SCENE_BROWSER, onOpen);
		};
		window.addEventListener('keydown', onKeydown, { capture: true });
		button.focus();

		await userEvent.keyboard('{Meta>}{Shift>}f{/Shift}{/Meta}');

		expect(onOpen).toHaveBeenCalledOnce();
		expect(onclick).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onKeydown, { capture: true });
	});

	it('leaves the binding available to fields and explicit disabled surfaces', async () => {
		const input = document.createElement('input');
		const disabled = document.createElement('div');
		disabled.tabIndex = 0;
		disabled.dataset.editorShortcutsDisabled = '';
		document.body.append(input, disabled);
		const onOpen = vi.fn();
		const onKeydown = (event: KeyboardEvent) => {
			handleOpenSceneBrowserShortcut(event, DEFAULT_EDITOR_SHORTCUTS.OPEN_SCENE_BROWSER, onOpen);
		};
		window.addEventListener('keydown', onKeydown, { capture: true });

		input.focus();
		await userEvent.keyboard('{Meta>}{Shift>}f{/Shift}{/Meta}');
		disabled.focus();
		await userEvent.keyboard('{Meta>}{Shift>}f{/Shift}{/Meta}');

		expect(onOpen).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onKeydown, { capture: true });
	});
});
