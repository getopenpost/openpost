import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { mediaPool } from '../media/pool.svelte';
import { editorSettings } from '../settings/editor-settings.svelte';
import type { KeyboardLayoutApi } from '../settings/keyboard-layout';
import { keyboardShortcuts } from '../settings/keyboard-shortcuts.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
import { setLocale } from '$lib/paraglide/runtime';
import EditorSettingsDialog from './editor-settings-dialog.svelte';
import '../../../routes/layout.css';

const originalKeyboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'keyboard');

function setKeyboardLayoutApi(value: KeyboardLayoutApi | undefined): void {
	Object.defineProperty(navigator, 'keyboard', { configurable: true, value });
}

beforeEach(() => {
	setLocale('en', { reload: false });
	editorSettings.reset();
	keyboardShortcuts.resetAll();
	soundPreferences.reset();
	mediaPool.clear();
	timelineStore.__resetForTesting();
});

afterEach(async () => {
	const closeButton = document.querySelector<HTMLElement>('[data-slot="dialog-close"]');
	closeButton?.click();
	await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
	if (originalKeyboardDescriptor) {
		Object.defineProperty(navigator, 'keyboard', originalKeyboardDescriptor);
	} else {
		Reflect.deleteProperty(navigator, 'keyboard');
	}
});

describe('EditorSettingsDialog shortcuts', () => {
	it('shows the printed key for a physical binding on a non-US layout', async () => {
		setKeyboardLayoutApi({
			getLayoutMap: async () =>
				new Map([
					['KeyA', 'q'],
					['KeyQ', 'a']
				])
		});
		const screen = await render(EditorSettingsDialog, { open: true });
		await screen.getByRole('button', { name: 'Shortcuts' }).click();
		await screen.getByPlaceholder('Search commands or keys').fill('Shift + Q');

		await expect
			.element(screen.getByRole('group', { name: 'Clear selected keyframes' }))
			.toHaveTextContent('Shift + Q');
		await expect
			.element(
				screen.getByText(
					'Key labels use the US layout because this browser cannot read your keyboard layout.'
				)
			)
			.not.toBeInTheDocument();
	});

	it('explains the US fallback when layout labels are unavailable', async () => {
		setKeyboardLayoutApi(undefined);
		const screen = await render(EditorSettingsDialog, { open: true });
		await screen.getByRole('button', { name: 'Shortcuts' }).click();

		await expect
			.element(
				screen.getByText(
					'Key labels use the US layout because this browser cannot read your keyboard layout.'
				)
			)
			.toBeVisible();
	});

	it('rebinding a conflict replaces the old command and fits a 320px phone', async () => {
		await page.viewport(320, 720);
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog');
		await screen.getByRole('button', { name: 'Shortcuts' }).click();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);

		const search = screen.getByPlaceholder('Search commands or keys');
		await search.fill('Play or pause');
		const play = screen.getByRole('group', { name: 'Play or pause' });
		await play.getByRole('button', { name: 'Change' }).click();
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: ' ',
				code: 'Space',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		await screen.getByRole('button', { name: 'Use shortcut' }).click();
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('shift+space');

		await search.fill('Save project');
		const save = screen.getByRole('group', { name: 'Save project' });
		await save.getByRole('button', { name: 'Change' }).click();
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: ' ',
				code: 'Space',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Already used by Play or pause.');
		await screen.getByRole('button', { name: 'Replace existing' }).click();
		expect(keyboardShortcuts.bindings.SAVE).toBe('shift+space');
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('');

		await screen.getByRole('button', { name: 'Reset all' }).click();
		await screen.getByRole('button', { name: 'Reset all' }).click();
		expect(keyboardShortcuts.bindings.PLAY_PAUSE).toBe('space');
		expect(keyboardShortcuts.bindings.SAVE).toBe('mod+s');
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
	});
});

describe('EditorSettingsDialog', () => {
	it('offers the supported languages and renders the active locale', async () => {
		setLocale('pt', { reload: false });
		const screen = await render(EditorSettingsDialog, { open: true });
		const language = screen.getByRole('button', { name: 'Idioma' });
		await expect.element(language).toHaveTextContent('Português');
		await language.click();
		await expect.element(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('option', { name: 'Português', exact: true }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('option', { name: 'Português do Brasil', exact: true }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: 'Türkçe' })).toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: '日本語' })).toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: '한국어' })).toBeInTheDocument();
		await expect.element(screen.getByRole('option', { name: '简体中文' })).toBeInTheDocument();
		await userEvent.keyboard('{Escape}');
		await expect
			.element(screen.getByRole('heading', { name: 'Definições do editor' }))
			.toBeVisible();
	});

	it('fits the complete Japanese settings chrome at 320 px', async () => {
		await page.viewport(320, 720);
		setLocale('ja', { reload: false });
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog');

		await expect.element(screen.getByRole('heading', { name: 'エディタ設定' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: '言語' })).toHaveTextContent('日本語');
		await expect.element(screen.getByRole('button', { name: '一般' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'タイムライン' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'ローカル AI' })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'ストレージ' })).toBeVisible();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);
	});

	it('fits a phone and applies persistent general, timeline, and AI defaults', async () => {
		await page.viewport(320, 720);
		const screen = await render(EditorSettingsDialog, { open: true });
		const dialog = screen.getByRole('dialog');

		await expect.element(dialog).toBeVisible();
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
		await expect
			.element(screen.getByRole('button', { name: 'General' }))
			.toHaveAttribute('data-cuelume-toggle', 'tick');
		const interfaceSounds = screen.getByRole('switch', { name: 'Interface sounds' });
		await expect.element(interfaceSounds).toHaveAttribute('aria-checked', 'true');
		await expect.element(interfaceSounds).not.toHaveAttribute('data-cuelume-toggle');
		await expect.element(screen.getByRole('slider', { name: 'Sound volume' })).toBeVisible();
		await screen.getByRole('button', { name: 'Sound theme' }).click();
		await screen.getByRole('option', { name: 'Crisp' }).click();
		expect(soundPreferences.theme).toBe('crisp');
		await expect
			.element(screen.getByRole('button', { name: 'Preview sound' }))
			.not.toHaveAttribute('data-cuelume-toggle');
		interfaceSounds.element().focus();
		await userEvent.keyboard('{Enter}');
		expect(soundPreferences.enabled).toBe(false);
		await userEvent.click(interfaceSounds.element());
		expect(soundPreferences.enabled).toBe(true);

		const periodicSave = screen.getByRole('switch', { name: 'Periodic safety save' });
		await expect.element(periodicSave).toHaveAttribute('aria-checked', 'true');
		await expect.element(periodicSave).toHaveAttribute('data-cuelume-toggle', 'toggle');
		await expect.element(screen.getByRole('slider', { name: 'Safety interval' })).toBeVisible();
		await periodicSave.click();
		expect(editorSettings.autoSaveIntervalMinutes).toBe(0);
		await expect
			.element(screen.getByRole('slider', { name: 'Safety interval' }))
			.not.toBeInTheDocument();
		await periodicSave.click();
		expect(editorSettings.autoSaveIntervalMinutes).toBe(5);

		const undoDepth = screen.getByLabelText('Undo history depth');
		await undoDepth.fill('30');
		await screen.getByRole('button', { name: 'Timeline' }).click();
		expect(editorSettings.maxUndoHistory).toBe(30);
		expect(timelineStore.maxUndoHistory).toBe(30);

		const waveforms = screen.getByRole('switch', { name: 'Show audio waveforms' });
		await expect.element(waveforms).toHaveAttribute('aria-checked', 'true');
		await waveforms.click();
		expect(editorSettings.showWaveforms).toBe(false);
		const canvasSnapping = screen.getByRole('switch', { name: 'Snap canvas objects' });
		await expect.element(canvasSnapping).toHaveAttribute('aria-checked', 'true');
		timelineStore._setSnapEnabled(false);
		await canvasSnapping.click();
		expect(editorSettings.canvasSnapEnabled).toBe(false);
		expect(timelineStore.snapEnabled).toBe(false);

		await screen.getByRole('button', { name: 'Local AI' }).click();
		await screen.getByRole('button', { name: 'Speech model' }).click();
		await screen.getByRole('option', { name: 'Whisper Small' }).click();
		expect(editorSettings.defaultTranscriptionModel).toBe('whisper-small');
		await screen.getByRole('button', { name: 'Default caption style' }).click();
		await screen.getByRole('option', { name: 'TikTok' }).click();
		expect(editorSettings.defaultCaptionStylePresetId).toBe('tiktok');
		await page.screenshot({
			element: dialog.element(),
			path: '../../../../.svelte-kit/openpost-settings-caption-style-320.png'
		});
		expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);

		await screen.getByRole('button', { name: 'Storage' }).click();
		await expect
			.element(screen.getByText(/Source media and project edits are never removed here/))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
	});
});
